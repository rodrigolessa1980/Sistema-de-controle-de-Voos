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
  /** Teto de espera. `0` desliga — só o upload usa isso. */
  readonly timeoutMs?: number;
  /** Uso interno: impede laço infinito de refresh. */
  readonly _retry?: boolean;
}

/**
 * Teto de espera de toda requisição.
 *
 * Existe porque `fetch` NÃO tem timeout: uma requisição que o outro lado nunca
 * responde fica pendente para sempre, e a promise nunca resolve nem rejeita.
 * Foi assim que uma extensão de VPN travou a tela "Restaurando sessão…" — o
 * `AuthProvider` esperava um `POST /auth/refresh` que ficou `(pending)`, então
 * `setLoading(false)` nunca rodava e não havia caminho de volta. Nem recarregar
 * resolvia: a requisição nova pendurava igual.
 *
 * A extensão foi o caso que apareceu, mas a lista é longa e nenhuma é culpa de
 * quem usa: portal cativo de wi-fi, 4G que caiu no meio, proxy corporativo,
 * servidor engasgado. Sem teto, todos terminam na mesma tela morta.
 *
 * 20 segundos é folgado para qualquer rota deste app — a mais lenta em produção
 * responde em ~30 ms. Estourar o teto vira `TIMEOUT`, que é um erro comum: o
 * `AuthProvider` cai no `catch`, manda para o login, e a pessoa tem o que fazer.
 */
const DEFAULT_TIMEOUT_MS = 20_000;

export const TIMEOUT_CODE = 'TIMEOUT';

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

/**
 * Roda `fetch` com teto de espera, preservando o `signal` de quem chamou.
 *
 * Dois motivos para abortar: o teto estourou, ou quem chamou desistiu (o
 * `AbortSignal` do TanStack Query, quando a tela desmonta). Os dois precisam
 * cortar a MESMA requisição, e é por isso que existe um controller próprio
 * ouvindo os dois — encadear só um deles deixaria o outro sem efeito.
 */
async function fetchComTeto(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signalDeQuemChamou?: AbortSignal,
): Promise<Response> {
  if (timeoutMs <= 0 && signalDeQuemChamou === undefined) {
    return fetch(url, init);
  }

  const controller = new AbortController();

  /**
   * Sentinela que distingue "o teto estourou" de "quem chamou desistiu".
   *
   * A informação vai no `reason` do próprio `AbortController` em vez de numa
   * variável de fora: o compilador não enxerga atribuição feita dentro de um
   * callback e trata a variável como sempre `false`, então o `catch` que a
   * consultasse seria código morto na análise — e o lint acusa isso, com razão.
   */
  const MOTIVO_TETO = { teto: true };

  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          controller.abort(MOTIVO_TETO);
        }, timeoutMs)
      : undefined;

  const repassarAborto = (): void => {
    controller.abort();
  };
  signalDeQuemChamou?.addEventListener('abort', repassarAborto);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    /**
     * Só o teto vira `TIMEOUT`. Aborto de quem chamou continua sendo
     * `AbortError`, que o TanStack Query já entende como "descartar", e
     * traduzir isso para erro visível encheria a tela de aviso a cada
     * navegação.
     */
    if (controller.signal.reason === MOTIVO_TETO) {
      throw new ApiRequestError(
        0,
        TIMEOUT_CODE,
        'O servidor não respondeu. Verifique sua conexão — uma VPN ou extensão do navegador pode estar bloqueando.',
      );
    }
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signalDeQuemChamou?.removeEventListener('abort', repassarAborto);
  }
}

/** Renova o access token pelo cookie httpOnly. */
async function refreshSession(): Promise<boolean> {
  try {
    const response = await fetchComTeto(
      `${BASE}/auth/refresh`,
      { method: 'POST', credentials: 'include' },
      DEFAULT_TIMEOUT_MS,
    );
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
  const { method = 'GET', body, query, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (accessToken !== null) headers['Authorization'] = `Bearer ${accessToken}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetchComTeto(
    buildUrl(path, query),
    {
      method,
      headers,
      credentials: 'include',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    timeoutMs,
    signal,
  );

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

/**
 * Upload multipart — documentos de passageiro.
 *
 * Teto próprio, de 2 minutos: 20 segundos derrubaria um PDF de 5 MB (o limite do
 * `UPLOAD_MAX_BYTES`) numa conexão lenta, e aí o teto que existe para destravar a
 * tela passaria a ser o motivo de o envio falhar.
 */
const UPLOAD_TIMEOUT_MS = 120_000;

export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);

  const headers: Record<string, string> = {};
  if (accessToken !== null) headers['Authorization'] = `Bearer ${accessToken}`;

  const response = await fetchComTeto(
    buildUrl(path),
    {
      method: 'POST',
      headers,
      credentials: 'include',
      body: form,
    },
    UPLOAD_TIMEOUT_MS,
  );

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

  const response = await fetchComTeto(
    documentPath(id),
    { headers, credentials: 'include' },
    UPLOAD_TIMEOUT_MS,
  );
  if (!response.ok) throw await parseError(response);

  return URL.createObjectURL(await response.blob());
}
