/**
 * Relatórios financeiros — protótipo: `FinRelatorios`.
 *
 * Os três gráficos do protótipo eram montados percorrendo o banco inteiro em
 * JavaScript:
 *
 *   monthly  → `db.charges.forEach(c => c.payments.forEach(...))`
 *   byStatus → `db.charges.forEach(c => m[chStatus(c)]++)`
 *   top      → `db.clients.map(c => clientBalance(c.id, db.charges))`
 *
 * Aqui os três são agregação no banco: um `groupBy` para os recebimentos por
 * mês, um `groupBy` para a distribuição por status, e um `orderBy` sobre a
 * coluna denormalizada para o ranking. Nenhum dado bruto sobe para a aplicação.
 */

import { financialReportSchema, type FinancialReport } from '@acm/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { decimalToMoneyStrict, Prisma, prisma } from '../lib/prisma';
import { requirePermission } from '../plugins/rbac';

const money = (d: Prisma.Decimal | null): string => (d === null ? '0.00' : d.toFixed(2));

/**
 * Linha do `groupBy` de recebimentos por mês, vinda de SQL cru.
 *
 * `y` e `m` são `bigint`, não `number`: o MySQL devolve o resultado de `YEAR()`
 * e `MONTH()` como BIGINT, e o Prisma preserva isso fielmente no `$queryRaw`.
 * Declará-los como `number` era mentira que o compilador aceitava — só o schema
 * de resposta percebia, em tempo de execução, e a rota inteira virava 500.
 */
interface MonthlyRow {
  y: bigint;
  m: bigint;
  amount: Prisma.Decimal;
}

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.get(
    '/financial',
    {
      preValidation: requirePermission('report:financial'),
      schema: { response: { 200: financialReportSchema } },
    },
    async () => {
      const [invoiced, receivedTotal, delinquent, byStatusRows, topDebtors, monthly] =
        await Promise.all([
          prisma.charge.aggregate({ where: { canceledAt: null }, _sum: { total: true } }),
          prisma.payment.aggregate({ where: { reversedAt: null }, _sum: { amount: true } }),
          prisma.client.count({ where: { deletedAt: null, openBalance: { gt: 0 } } }),
          prisma.charge.groupBy({
            by: ['status'],
            where: { canceledAt: null },
            _count: { _all: true },
          }),
          prisma.client.findMany({
            where: { deletedAt: null, openBalance: { gt: 0 } },
            select: { id: true, name: true, openBalance: true },
            orderBy: { openBalance: 'desc' },
            take: 5,
          }),
          // Agrupamento por ano/mês precisa de função de data, que o `groupBy`
          // do Prisma não expressa. SQL cru, sem interpolação de entrada.
          prisma.$queryRaw<MonthlyRow[]>`
            SELECT YEAR(paid_at) AS y, MONTH(paid_at) AS m, SUM(amount) AS amount
            FROM payments
            WHERE reversed_at IS NULL
            GROUP BY YEAR(paid_at), MONTH(paid_at)
            ORDER BY y ASC, m ASC
            LIMIT 24
          `,
        ]);

      const result: FinancialReport = {
        totalInvoiced: money(invoiced._sum.total),
        totalReceived: money(receivedTotal._sum.amount),
        delinquentClients: delinquent,
        monthlyReceipts: monthly.map((row) => ({
          // Number() é seguro aqui: ano e mês cabem folgadamente num double.
          year: Number(row.y),
          month: Number(row.m),
          amount: new Prisma.Decimal(row.amount).toFixed(2),
        })),
        byStatus: byStatusRows.map((row) => ({
          status: row.status,
          count: row._count._all,
        })),
        topDebtors: topDebtors.map((client) => ({
          clientId: client.id,
          name: client.name,
          balance: decimalToMoneyStrict(client.openBalance),
        })),
      };

      return result;
    },
  );
}
