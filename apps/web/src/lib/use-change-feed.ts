/**
 * Polling de 10 segundos (docs/PLANO.md §6).
 *
 * UMA requisição a cada 10s para o app inteiro, independente de quantas telas
 * estejam abertas. Ela pergunta "o que mudou desde a sequência N?" e invalida
 * SÓ os caches afetados.
 *
 * O caminho ingênuo — cada tela com `refetchInterval: 10_000` — multiplicaria a
 * requisição por tela e traria o dataset completo toda vez, mesmo sem nada ter
 * mudado. Aqui, se nada mudou, a resposta tem ~40 bytes.
 *
 * Detalhes que importam:
 *   - a aba oculta não faz polling (`refetchIntervalInBackground: false`), e ao
 *     voltar o foco o TanStack Query refaz a busca na hora;
 *   - `reset: true` (cursor antigo demais) recarrega tudo;
 *   - o cursor vive num ref, não em estado, para não re-renderizar a árvore a
 *     cada ciclo.
 */

import type { ChangesResponse } from '@acm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';

import { api } from './api';
import { ENTITY_INVALIDATIONS } from './query-keys';

export const POLL_INTERVAL_MS = 10_000;

export function useChangeFeed(enabled: boolean): void {
  const queryClient = useQueryClient();
  const cursor = useRef<string | null>(null);

  useQuery({
    queryKey: ['change-feed'],
    enabled,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    // O feed é sempre volátil: nunca servir do cache.
    staleTime: 0,
    gcTime: 0,
    retry: 1,

    queryFn: async (): Promise<ChangesResponse> => {
      const response = await api.get<ChangesResponse>(
        '/changes',
        cursor.current === null ? undefined : { since: cursor.current },
      );

      cursor.current = response.seq;

      if (response.reset) {
        // Cursor mais antigo que o feed retido: o delta seria incompleto, então
        // recarrega tudo em vez de mostrar dado furado.
        await queryClient.invalidateQueries();
        return response;
      }

      if (response.changes.length === 0) return response;

      // Deduplica os prefixos antes de invalidar: dez pagamentos na mesma
      // cobrança viram uma invalidação de `charges`, não dez.
      const prefixes = new Map<string, readonly string[]>();

      for (const change of response.changes) {
        for (const key of ENTITY_INVALIDATIONS[change.entity]) {
          prefixes.set(key.join('|'), key);
        }
      }

      await Promise.all(
        [...prefixes.values()].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey: [...queryKey] }),
        ),
      );

      return response;
    },
  });
}
