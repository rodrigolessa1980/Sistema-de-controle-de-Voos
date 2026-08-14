/**
 * Configuração validada na partida.
 *
 * O processo não sobe com env faltando ou malformado. É deliberado: uma
 * `JWT_ACCESS_SECRET` ausente que só aparece no primeiro login em produção é
 * pior do que um container que não sobe no deploy.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Carrega o `.env` sem depender de `dotenv`.
 *
 * Em produção as variáveis vêm do ambiente do container (env_file do Compose),
 * então o arquivo simplesmente não existe — e isso não é erro. Variável já
 * presente no ambiente sempre vence o arquivo.
 */
function loadEnvFile(): void {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
    resolve(__dirname, '../../../.env'),
  ];

  const path = candidates.find((p) => existsSync(p));
  if (!path) return;

  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq < 1) continue;

    const key = line.slice(0, eq).trim();
    if (key in process.env) continue;

    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile();

const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),

  PORT_BACKEND: z.coerce.number().int().min(1).max(65_535).default(1701),
  API_BASE_URL: z.string().url().default('http://localhost:1701'),
  WEB_BASE_URL: z.string().url().default('http://localhost:1700'),
  CORS_ORIGINS: csv,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  TZ: z.string().default('America/Sao_Paulo'),

  // Segredos: o comprimento mínimo evita subir com um placeholder de exemplo.
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET precisa de 32+ caracteres'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET precisa de 32+ caracteres'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  COOKIE_SECRET: z.string().min(16),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  POLL_INTERVAL_MS: z.coerce.number().int().min(1000).default(10_000),
  CHANGE_FEED_PAGE_SIZE: z.coerce.number().int().min(50).max(2000).default(500),
  CHANGE_FEED_RETENTION_HOURS: z.coerce.number().int().min(1).max(720).default(24),

  UPLOAD_DIR: z.string().default('./storage/documents'),
  UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .default(5 * 1024 * 1024),
  UPLOAD_ALLOWED_MIME: csv,
  DOCUMENT_RETENTION_DAYS: z.coerce.number().int().min(1).default(365),

  MAIL_PROVIDER: z.enum(['resend', 'ses', 'sendgrid', 'console']).default('console'),
  MAIL_API_KEY: z.string().default(''),
  MAIL_FROM: z.string().default('nao-responda@aircharter.com.br'),
  MAIL_FROM_NAME: z.string().default('Air Charter Manager'),
  MAIL_REPLY_TO: z.string().default(''),
  MAIL_DRY_RUN: booleanish.default(true),

  BATCH_SIZE: z.coerce.number().int().min(50).max(5000).default(500),
  JOBS_ENABLED: booleanish.default(true),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  // Antes do logger existir: stderr é o único canal disponível.
  console.error(`Configuração inválida. Corrija o .env:\n${issues}`);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/**
 * O site é servido por HTTPS de verdade?
 *
 * Quem responde é `WEB_BASE_URL`, porque é o endereço por onde o NAVEGADOR
 * chega — e é o navegador que decide se aceita um cookie `Secure`. `NODE_ENV`
 * não sabe disso: descreve o modo de execução, não o protocolo da porta.
 *
 * Existe para o cookie de refresh (`refreshCookieOptions`). Amarrar aquela flag
 * em `isProduction` parecia mais seguro e derrubava a sessão de todo mundo: ver
 * a explicação em `lib/auth.ts`.
 */
export const isHttps = env.WEB_BASE_URL.startsWith('https://');

/**
 * Sem chave de API o envio não acontece de verdade — a fila grava e o worker
 * registra no log. É o estado atual do projeto: o provedor ainda não foi
 * escolhido (docs/PLANO.md §13.3).
 */
export const mailIsDryRun = env.MAIL_DRY_RUN || env.MAIL_API_KEY === '';
