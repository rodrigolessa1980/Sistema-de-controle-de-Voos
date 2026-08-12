/**
 * Jobs em lote (docs/PLANO.md §7.2).
 *
 * Todos processam em blocos de `BATCH_SIZE`, com cursor. Nunca um `updateMany`
 * sobre a tabela inteira: em produção isso segura linhas por tempo demais e
 * bloqueia escrita concorrente.
 *
 * Todos são idempotentes — rodar duas vezes dá o mesmo resultado.
 */

import { INACTIVE_TRIP_STATUSES } from '@acm/shared';
import { unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import * as cron from 'node-cron';
import type { FastifyBaseLogger } from 'fastify';

import { env } from '../env';
import { Prisma, prisma } from '../lib/prisma';
import { dispatchEmailOutbox } from './email-outbox';

/**
 * Marca como `vencido` toda cobrança que passou do vencimento e ainda tem saldo.
 *
 * É o que mantém `chStatus` correto sem depender de leitura: o status depende do
 * relógio, então nenhuma mutação de negócio o dispara.
 */
export async function refreshOverdueCharges(log: FastifyBaseLogger): Promise<number> {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  let total = 0;

  for (;;) {
    const batch = await prisma.charge.findMany({
      where: {
        canceledAt: null,
        balance: { gt: 0 },
        dueDate: { lt: today },
        status: { in: ['pendente', 'parcial'] },
      },
      select: { id: true, clientId: true },
      take: env.BATCH_SIZE,
    });

    if (batch.length === 0) break;

    const ids = batch.map((c) => c.id);
    const clientIds = [...new Set(batch.map((c) => c.clientId))];

    await prisma.$transaction([
      prisma.charge.updateMany({ where: { id: { in: ids } }, data: { status: 'vencido' } }),
      // Marca os clientes afetados como vencido em um comando, não um por um.
      prisma.client.updateMany({
        where: { id: { in: clientIds } },
        data: { financialStatus: 'vencido' },
      }),
      prisma.changeFeed.createMany({
        data: batch.map((charge) => ({
          entity: 'charge',
          entityId: charge.id,
          action: 'updated' as const,
          clientScopeId: charge.clientId,
        })),
      }),
    ]);

    total += batch.length;

    // Menos que um bloco cheio: acabou.
    if (batch.length < env.BATCH_SIZE) break;
  }

  if (total > 0) log.info({ total }, 'cobranças marcadas como vencidas');
  return total;
}

/**
 * Reprocessa os agregados de todos os clientes.
 *
 * É a rede de segurança do cálculo transacional: se algum caminho de escrita
 * esquecer de chamar `refreshClientAggregates`, a divergência dura minutos em
 * vez de para sempre.
 *
 * Faz um `groupBy` por bloco de clientes em vez de recalcular cliente a cliente
 * — o que seria exatamente o N+1 que este sistema evita.
 */
export async function refreshClientAggregatesBatch(log: FastifyBaseLogger): Promise<number> {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  let cursor: string | undefined;
  let processed = 0;

  for (;;) {
    const clients = await prisma.client.findMany({
      where: { deletedAt: null },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: env.BATCH_SIZE,
      ...(cursor === undefined ? {} : { skip: 1, cursor: { id: cursor } }),
    });

    if (clients.length === 0) break;

    const ids = clients.map((c) => c.id);

    // 4 agregações para o bloco inteiro, não 4 por cliente.
    const [totals, overdue, tripCounts] = await Promise.all([
      prisma.charge.groupBy({
        by: ['clientId'],
        where: { clientId: { in: ids }, canceledAt: null },
        _sum: { balance: true, total: true, paidAmount: true },
      }),
      prisma.charge.groupBy({
        by: ['clientId'],
        where: {
          clientId: { in: ids },
          canceledAt: null,
          balance: { gt: 0 },
          dueDate: { lt: today },
        },
        _sum: { balance: true },
      }),
      prisma.trip.groupBy({
        by: ['clientId'],
        where: { clientId: { in: ids }, status: { notIn: [...INACTIVE_TRIP_STATUSES] } },
        _count: { _all: true },
      }),
    ]);

    const totalsMap = new Map(totals.map((t) => [t.clientId, t]));
    const overdueMap = new Map(overdue.map((o) => [o.clientId, o]));
    const tripMap = new Map(tripCounts.map((t) => [t.clientId, t._count._all]));

    const zero = new Prisma.Decimal(0);

    await prisma.$transaction(
      ids.map((clientId) => {
        const t = totalsMap.get(clientId);
        const o = overdueMap.get(clientId);

        const openBalance = t?._sum.balance ?? zero;
        const overdueBalance = o?._sum.balance ?? zero;

        const financialStatus = overdueBalance.greaterThan(0)
          ? 'vencido'
          : openBalance.greaterThan(0)
            ? 'pendente'
            : 'em_dia';

        return prisma.client.update({
          where: { id: clientId },
          data: {
            openBalance,
            overdueBalance,
            totalInvoiced: t?._sum.total ?? zero,
            totalPaid: t?._sum.paidAmount ?? zero,
            financialStatus,
            tripCount: tripMap.get(clientId) ?? 0,
            aggregatesAt: now,
          },
        });
      }),
    );

    processed += clients.length;
    cursor = clients.at(-1)?.id;

    if (clients.length < env.BATCH_SIZE) break;
  }

  log.debug({ processed }, 'agregados de clientes recalculados');
  return processed;
}

/** Poda o change feed. Sem isso ele cresce para sempre. */
export async function pruneChangeFeed(log: FastifyBaseLogger): Promise<number> {
  const cutoff = new Date(Date.now() - env.CHANGE_FEED_RETENTION_HOURS * 3_600_000);

  let total = 0;
  for (;;) {
    // `deleteMany` com limite por bloco: apagar 500 mil linhas de uma vez
    // seguraria a tabela e travaria o polling de todos.
    const batch = await prisma.changeFeed.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { seq: true },
      orderBy: { seq: 'asc' },
      take: env.BATCH_SIZE,
    });

    if (batch.length === 0) break;

    const lastSeq = batch.at(-1)?.seq;
    if (lastSeq === undefined) break;

    const { count } = await prisma.changeFeed.deleteMany({
      where: { seq: { lte: lastSeq }, createdAt: { lt: cutoff } },
    });

    total += count;
    if (batch.length < env.BATCH_SIZE) break;
  }

  if (total > 0) log.info({ total }, 'eventos antigos removidos do change feed');
  return total;
}

