/**
 * Cliente Prisma e utilidades de transação.
 *
 * O `queryBudget` é a rede de proteção contra N+1: em desenvolvimento e teste,
 * conta as queries de cada requisição e grita quando passa do orçamento. Isso
 * transforma "cuidado com N+1" de recomendação de code review em algo que falha
 * o teste (docs/PLANO.md §7.1).
 */

import { Prisma, PrismaClient } from '@prisma/client';

import { env, isProduction } from '../env';

export type Tx = Prisma.TransactionClient;

/** Aceita o client normal ou o de dentro de uma transação. */
export type Db = PrismaClient | Tx;

const logLevels: Prisma.LogLevel[] = isProduction ? ['warn', 'error'] : ['warn', 'error', 'query'];

export const prisma = new PrismaClient({
  log: logLevels.map((level) => ({ emit: 'event', level })),
  datasources: { db: { url: env.DATABASE_URL } },

  /**
   * O padrão do Prisma para transação interativa é 5s, calibrado para um banco
   * local. Aqui o MySQL é remoto: cada ida e volta custa latência de rede, e
   * agendar uma viagem faz ~10 comandos dentro da transação (conflito de agenda,
   * código sequencial, viagem, passageiros, agregados do cliente, change feed,
   * auditoria). Em 5s isso estoura e a operação falha com "Transaction already
   * closed" — sem nada de errado no domínio.
   *
   * 20s dá folga confortável sem esconder transação genuinamente travada.
   * `maxWait` é quanto se espera por uma conexão livre no pool.
   */
  transactionOptions: {
    timeout: 20_000,
    maxWait: 8_000,
  },
});

// --------------------------------------------------------------- contador N+1

let queryCounter: { count: number; label: string } | null = null;

prisma.$on('query', () => {
  if (queryCounter) queryCounter.count += 1;
});

/**
 * Executa `fn` contando as queries emitidas e lança se passar de `budget`.
 *
 * Só é usado em teste. Em produção o custo do contador não se justifica, e a
 * regra já foi verificada na suíte.
 */
export async function withQueryBudget<T>(
  label: string,
  budget: number,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = queryCounter;
  queryCounter = { count: 0, label };
  try {
    const result = await fn();
    const used = queryCounter.count;
    if (used > budget) {
      throw new Error(
        `Orçamento de queries excedido em "${label}": ${used} queries (máximo ${budget}). ` +
          `Provável N+1 — use include/select ou where: { id: { in: [...] } }.`,
      );
    }
    return result;
  } finally {
    queryCounter = previous;
  }
}

// ------------------------------------------------------------------ helpers

/** Converte `Prisma.Decimal` (ou nulo) para a string decimal da API. */
export function decimalToMoney(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toFixed(2);
}

/** Idem, mas nunca nulo — para colunas com `@default(0)`. */
export function decimalToMoneyStrict(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

export function toDecimal(value: string | number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

/** `Decimal` só quando o valor existe — respeita `exactOptionalPropertyTypes`. */
export function toDecimalOrNull(value: string | number | null | undefined): Prisma.Decimal | null {
  if (value === null || value === undefined || value === '') return null;
  return new Prisma.Decimal(value);
}

export { Prisma };

/** Código do MySQL/Prisma para violação de índice único. */
export const UNIQUE_VIOLATION = 'P2002';

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION;
}

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}
