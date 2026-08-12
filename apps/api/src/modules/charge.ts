/**
 * Cobranças — protótipo: `FinCobrancas`, `FinFinanceiro`, `ChargeForm`.
 *
 * O ponto central é `paidAmount` / `balance` serem COLUNAS, não somatórios
 * calculados por linha. No protótipo, `paid(c)` e `balance(c)` percorriam o
 * array de pagamentos de cada cobrança, em toda tabela e todo dashboard — o pior
 * N+1 do sistema (docs/PLANO.md §7.1).
 *
 * Registrar pagamento e dar baixa vivem em `payment.ts`, porque exigem
 * permissões que o operacional não tem.
 */

import {
  chargeSchema,
  createChargeBodySchema,
  idParamSchema,
  listChargeQuerySchema,
  paginated,
  type Charge,
} from '@acm/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { refreshClientAggregates } from '../lib/aggregates';
import { recordChanges } from '../lib/changefeed';
import { nextCode } from '../lib/codes';
import { badRequest, notFound } from '../lib/errors';
import { buildPage, cursorArgs, searchTerm } from '../lib/pagination';
import { decimalToMoneyStrict, Prisma, prisma, toDecimal } from '../lib/prisma';
import { clientScope, requireAnyPermission, requirePermission, requireUser } from '../plugins/rbac';

export const chargeSelect = {
  id: true,
  code: true,
  clientId: true,
  tripId: true,
  total: true,
  paidAmount: true,
  balance: true,
  dueDate: true,
  description: true,
  status: true,
  settledAt: true,
  createdAt: true,
  client: { select: { id: true, name: true, company: true } },
  trip: { select: { id: true, code: true, origin: true, destination: true } },
  payments: {
    where: { reversedAt: null },
    select: {
      id: true,
      chargeId: true,
      amount: true,
      paidAt: true,
      method: true,
      note: true,
      isSettlement: true,
      reversedAt: true,
      createdAt: true,
    },
    orderBy: { paidAt: 'desc' },
  },
} as const;

type ChargeRow = Prisma.ChargeGetPayload<{ select: typeof chargeSelect }>;

const utcDate = (d: Date): string => d.toISOString().slice(0, 10);

export function toChargeDTO(row: ChargeRow): Charge {
  return {
    id: row.id,
    code: row.code,
    clientId: row.clientId,
    client: row.client,
    tripId: row.tripId,
    trip: row.trip,
    total: decimalToMoneyStrict(row.total),
    paidAmount: decimalToMoneyStrict(row.paidAmount),
    balance: decimalToMoneyStrict(row.balance),
    dueDate: utcDate(row.dueDate),
    description: row.description,
    status: row.status,
    settledAt: row.settledAt === null ? null : row.settledAt.toISOString(),
    payments: row.payments.map((p) => ({
      id: p.id,
      chargeId: p.chargeId,
      amount: decimalToMoneyStrict(p.amount),
      paidAt: utcDate(p.paidAt),
      method: p.method,
      note: p.note,
      isSettlement: p.isSettlement,
      reversedAt: p.reversedAt === null ? null : p.reversedAt.toISOString(),
      createdAt: p.createdAt.toISOString(),
    })),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function chargeRoutes(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>();

  // ------------------------------------------------------------------- listar
  route.get(
    '/',
    {
      preValidation: requireAnyPermission('charge:read', 'charge:read_own'),
      schema: { querystring: listChargeQuerySchema, response: { 200: paginated(chargeSchema) } },
    },
    async (request) => {
      const user = requireUser(request);
      const { limit, cursor, q, status, clientId, openOnly, dueBefore } = request.query;
      const term = searchTerm(q);

      const rows = await prisma.charge.findMany({
        where: {
          canceledAt: null,
          ...clientScope(user),
          ...(status ? { status } : {}),
          ...(clientId && user.role !== 'cliente' ? { clientId } : {}),
          // `balance > 0` é coluna: filtro indexável, não cálculo em memória.
          ...(openOnly ? { balance: { gt: 0 } } : {}),
          ...(dueBefore ? { dueDate: { lte: new Date(`${dueBefore}T00:00:00.000Z`) } } : {}),
          ...(term
            ? { OR: [{ code: { contains: term } }, { client: { name: { contains: term } } }] }
            : {}),
        },
        select: chargeSelect,
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        ...cursorArgs({ cursor, limit }),
      });

      return buildPage(rows, limit, toChargeDTO);
    },
  );

  route.get(
    '/:id',
    {
      preValidation: requireAnyPermission('charge:read', 'charge:read_own'),
      schema: { params: idParamSchema, response: { 200: chargeSchema } },
    },
    async (request) => {
      const user = requireUser(request);
      const row = await prisma.charge.findFirst({
        where: { id: request.params.id, ...clientScope(user) },
        select: chargeSelect,
      });
      if (!row) throw notFound('Cobrança');
      return toChargeDTO(row);
    },
  );

  // ------------------------------------------------------------------- criar
  route.post(
    '/',
    {
      preValidation: requirePermission('charge:create'),
      schema: { body: createChargeBodySchema, response: { 201: chargeSchema } },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const body = request.body;
      const now = new Date();

      const total = toDecimal(body.total);
      if (total.lessThanOrEqualTo(0))
        throw badRequest('O valor da cobrança deve ser maior que zero.');

      const created = await prisma.$transaction(async (tx) => {
        const client = await tx.client.findFirst({
          where: { id: body.clientId, deletedAt: null },
          select: { id: true },
        });
        if (!client) throw notFound('Cliente');

        if (body.tripId) {
          const trip = await tx.trip.findFirst({
            where: { id: body.tripId, clientId: body.clientId },
            select: { id: true },
          });
          if (!trip) throw badRequest('A viagem informada não pertence a este cliente.');
        }

        const code = await nextCode(tx, 'charge');

        const charge = await tx.charge.create({
          data: {
            code,
            clientId: body.clientId,
            tripId: body.tripId ?? null,
            total,
            // Cobrança nasce sem pagamento: saldo = total.
            paidAmount: new Prisma.Decimal(0),
            balance: total,
            status: 'pendente',
            dueDate: new Date(`${body.dueDate}T00:00:00.000Z`),
            description: body.description ?? null,
            createdById: user.id,
          },
          select: { id: true },
        });

        await refreshClientAggregates(tx, body.clientId, now);

        const portalUser = await tx.user.findFirst({
          where: { clientId: body.clientId, status: 'ativo' },
          select: { id: true },
        });
        if (portalUser) {
          await tx.notification.create({
            data: {
              userId: portalUser.id,
              type: 'cobranca_criada',
              title: `Nova cobrança ${code}`,
              body: `Vencimento em ${body.dueDate}`,
              entity: 'charge',
              entityId: charge.id,
            },
          });
        }

        await recordChanges(
          tx,
          [
            {
              entity: 'charge',
              entityId: charge.id,
              action: 'created',
              clientScopeId: body.clientId,
            },
            {
              entity: 'client',
              entityId: body.clientId,
              action: 'updated',
              clientScopeId: body.clientId,
            },
          ],
          user.id,
        );

        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'charge.create',
            entity: 'charge',
            entityId: charge.id,
            after: { code, total: body.total, dueDate: body.dueDate },
          },
        });

        return tx.charge.findUniqueOrThrow({ where: { id: charge.id }, select: chargeSelect });
      });

      void reply.status(201);
      return toChargeDTO(created);
    },
  );
}
