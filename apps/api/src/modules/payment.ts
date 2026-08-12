/**
 * Pagamentos e baixa — protótipo: `PaymentForm`, `FinPagamentos`, `darBaixa`.
 *
 * NENHUMA rota deste módulo é alcançável pelo perfil operacional: a matriz de
 * permissões não dá nenhuma `payment:*` a ele. É a regra "Operacional não dá
 * baixa" do HANDOFF, aplicada onde não dá para contornar pela interface.
 *
 * Toda escrita usa `increment`/`decrement` atômicos sobre `paidAmount` e
 * `balance`, dentro de transação. Dois recebimentos simultâneos na mesma
 * cobrança não se sobrescrevem.
 */

import {
  createPaymentBodySchema,
  chargeSchema,
  idParamSchema,
  listPaymentQuerySchema,
  paginated,
  paymentHistoryItemSchema,
  reversePaymentBodySchema,
  settleChargeBodySchema,
  settlementStatus,
  type PaymentHistoryItem,
} from '@acm/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { recalculateCharge, refreshClientAggregates } from '../lib/aggregates';
import { recordChanges } from '../lib/changefeed';
import { badRequest, conflict, notFound } from '../lib/errors';
import { buildPage, cursorArgs, searchTerm } from '../lib/pagination';
import { decimalToMoneyStrict, type Prisma, prisma, toDecimal } from '../lib/prisma';
import { requirePermission, requireUser } from '../plugins/rbac';
import { chargeSelect, toChargeDTO } from './charge';

const utcDate = (d: Date): string => d.toISOString().slice(0, 10);

export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>();

  // ------------------------------------------------ histórico de pagamentos
  // Protótipo: `db.charges.flatMap(c => c.payments.map(...))`, que exigia ter
  // TODAS as cobranças em memória. Aqui é uma query paginada com include.
  route.get(
    '/',
    {
      preValidation: requirePermission('payment:read'),
      schema: {
        querystring: listPaymentQuerySchema,
        response: { 200: paginated(paymentHistoryItemSchema) },
      },
    },
    async (request) => {
      const { limit, cursor, q, clientId, from, to } = request.query;
      const term = searchTerm(q);

      const rows = await prisma.payment.findMany({
        where: {
          reversedAt: null,
          ...(clientId ? { charge: { clientId } } : {}),
          ...(from || to
            ? {
                paidAt: {
                  ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
                  ...(to ? { lte: new Date(`${to}T00:00:00.000Z`) } : {}),
                },
              }
            : {}),
          ...(term
            ? {
                OR: [
                  { charge: { code: { contains: term } } },
                  { charge: { client: { name: { contains: term } } } },
                ],
              }
            : {}),
        },
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
          charge: { select: { code: true, client: { select: { name: true } } } },
        },
        orderBy: [{ paidAt: 'desc' }, { id: 'asc' }],
        ...cursorArgs({ cursor, limit }),
      });

      return buildPage(rows, limit, (row): PaymentHistoryItem => ({
        id: row.id,
        chargeId: row.chargeId,
        amount: decimalToMoneyStrict(row.amount),
        paidAt: utcDate(row.paidAt),
        method: row.method,
        note: row.note,
        isSettlement: row.isSettlement,
        reversedAt: row.reversedAt === null ? null : row.reversedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        chargeCode: row.charge.code,
        clientName: row.charge.client.name,
      }));
    },
  );

  // ------------------------------------------------------------- estornar
  route.post(
    '/:id/reverse',
    {
      preValidation: requirePermission('payment:reverse'),
      schema: {
        params: idParamSchema,
        body: reversePaymentBodySchema,
        response: { 200: chargeSchema },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { id } = request.params;
      const now = new Date();

      const charge = await prisma.$transaction(async (tx) => {
        const payment = await tx.payment.findUnique({
          where: { id },
          select: { id: true, chargeId: true, reversedAt: true, amount: true },
        });
        if (!payment) throw notFound('Pagamento');
        if (payment.reversedAt !== null) throw conflict('Este pagamento já foi estornado.');

        await tx.payment.update({
          where: { id },
          data: {
            reversedAt: now,
            reversedById: user.id,
            reversalReason: request.body.reason,
          },
        });

        // No estorno, recontar do zero é mais seguro do que decrementar.
        await recalculateCharge(tx, payment.chargeId);

        const updated = await tx.charge.findUniqueOrThrow({
          where: { id: payment.chargeId },
          select: chargeSelect,
        });

        await refreshClientAggregates(tx, updated.clientId, now);

        await recordChanges(
          tx,
          [
            {
              entity: 'charge',
              entityId: updated.id,
              action: 'updated',
              clientScopeId: updated.clientId,
            },
            {
              entity: 'payment',
              entityId: id,
              action: 'updated',
              clientScopeId: updated.clientId,
            },
            {
              entity: 'client',
              entityId: updated.clientId,
              action: 'updated',
              clientScopeId: updated.clientId,
            },
          ],
          user.id,
        );

        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'payment.reverse',
            entity: 'payment',
            entityId: id,
            after: {
              amount: decimalToMoneyStrict(payment.amount),
              reason: request.body.reason,
            },
          },
        });

        return updated;
      });

      return toChargeDTO(charge);
    },
  );
}

