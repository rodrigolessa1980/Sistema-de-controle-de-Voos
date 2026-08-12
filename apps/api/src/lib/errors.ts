/**
 * Erros de domínio.
 *
 * O handler global (plugins/errors.ts) traduz estes em resposta HTTP. Um erro
 * que não seja `AppError` vira 500 com mensagem genérica — detalhe interno
 * nunca vaza para o cliente.
 */

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNPROCESSABLE'
  | 'RATE_LIMITED'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = STATUS[code];
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown): AppError =>
  new AppError('BAD_REQUEST', message, details);

export const unauthorized = (message = 'Não autenticado.'): AppError =>
  new AppError('UNAUTHORIZED', message);

export const forbidden = (message = 'Você não tem permissão para esta ação.'): AppError =>
  new AppError('FORBIDDEN', message);

export const notFound = (what = 'Registro'): AppError =>
  new AppError('NOT_FOUND', `${what} não encontrado.`);

export const conflict = (message: string, details?: unknown): AppError =>
  new AppError('CONFLICT', message, details);

export const unprocessable = (message: string, details?: unknown): AppError =>
  new AppError('UNPROCESSABLE', message, details);
