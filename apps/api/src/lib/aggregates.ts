/**
 * Agregados denormalizados do cliente — o coração do "sem N+1".
 *
 * O protótipo calculava `clientBalance` e `clientFin` varrendo TODAS as
 * cobranças, uma vez por linha da tabela de clientes. Em SQL isso seria uma
 * query por linha; com 10 clientes na tela, 10 queries; com 500, 500.
 *
 * Aqui os valores são colunas em `Client`, atualizadas na mesma transação da
 * mutação que as afeta (docs/PLANO.md §7.1). A listagem passa a ser um único
 * SELECT, para qualquer volume.
 *
 * O job `refreshClientAggregates` reprocessa tudo em lote como rede de
 * segurança — se algum caminho de escrita esquecer de chamar isto, a divergência
 * dura minutos, não para sempre.
 */

import {
  clientFinancialStatus,
  INACTIVE_TRIP_STATUSES,
  type ClientFinancialStatus,
} from '@acm/shared';

import { Prisma, type Db } from './prisma';

export interface ClientAggregates {
  readonly openBalance: Prisma.Decimal;
  readonly overdueBalance: Prisma.Decimal;
  readonly totalInvoiced: Prisma.Decimal;
  readonly totalPaid: Prisma.Decimal;
  readonly financialStatus: ClientFinancialStatus;
  readonly tripCount: number;
}

/**
 * Recalcula e grava os agregados de UM cliente.
 *
 * Custo fixo: 2 queries (cobranças + contagem de viagens), independente de
 * quantas cobranças o cliente tem.
 */
export async function refreshClientAggregates(
  tx: Db,
  clientId: string,
  now: Date,
): Promise<ClientAggregates> {
  const [charges, tripCount] = await Promise.all([
    tx.charge.findMany({
      where: { clientId, canceledAt: null },
      select: { total: true, paidAmount: true, balance: true, dueDate: true },
    }),
    tx.trip.count({
      where: { clientId, status: { notIn: [...INACTIVE_TRIP_STATUSES] } },
    }),
  ]);

  let openBalance = new Prisma.Decimal(0);
  let overdueBalance = new Prisma.Decimal(0);
  let totalInvoiced = new Prisma.Decimal(0);
  let totalPaid = new Prisma.Decimal(0);

  for (const charge of charges) {
    openBalance = openBalance.add(charge.balance);
    totalInvoiced = totalInvoiced.add(charge.total);
    totalPaid = totalPaid.add(charge.paidAmount);
  }

  // A regra de "vencido" vive em @acm/shared e é a mesma do frontend.
  const forStatus = charges.map((c) => ({
    total: c.total.toFixed(2),
    paidAmount: c.paidAmount.toFixed(2),
    dueDate: c.dueDate,
  }));

  const financialStatus = clientFinancialStatus(forStatus, now);

  for (const charge of charges) {
    const isOverdue = now.getTime() > endOfDayUtc(charge.dueDate).getTime();
    if (isOverdue && charge.balance.greaterThan(0)) {
      overdueBalance = overdueBalance.add(charge.balance);
    }
  }

  const aggregates: ClientAggregates = {
    openBalance,
    overdueBalance,
    totalInvoiced,
    totalPaid,
    financialStatus,
    tripCount,
  };

  await tx.client.update({
    where: { id: clientId },
    data: { ...aggregates, aggregatesAt: now },
  });

  return aggregates;
}

/** Duplicado local de `endOfUtcDay` para não converter Date→string→Date. */
function endOfDayUtc(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999),
  );
}

/**
 * Recalcula o `balance` e o `status` de uma cobrança a partir dos pagamentos
 * não estornados.
 *
 * `paidAmount` é normalmente mantido por `increment`/`decrement` atômico. Esta
 * função é a reconciliação — usada no estorno e no job em lote, onde recontar do
 * zero é mais seguro do que confiar no acumulado.
 */
export async function recalculateCharge(
  tx: Db,
  chargeId: string,
): Promise<{ paidAmount: Prisma.Decimal; balance: Prisma.Decimal }> {
  const [charge, sum] = await Promise.all([
    tx.charge.findUniqueOrThrow({ where: { id: chargeId }, select: { total: true } }),
    tx.payment.aggregate({
      where: { chargeId, reversedAt: null },
      _sum: { amount: true },
    }),
  ]);

  const paidAmount = sum._sum.amount ?? new Prisma.Decimal(0);
  const rawBalance = charge.total.sub(paidAmount);
  const balance = rawBalance.isNegative() ? new Prisma.Decimal(0) : rawBalance;

  const status =
    paidAmount.greaterThanOrEqualTo(charge.total) && charge.total.greaterThan(0)
      ? 'pago'
      : paidAmount.greaterThan(0)
        ? 'parcial'
        : 'pendente';

  await tx.charge.update({
    where: { id: chargeId },
    data: {
      paidAmount,
      balance,
      status,
      settledAt: status === 'pago' ? new Date() : null,
    },
  });

  return { paidAmount, balance };
}
