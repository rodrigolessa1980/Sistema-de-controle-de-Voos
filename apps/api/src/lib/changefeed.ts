/**
 * Change feed — motor do polling de 10 segundos (docs/PLANO.md §6).
 *
 * Toda mutação grava aqui uma linha, na MESMA transação da escrita. Se a
 * transação der rollback, o evento some junto — nunca existe aviso de algo que
 * não aconteceu.
 *
 * O cliente pergunta "o que mudou desde a sequência N?" e recebe só o delta.
 * Nada mudou → resposta de ~40 bytes numa busca por índice, em vez de rebaixar
 * todas as listas a cada 10 segundos.
 */

import type { ChangeAction, ChangeEntity } from '@acm/shared';

import type { Db } from './prisma';

export interface ChangeEvent {
  readonly entity: ChangeEntity;
  readonly entityId: string;
  readonly action: ChangeAction;
  /**
   * Escopo de visibilidade.
   *
   * `null`  → só perfis internos veem (ex.: mudança de aeronave ou tarifa).
   * preenchido → este cliente + internos (ex.: a cobrança dele mudou).
   *
   * É o que impede um cliente de descobrir, pelo feed, que existe atividade de
   * outro cliente.
   */
  readonly clientScopeId?: string | null | undefined;
}

/** Grava um lote de eventos. Um único INSERT, mesmo com vários eventos. */
export async function recordChanges(
  tx: Db,
  events: readonly ChangeEvent[],
  actorId?: string | null,
): Promise<void> {
  if (events.length === 0) return;

  await tx.changeFeed.createMany({
    data: events.map((event) => ({
      entity: event.entity,
      entityId: event.entityId,
      action: event.action,
      clientScopeId: event.clientScopeId ?? null,
      actorId: actorId ?? null,
    })),
  });
}

export async function recordChange(
  tx: Db,
  event: ChangeEvent,
  actorId?: string | null,
): Promise<void> {
  await recordChanges(tx, [event], actorId);
}
