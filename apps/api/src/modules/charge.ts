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
  chargeStatus,
  createChargeBodySchema,
  idParamSchema,
  listChargeQuerySchema,
  paginated,
  updateChargeBodySchema,
  type Charge,
} from '@acm/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { env } from '../env';
import { recalculateCharge, refreshClientAggregates } from '../lib/aggregates';
import { recordChanges } from '../lib/changefeed';
import { nextCode } from '../lib/codes';
import { badRequest, notFound } from '../lib/errors';
import { buildPage, cursorArgs, searchTerm } from '../lib/pagination';
import { resolveClientId } from '../lib/placeholder-client';
import { decimalToMoneyStrict, Prisma, prisma, toDecimal, type Db } from '../lib/prisma';
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

/** "AAAA-MM-DD" → Date à meia-noite UTC; em branco, hoje no fuso da empresa. */
const dueDateOrToday = (value: string | undefined): Date =>
  new Date(
    `${value ?? new Date().toLocaleDateString('en-CA', { timeZone: env.TZ })}T00:00:00.000Z`,
  );

/**
 * Recalcula pago/saldo/status depois de mexer no total ou nos pagamentos.
 *
 * `recalculateCharge` reconta os pagamentos; o `vencido` depende do relógio e
 * normalmente fica com o job, mas depois de uma edição a tela tem de mostrar o
 * status certo na hora — não daqui a cinco minutos.
 */
export async function reconcileCharge(tx: Db, chargeId: string, now: Date): Promise<void> {
  await recalculateCharge(tx, chargeId);

  const row = await tx.charge.findUniqueOrThrow({
    where: { id: chargeId },
    select: { total: true, paidAmount: true, dueDate: true, status: true },
  });

  const status = chargeStatus(
    { total: row.total.toFixed(2), paidAmount: row.paidAmount.toFixed(2), dueDate: row.dueDate },
    now,
  );
  if (status !== row.status) {
    await tx.charge.update({ where: { id: chargeId }, data: { status } });
  }
}

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

      // Valor em branco = R$ 0: o administrador lança a cobrança e completa depois.
      const total = toDecimal(body.total);
      const dueDate = dueDateOrToday(body.dueDate);

      const created = await prisma.$transaction(async (tx) => {
        // Sem cliente: vale o da viagem escolhida; sem viagem, "Cliente a definir".
        const trip = body.tripId
          ? await tx.trip.findUnique({ where: { id: body.tripId }, select: { clientId: true } })
          : null;
        if (body.tripId && !trip) throw notFound('Viagem');

        const clientId = await resolveClientId(tx, body.clientId ?? trip?.clientId);

        const client = await tx.client.findFirst({
          where: { id: clientId, deletedAt: null },
          select: { id: true },
        });
        if (!client) throw notFound('Cliente');

        if (trip && trip.clientId !== clientId) {
          throw badRequest('A viagem informada não pertence a este cliente.');
        }

        const code = await nextCode(tx, 'charge');

        const charge = await tx.charge.create({
          data: {
            code,
            clientId,
            tripId: body.tripId ?? null,
            total,
            // Cobrança nasce sem pagamento: saldo = total.
            paidAmount: new Prisma.Decimal(0),
            balance: total,
            status: 'pendente',
            dueDate,
            description: body.description ?? null,
            createdById: user.id,
          },
          select: { id: true },
        });

        await refreshClientAggregates(tx, clientId, now);

        const portalUser = await tx.user.findFirst({
          where: { clientId, status: 'ativo' },
          select: { id: true },
        });
        if (portalUser) {
          await tx.notification.create({
            data: {
              userId: portalUser.id,
              type: 'cobranca_criada',
              title: `Nova cobrança ${code}`,
              body: `Vencimento em ${utcDate(dueDate)}`,
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
              clientScopeId: clientId,
            },
            {
              entity: 'client',
              entityId: clientId,
              action: 'updated',
              clientScopeId: clientId,
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
            after: { code, total: body.total, dueDate: utcDate(dueDate) },
          },
        });

        return tx.charge.findUniqueOrThrow({ where: { id: charge.id }, select: chargeSelect });
      });

      void reply.status(201);
      return toChargeDTO(created);
    },
  );

  // ---------------------------------------------------------------- atualizar
  route.patch(
    '/:id',
    {
      preValidation: requirePermission('charge:update'),
      schema: {
        params: idParamSchema,
        body: updateChargeBodySchema,
        response: { 200: chargeSchema },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { id } = request.params;
      const body = request.body;
      const now = new Date();

      const updated = await prisma.$transaction(async (tx) => {
        const before = await tx.charge.findUnique({
          where: { id },
          select: {
            id: true,
            code: true,
            clientId: true,
            tripId: true,
            total: true,
            paidAmount: true,
            dueDate: true,
          },
        });
        if (!before) throw notFound('Cobrança');

        // `null` desliga a viagem; ausente mantém a atual.
        const tripId = body.tripId === undefined ? before.tripId : body.tripId;
        const trip = tripId
          ? await tx.trip.findUnique({ where: { id: tripId }, select: { clientId: true } })
          : null;
        if (tripId && !trip) throw notFound('Viagem');

        // Trocar só a viagem leva junto o cliente dela.
        const clientId = body.clientId ?? (body.tripId && trip ? trip.clientId : before.clientId);

        if (clientId !== before.clientId) {
          const client = await tx.client.findFirst({
            where: { id: clientId, deletedAt: null },
            select: { id: true },
          });
          if (!client) throw notFound('Cliente');
        }
        if (trip && trip.clientId !== clientId) {
          throw badRequest('A viagem informada não pertence a este cliente.');
        }

        const total = body.total === undefined ? before.total : toDecimal(body.total);
        if (total.lessThan(before.paidAmount)) {
          throw badRequest(
            `O valor não pode ficar abaixo do que já foi pago (${decimalToMoneyStrict(before.paidAmount)}). Edite ou estorne um pagamento antes.`,
            { total: 'Menor que o valor já pago' },
          );
        }

        await tx.charge.update({
          where: { id },
          data: {
            clientId,
            tripId,
            total,
            ...(body.dueDate === undefined ? {} : { dueDate: dueDateOrToday(body.dueDate) }),
            ...(body.description === undefined ? {} : { description: body.description }),
          },
        });

        await reconcileCharge(tx, id, now);

        const touchedClients =
          clientId === before.clientId ? [clientId] : [before.clientId, clientId];
        for (const touched of touchedClients) {
          await refreshClientAggregates(tx, touched, now);
        }

        await recordChanges(
          tx,
          [
            { entity: 'charge', entityId: id, action: 'updated', clientScopeId: clientId },
            ...touchedClients.map((touched) => ({
              entity: 'client' as const,
              entityId: touched,
              action: 'updated' as const,
              clientScopeId: touched,
            })),
          ],
          user.id,
        );

        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'charge.update',
            entity: 'charge',
            entityId: id,
            before: {
              clientId: before.clientId,
              tripId: before.tripId,
              total: decimalToMoneyStrict(before.total),
              dueDate: utcDate(before.dueDate),
            },
            after: {
              clientId,
              tripId,
              total: decimalToMoneyStrict(total),
              fields: Object.keys(body),
            },
          },
        });

        return tx.charge.findUniqueOrThrow({ where: { id }, select: chargeSelect });
      });

      return toChargeDTO(updated);
    },
  );
}