/**
 * Registra um pagamento. Compartilhado entre "registrar" e "dar baixa".
 *
 * Devolve a cobrança já atualizada.
 */
async function registerPayment(
  chargeId: string,
  input: {
    amount: string;
    paidAt: string;
    method: Prisma.PaymentCreateInput['method'];
    note: string | null;
    isSettlement: boolean;
    userId: string;
  },
) {
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const charge = await tx.charge.findUnique({
      where: { id: chargeId },
      select: {
        id: true,
        code: true,
        clientId: true,
        total: true,
        paidAmount: true,
        balance: true,
        canceledAt: true,
      },
    });
    if (!charge) throw notFound('Cobrança');
    if (charge.canceledAt !== null) throw conflict('Cobrança cancelada não recebe pagamento.');

    const amount = toDecimal(input.amount);
    if (amount.lessThanOrEqualTo(0)) throw badRequest('O valor deve ser maior que zero.');

    // Mesma trava do protótipo: `amt <= bal`.
    if (amount.greaterThan(charge.balance)) {
      throw badRequest(
        `O valor não pode exceder o saldo em aberto de ${decimalToMoneyStrict(charge.balance)}.`,
      );
    }

    const payment = await tx.payment.create({
      data: {
        chargeId,
        amount,
        paidAt: new Date(`${input.paidAt}T00:00:00.000Z`),
        method: input.method,
        note: input.note,
        isSettlement: input.isSettlement,
        createdById: input.userId,
      },
      select: { id: true },
    });

    // Atômico: dois pagamentos simultâneos somam, não se sobrescrevem.
    const updated = await tx.charge.update({
      where: { id: chargeId },
      data: {
        paidAmount: { increment: amount },
        balance: { decrement: amount },
      },
      select: { total: true, paidAmount: true },
    });

    const status = settlementStatus({
      total: updated.total.toFixed(2),
      paidAmount: updated.paidAmount.toFixed(2),
    });

    await tx.charge.update({
      where: { id: chargeId },
      data: { status, settledAt: status === 'pago' ? now : null },
    });

    await refreshClientAggregates(tx, charge.clientId, now);

    await recordChanges(
      tx,
      [
        {
          entity: 'charge',
          entityId: chargeId,
          action: 'updated',
          clientScopeId: charge.clientId,
        },
        {
          entity: 'payment',
          entityId: payment.id,
          action: 'created',
          clientScopeId: charge.clientId,
        },
        {
          entity: 'client',
          entityId: charge.clientId,
          action: 'updated',
          clientScopeId: charge.clientId,
        },
      ],
      input.userId,
    );

    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: input.isSettlement ? 'charge.settle' : 'payment.create',
        entity: 'charge',
        entityId: chargeId,
        after: { amount: input.amount, method: input.method, status },
      },
    });

    return tx.charge.findUniqueOrThrow({ where: { id: chargeId }, select: chargeSelect });
  });
}

/** Registradas sob `/charges` porque o recurso pai é a cobrança. */
export async function chargePaymentRoutes(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.post(
    '/:id/payments',
    {
      preValidation: requirePermission('payment:create'),
      schema: {
        params: idParamSchema,
        body: createPaymentBodySchema,
        response: { 201: chargeSchema },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const body = request.body;

      const charge = await registerPayment(request.params.id, {
        amount: body.amount,
        paidAt: body.paidAt,
        method: body.method,
        note: body.note ?? null,
        isSettlement: false,
        userId: user.id,
      });

      void reply.status(201);
      return toChargeDTO(charge);
    },
  );

  // Baixa: quita o SALDO INTEIRO em um clique (protótipo: `darBaixa`).
  route.post(
    '/:id/settle',
    {
      preValidation: requirePermission('payment:settle'),
      schema: {
        params: idParamSchema,
        body: settleChargeBodySchema,
        response: { 200: chargeSchema },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const body = request.body;

      const current = await prisma.charge.findUnique({
        where: { id: request.params.id },
        select: { balance: true },
      });
      if (!current) throw notFound('Cobrança');
      if (current.balance.lessThanOrEqualTo(0)) throw conflict('Cobrança já está quitada.');

      const charge = await registerPayment(request.params.id, {
        amount: decimalToMoneyStrict(current.balance),
        paidAt: body.paidAt,
        method: body.method,
        note: body.note ?? 'Baixa manual (quitação total)',
        isSettlement: true,
        userId: user.id,
      });

      return toChargeDTO(charge);
    },
  );
}
