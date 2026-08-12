/**
 * Validação de formulário com o MESMO schema Zod que o backend usa.
 *
 * O problema que isto resolve: se o front tem a própria regra ("nome com 2+
 * caracteres") e o back tem outra ("min(2) mais trim"), elas divergem no
 * primeiro ajuste que alguém fizer só de um lado. O usuário então preenche um
 * formulário que parece válido, clica em salvar e leva 422 — sem saber por quê,
 * porque a mensagem do servidor não está ligada a nenhum campo da tela.
 *
 * Aqui o formulário roda `schema.safeParse(body)` ANTES de enviar. É
 * literalmente o mesmo objeto de `@acm/shared` que a rota do Fastify usa como
 * `schema.body`. Se passar aqui, passa lá.
 *
 * O servidor continua validando — o front é conveniência, não segurança. Mas
 * uma requisição que o back vai recusar não sai mais do navegador.
 */

import { useCallback, useState } from 'react';
import type { z } from 'zod';

/** Erros por caminho de campo: `{ origin: 'Informe a origem' }`. */
export type FieldErrors = Record<string, string>;

/**
 * Converte o `ZodError` em mapa de campo → mensagem.
 *
 * Erro em campo aninhado (`pax.0.name`) vira a chave completa E também uma
 * chave de raiz (`pax`), para que o formulário possa mostrar a mensagem tanto
 * no item específico quanto no bloco inteiro.
 */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};

  for (const issue of error.issues) {
    const path = issue.path.join('.');
    // A primeira mensagem de cada campo é a que vale: as seguintes costumam ser
    // consequência da mesma causa.
    if (path !== '' && !(path in errors)) errors[path] = issue.message;

    const root = issue.path[0];
    if (typeof root === 'string' && !(root in errors)) errors[root] = issue.message;

    if (path === '') errors['_form'] = issue.message;
  }

  return errors;
}

export type ValidationResult<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly errors: FieldErrors };

/** Valida um corpo contra o contrato do backend. */
export function validateBody<S extends z.ZodTypeAny>(
  schema: S,
  body: unknown,
): ValidationResult<z.output<S>> {
  const result = schema.safeParse(body);
  if (result.success) return { ok: true, data: result.data as z.output<S> };
  return { ok: false, errors: toFieldErrors(result.error) };
}

/**
 * Estado de erros de um formulário.
 *
 * Junta duas origens no mesmo mapa:
 *   - o que o Zod recusou antes de enviar;
 *   - o que o servidor devolveu em `details` num 422 (caso alguma regra só
 *     exista no servidor, como unicidade de e-mail).
 *
 * Assim o campo errado fica destacado em ambos os casos, e não só num toast.
 */
export function useFormErrors(): {
  errors: FieldErrors;
  setErrors: (errors: FieldErrors) => void;
  setServerErrors: (details: unknown) => void;
  clearError: (field: string) => void;
  clearAll: () => void;
  errorOf: (field: string) => string | undefined;
} {
  const [errors, setErrors] = useState<FieldErrors>({});

  const setServerErrors = useCallback((details: unknown): void => {
    if (!Array.isArray(details)) return;

    const next: FieldErrors = {};
    for (const item of details) {
      if (
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { path?: unknown }).path === 'string' &&
        typeof (item as { message?: unknown }).message === 'string'
      ) {
        const { path, message } = item as { path: string; message: string };
        if (!(path in next)) next[path] = message;

        const root = path.split('.')[0];
        if (root !== undefined && !(root in next)) next[root] = message;
      }
    }

    if (Object.keys(next).length > 0) setErrors(next);
  }, []);

  const clearError = useCallback((field: string): void => {
    setErrors((current) => {
      if (!(field in current)) return current;
      // Reconstrói sem a chave em vez de `delete`: a forma do objeto fica
      // estável, o que ajuda o motor a manter a mesma hidden class.
      return Object.fromEntries(Object.entries(current).filter(([key]) => key !== field));
    });
  }, []);

  const clearAll = useCallback((): void => {
    setErrors({});
  }, []);

  const errorOf = useCallback((field: string): string | undefined => errors[field], [errors]);

  return { errors, setErrors, setServerErrors, clearError, clearAll, errorOf };
}

/**
 * Junta data e hora num ISO 8601 com offset, que é o formato que os contratos
 * exigem (`isoDateTimeSchema` usa `.datetime({ offset: true })`).
 *
 * `new Date('2026-09-10T08:00').toISOString()` já resolveria, mas silencia
 * entrada inválida virando `Invalid Date`. Aqui a falha é explícita e o
 * formulário consegue apontar o campo.
 */
export function toIsoDateTime(date: string, time: string): string | null {
  if (date === '' || time === '') return null;
  const parsed = new Date(`${date}T${time}:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/** Campo vazio vira `undefined` — o contrato distingue "ausente" de "vazio". */
export const optionalText = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};