/**
 * Expurgo de documentos de passageiro além da retenção.
 *
 * Obrigação de LGPD, não faxina de disco: são documentos de identificação de
 * terceiros. Apaga o arquivo e marca o registro; o vínculo com o passageiro fica
 * com `documentFileId` nulo (`onDelete: SetNull`).
 */
export async function purgeExpiredDocuments(log: FastifyBaseLogger): Promise<number> {
  const uploadRoot = resolve(process.cwd(), env.UPLOAD_DIR);

  const now = new Date();
  let total = 0;

  for (;;) {
    const batch = await prisma.documentFile.findMany({
      where: { deletedAt: null, purgeAfter: { lt: now } },
      select: { id: true, storageKey: true },
      take: env.BATCH_SIZE,
    });

    if (batch.length === 0) break;

    for (const doc of batch) {
      // Arquivo já ausente não é erro: o objetivo é que ele não exista.
      await unlink(join(uploadRoot, doc.storageKey)).catch(() => undefined);
    }

    await prisma.documentFile.updateMany({
      where: { id: { in: batch.map((d) => d.id) } },
      data: { deletedAt: now },
    });

    total += batch.length;
    if (batch.length < env.BATCH_SIZE) break;
  }

  if (total > 0) log.info({ total }, 'documentos expurgados por retenção (LGPD)');
  return total;
}

/** Revoga refresh tokens expirados. */
export async function pruneRefreshTokens(log: FastifyBaseLogger): Promise<number> {
  const { count } = await prisma.refreshToken.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 7 * 86_400_000) } },
  });
  if (count > 0) log.debug({ count }, 'refresh tokens expirados removidos');
  return count;
}

// ============================================================================
//  AGENDAMENTO
// ============================================================================

interface ScheduledTask {
  stop: () => void;
}

/**
 * Registra os cron jobs.
 *
 * `runExclusive` impede sobreposição: se um job demorar mais que o intervalo, a
 * próxima execução é ignorada em vez de rodar em paralelo com a anterior.
 */
export function startJobs(log: FastifyBaseLogger): ScheduledTask[] {
  if (!env.JOBS_ENABLED) {
    log.warn('JOBS_ENABLED=false — nenhum job em lote foi agendado');
    return [];
  }

  const running = new Set<string>();

  const runExclusive = (name: string, fn: () => Promise<unknown>) => async (): Promise<void> => {
    if (running.has(name)) {
      log.warn({ job: name }, 'execução anterior ainda em andamento — ciclo ignorado');
      return;
    }
    running.add(name);
    const started = Date.now();
    try {
      await fn();
    } catch (error) {
      log.error({ err: error, job: name }, 'job falhou');
    } finally {
      running.delete(name);
      log.debug({ job: name, ms: Date.now() - started }, 'job concluído');
    }
  };

  /**
   * O `node-cron` espera um callback SÍNCRONO.
   *
   * Passar a função async direto entregaria uma promise que ninguém aguarda —
   * um erro dentro dela viraria rejeição não tratada e derrubaria o processo.
   * Aqui o `void` é deliberado: `runExclusive` já captura e loga toda exceção,
   * então não há como escapar nada.
   */
  const every = (expression: string, name: string, fn: () => Promise<unknown>): ScheduledTask =>
    cron.schedule(expression, () => {
      void runExclusive(name, fn)();
    });

  const tasks: ScheduledTask[] = [
    // A cada 30s: entrega a fila de e-mail (aviso de nova solicitação).
    every('*/30 * * * * *', 'email-outbox', () => dispatchEmailOutbox(log)),
    every('*/5 * * * *', 'overdue', () => refreshOverdueCharges(log)),
    every('*/10 * * * *', 'aggregates', () => refreshClientAggregatesBatch(log)),
    every('0 * * * *', 'prune-feed', () => pruneChangeFeed(log)),
    every('0 3 * * *', 'purge-documents', () => purgeExpiredDocuments(log)),
    every('30 3 * * *', 'prune-tokens', () => pruneRefreshTokens(log)),
  ];

  log.info({ jobs: tasks.length }, 'jobs em lote agendados');
  return tasks;
}
