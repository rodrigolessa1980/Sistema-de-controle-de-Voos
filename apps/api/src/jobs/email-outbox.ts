/**
 * Worker da fila de e-mail (docs/PLANO.md §13.2).
 *
 * Roda a cada 30 segundos: busca o que está pendente e vencido, entrega, e no
 * erro aplica backoff exponencial (1min, 4min, 15min, 1h, 4h). Depois de
 * `maxAttempts`, marca `falhou` — o problema fica visível em vez de sumir.
 *
 * Enquanto não houver provedor contratado (`MAIL_API_KEY` vazia), roda em
 * dry-run: registra no log o que seria enviado e marca como enviado, para a fila
 * não acumular falha por uma decisão que ainda não foi tomada.
 */

import type { FastifyBaseLogger } from 'fastify';

import { env, mailIsDryRun } from '../env';
import { deliver, nextAttemptDelayMs, renderTemplate, type TemplateName } from '../lib/mailer';
import { prisma } from '../lib/prisma';

const MAX_PER_CYCLE = 50;

export async function dispatchEmailOutbox(log: FastifyBaseLogger): Promise<number> {
  const now = new Date();

  const pending = await prisma.emailOutbox.findMany({
    where: { status: 'pendente', nextAttemptAt: { lte: now } },
    select: {
      id: true,
      dedupeKey: true,
      recipients: true,
      subject: true,
      template: true,
      payload: true,
      replyTo: true,
      attempts: true,
      maxAttempts: true,
    },
    orderBy: { nextAttemptAt: 'asc' },
    take: MAX_PER_CYCLE,
  });

  if (pending.length === 0) return 0;

  let sent = 0;

  for (const message of pending) {
    /**
     * Reivindica a mensagem com um UPDATE condicional.
     *
     * O `where` inclui `status: 'pendente'`, então se outra instância já pegou
     * esta linha, `count` volta 0 e esta instância segue adiante. É o que impede
     * envio duplicado quando há mais de um processo rodando.
     */
    const claimed = await prisma.emailOutbox.updateMany({
      where: { id: message.id, status: 'pendente' },
      data: { status: 'enviando', attempts: { increment: 1 } },
    });

    if (claimed.count === 0) continue;

    const attempts = message.attempts + 1;

    try {
      const payload =
        typeof message.payload === 'object' && message.payload !== null
          ? (message.payload as Record<string, unknown>)
          : {};

      const rendered = renderTemplate(message.template as TemplateName, payload);
      const recipients = message.recipients.split(',').filter(Boolean);

      if (mailIsDryRun) {
        log.warn(
          {
            dedupeKey: message.dedupeKey,
            recipients,
            subject: rendered.subject,
            provider: env.MAIL_PROVIDER,
          },
          'MAIL_DRY_RUN: e-mail NÃO enviado (defina MAIL_API_KEY para enviar de verdade)',
        );
      }

      const result = await deliver(recipients, rendered, message.replyTo);

      if (result.ok) {
        await prisma.emailOutbox.update({
          where: { id: message.id },
          data: {
            status: 'enviado',
            sentAt: new Date(),
            providerMessageId: result.providerMessageId ?? null,
            lastError: null,
          },
        });
        sent += 1;
        log.info(
          { dedupeKey: message.dedupeKey, recipients: recipients.length },
          'e-mail entregue',
        );
        continue;
      }

      await handleFailure(
        message.id,
        attempts,
        message.maxAttempts,
        result.error ?? 'erro desconhecido',
        log,
        message.dedupeKey,
      );
    } catch (error) {
      await handleFailure(
        message.id,
        attempts,
        message.maxAttempts,
        error instanceof Error ? error.message : String(error),
        log,
        message.dedupeKey,
      );
    }
  }

  return sent;
}

async function handleFailure(
  id: string,
  attempts: number,
  maxAttempts: number,
  error: string,
  log: FastifyBaseLogger,
  dedupeKey: string,
): Promise<void> {
  const exhausted = attempts >= maxAttempts;

  await prisma.emailOutbox.update({
    where: { id },
    data: {
      status: exhausted ? 'falhou' : 'pendente',
      lastError: error.slice(0, 2000),
      nextAttemptAt: exhausted ? new Date() : new Date(Date.now() + nextAttemptDelayMs(attempts)),
    },
  });

  if (exhausted) {
    // Nível error de propósito: chegou aqui, alguém precisa olhar.
    log.error(
      { dedupeKey, attempts, error },
      'e-mail descartado após esgotar as tentativas — aviso NÃO entregue',
    );
  } else {
    log.warn({ dedupeKey, attempts, error }, 'falha ao enviar e-mail; será tentado de novo');
  }
}
