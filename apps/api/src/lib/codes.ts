/**
 * Códigos sequenciais: VOO-2041, SOL-1180, COB-3301.
 *
 * O protótipo usava `counters = useRef({ trip: 2050, req: 1190, charge: 3310 })`
 * — um contador em memória, por aba do navegador. Com duas pessoas agendando ao
 * mesmo tempo, duas viagens sairiam com o mesmo código.
 *
 * Aqui o incremento é um `UPDATE ... SET current = current + 1` atômico, feito
 * DENTRO da transação de quem chama. O InnoDB segura a linha até o commit,
 * então dois processos concorrentes serializam e nunca repetem número. E se a
 * transação der rollback, o código volta junto — sem buraco na numeração.
 */

import type { Db } from './prisma';

export type SequenceKey = 'trip' | 'request' | 'charge';

export const SEQUENCE_PREFIXES: Record<SequenceKey, string> = {
  trip: 'VOO',
  request: 'SOL',
  charge: 'COB',
};

/** Valores iniciais: continuam de onde a numeração do protótipo parou. */
export const SEQUENCE_SEEDS: Record<SequenceKey, number> = {
  trip: 2050,
  request: 1190,
  charge: 3310,
};

/**
 * Reserva o próximo código. DEVE ser chamado dentro de uma transação — passe o
 * `tx`, não o client global, senão a atomicidade se perde.
 */
export async function nextCode(tx: Db, key: SequenceKey): Promise<string> {
  const updated = await tx.codeSequence.update({
    where: { key },
    data: { current: { increment: 1 } },
    select: { prefix: true, current: true, padding: true },
  });

  // `update` lança P2025 quando a sequência não existe — o handler global
  // traduz para 404. Não há caminho em que `updated` volte nulo.

  return `${updated.prefix}-${String(updated.current).padStart(updated.padding, '0')}`;
}
