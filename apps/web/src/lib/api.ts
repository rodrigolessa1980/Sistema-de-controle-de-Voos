/**
 * Cliente HTTP tipado.
 *
 * O tipo de cada resposta vem dos schemas Zod de `@acm/shared` — os MESMOS que o
 * backend usa para validar. Não existe nenhum tipo de resposta escrito à mão
 * neste app: mudar o contrato quebra o compilador dos dois lados.
 *
 * Sessão: o access token vive em memória (não em `localStorage`, que é legível
 * por qualquer script injetado). O refresh token é um cookie httpOnly que o
 * JavaScript nem enxerga. Ao receber 401, o cliente tenta um refresh e repete a
 * requisição uma única vez.
 */

import type { ApiError } from '@acm/shared';

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Mensagens de campo vindas do Zod, para exibir no formulário. */
  get fieldErrors(): { path: string; message: string }[] {
    if (!Array.isArray(this.details)) return [];
    return this.details.filter(
      (d): d is { path: string; message: string } =>
        typeof d === 'object' &&
        d !== null &&
        typeof (d as { path?: unknown }).path === 'string' &&
        typeof (d as { message?: unknown }).message === 'string',
    );
  }
}

// --------------------------------------------------------------- token em RAM

let accessToken: string | null = null;
let onSessionLost: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setSessionLostHandler(handler: (() => void) | null): void {
  onSessionLost = handler;
}

const BASE = '/api';

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly query?: Record<string, string | number | boolean | undefined | null>;
  readonly signal?: AbortSignal;
  /** Uso interno: impede laço infinito de refresh. */
  readonly _retry?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.pathname + url.search;
}

async function parseError(response: Response): Promise<ApiRequestError> {
  let code = 'INTERNAL';
  let message = `Erro ${response.status}`;
  let details: unknown;

  try {
    const parsed = (await response.json()) as Partial<ApiError>;
    if (parsed.error) {
      code = parsed.error.code;
      message = parsed.error.message;
      details = parsed.error.details;
    }
  } catch {
    // Resposta sem JSON (proxy, 502...): mantém a mensagem genérica.
  }

  return new ApiRequestError(response.status, code, message, details);
}

/** Renova o access token pelo cookie httpOnly. */
async function refreshSession(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!response.ok) return false;

    const data = (await response.json()) as { accessToken?: unknown };
    if (typeof data.accessToken !== 'string') return false;

    accessToken = data.accessToken;
    return true;
  } catch {
    return false;
  }
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, signal } = options;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (accessToken !== null) headers['Authorization'] = `Bearer ${accessToken}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(buildUrl(path, query), {
    method,
    headers,
    credentials: 'include',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal === undefined ? {} : { signal }),
  });

  // 401 → tenta renovar UMA vez e repete. `/auth/*` fica de fora para não
  // entrar em laço quando é o próprio refresh que falha.
  if (response.status === 401 && options._retry !== true && !path.startsWith('/auth/')) {
    if (await refreshSession()) {
      return request<T>(path, { ...options, _retry: true });
    }
    accessToken = null;
    onSessionLost?.();
  }

  if (!response.ok) throw await parseError(response);

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Upload multipart — documentos de passageiro. */
export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);

  const headers: Record<string, string> = {};
  if (accessToken !== null) headers['Authorization'] = `Bearer ${accessToken}`;

  const response = await fetch(buildUrl(path), {
    method: 'POST',
    headers,
    credentials: 'include',
    body: form,
  });

  if (!response.ok) throw await parseError(response);
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query'], signal?: AbortSignal): Promise<T> =>
    request<T>(path, { method: 'GET', ...(query ? { query } : {}), ...(signal ? { signal } : {}) }),

  post: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: 'POST', ...(body === undefined ? {} : { body }) }),

  patch: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: 'PATCH', ...(body === undefined ? {} : { body }) }),

  delete: <T>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' }),

  upload: uploadFile,
};

/**
 * URL de um documento de passageiro.
 *
 * A rota exige autenticação, então não dá para usar em `<img src>` direto — o
 * `useDocumentUrl` busca com o token e cria um object URL.
 */
export const documentPath = (id: string): string => `${BASE}/documents/${id}`;

export async function fetchDocumentBlob(id: string): Promise<string> {
  const headers: Record<string, string> = {};
  if (accessToken !== null) headers['Authorization'] = `Bearer ${accessToken}`;

  const response = await fetch(documentPath(id), { headers, credentials: 'include' });
  if (!response.ok) throw await parseError(response);

  return URL.createObjectURL(await response.blob());
}
