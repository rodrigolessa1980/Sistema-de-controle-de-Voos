/**
 * Paginação por cursor.
 *
 * Cursor em vez de `OFFSET` por dois motivos: `OFFSET 10000` faz o MySQL varrer
 * e descartar 10.000 linhas, e uma inserção entre duas páginas desloca tudo,
 * fazendo o usuário ver o mesmo item duas vezes (ou nunca).
 *
 * Uso: peça `take + 1` registros. Se vier o extra, há próxima página e o cursor
 * é o id do último item devolvido.
 */

export interface CursorPage<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
}

/**
 * Traduz `{ cursor, limit }` nos argumentos do Prisma.
 *
 * O retorno é uma UNIÃO em vez de um objeto com `cursor?: ... | undefined`
 * porque o projeto roda com `exactOptionalPropertyTypes`: sob essa flag,
 * `{ cursor: undefined }` não é o mesmo que omitir a chave, e o Prisma só aceita
 * a chave ausente. Na primeira página, portanto, a chave não existe.
 */
export type CursorArgs =
  | { readonly take: number }
  | { readonly take: number; readonly skip: number; readonly cursor: { id: string } };

export function cursorArgs(input: { cursor?: string | undefined; limit: number }): CursorArgs {
  if (input.cursor === undefined) return { take: input.limit + 1 };
  return { take: input.limit + 1, skip: 1, cursor: { id: input.cursor } };
}

/** Corta o registro-sentinela e devolve o cursor da próxima página. */
export function buildPage<T extends { id: string }, R>(
  rows: T[],
  limit: number,
  map: (row: T) => R,
): CursorPage<R> {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);

  return {
    items: page.map(map),
    nextCursor: hasMore && last ? last.id : null,
  };
}

/**
 * Termos de busca para um `OR` de `contains`.
 *
 * Substitui o `[a, b, c].join(' ').toLowerCase().includes(q)` que o protótipo
 * fazia em memória — agora é `WHERE` indexável no banco.
 */
export function searchTerm(q: string | undefined): string | undefined {
  const trimmed = q?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}
