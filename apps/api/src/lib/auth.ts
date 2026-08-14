/**
 * Senhas, tokens e sessão.
 *
 * Decisões:
 *   - bcrypt com custo configurável (12 por padrão) para a senha;
 *   - access token JWT curto (15 min) enviado no header `Authorization`;
 *   - refresh token opaco e aleatório, guardado como SHA-256 no banco e enviado
 *     em cookie httpOnly. O valor puro nunca é persistido, então vazar o dump
 *     do banco não dá sessão a ninguém;
 *   - refresh é rotativo: cada uso revoga o anterior.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { Permission, RoleKey } from '@acm/shared';
import { compare, hash as bcryptHash } from 'bcryptjs';
import { jwtVerify, SignJWT } from 'jose';

import { env, isHttps } from '../env';
import { unauthorized } from './errors';

const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: RoleKey;
  readonly clientId: string | null;
  readonly permissions: ReadonlySet<Permission>;
  readonly mustChangePassword: boolean;
}

export interface AccessTokenClaims {
  readonly sub: string;
  readonly role: RoleKey;
  readonly cid: string | null;
  readonly perms: string[];
  readonly mcp: boolean;
}

// ------------------------------------------------------------------- senhas

export async function hashPassword(plain: string): Promise<string> {
  return bcryptHash(plain, env.BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return compare(plain, hash);
}

/**
 * Senha provisória legível: 4 grupos de 4 caracteres sem I/O/0/1.
 *
 * Vai ser lida por telefone ou copiada de um e-mail, então ambiguidade de
 * caractere é problema de suporte. O `mustChangePassword` obriga a troca no
 * primeiro acesso, então a vida útil dela é curta.
 */
export function generateProvisionalPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(16);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length] ?? 'X');
  return [
    chars.slice(0, 4).join(''),
    chars.slice(4, 8).join(''),
    chars.slice(8, 12).join(''),
    chars.slice(12, 16).join(''),
  ].join('-');
}

// -------------------------------------------------------------- access token

/** Converte "15m" / "7d" / "3600" em segundos. */
export function parseTtlSeconds(ttl: string): number {
  const match = /^(\d+)([smhd])?$/.exec(ttl.trim());
  if (!match) return 900;

  const amount = Number(match[1]);
  const unit = match[2] ?? 's';
  const factor = unit === 'd' ? 86_400 : unit === 'h' ? 3600 : unit === 'm' ? 60 : 1;
  return amount * factor;
}

export const ACCESS_TTL_SECONDS = parseTtlSeconds(env.JWT_ACCESS_TTL);
export const REFRESH_TTL_SECONDS = parseTtlSeconds(env.JWT_REFRESH_TTL);

/**
 * As permissões viajam dentro do token para que a autorização não custe uma
 * query por requisição. O preço é a janela de 15 minutos até uma revogação
 * valer — aceitável, e é justamente por isso que o access token é curto.
 */
export async function signAccessToken(user: {
  id: string;
  role: RoleKey;
  clientId: string | null;
  permissions: readonly Permission[];
  mustChangePassword: boolean;
}): Promise<string> {
  return new SignJWT({
    role: user.role,
    cid: user.clientId,
    perms: [...user.permissions],
    mcp: user.mustChangePassword,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)
    .setIssuedAt()
    .setIssuer('acm-api')
    .setAudience('acm-web')
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(accessSecret);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, accessSecret, {
      issuer: 'acm-api',
      audience: 'acm-web',
    });

    const sub = payload.sub;
    const role = payload['role'];
    const cid = payload['cid'];
    const perms = payload['perms'];
    const mcp = payload['mcp'];

    if (typeof sub !== 'string' || typeof role !== 'string' || !Array.isArray(perms)) {
      throw unauthorized('Token malformado.');
    }

    return {
      sub,
      role: role as RoleKey,
      cid: typeof cid === 'string' ? cid : null,
      perms: perms.filter((p): p is string => typeof p === 'string'),
      mcp: mcp === true,
    };
  } catch {
    throw unauthorized('Sessão expirada ou inválida.');
  }
}

// ------------------------------------------------------------- refresh token

export const REFRESH_COOKIE = 'acm_refresh';

export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(48).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Comparação em tempo constante — não vaza informação pelo tempo de resposta. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Opções do cookie de refresh.
 *
 * `secure: isHttps`, NÃO `isProduction`. A diferença não é estética: o navegador
 * DESCARTA em silêncio um cookie marcado `Secure` que chegou por HTTP. Produção
 * hoje é HTTP puro na :1700 (o TLS é a pendência §4.5 de `docs/DEPLOY.md`), então
 * `acm_refresh` nunca chegava a ser gravado — nenhum erro no servidor, nenhum
 * erro no console, e o `Set-Cookie` saindo bonito na resposta do login.
 *
 * O efeito para quem usa: entrava normalmente, e a sessão morria junto com o
 * access token de 15 minutos ou na primeira recarga da página, o que viesse
 * antes. Como `POST /api/auth/refresh` respondia 401 sem cookie, a tela ficava
 * em "Restaurando sessão…" e voltava para o login — sem nada indicando por quê.
 *
 * Amarrando em `WEB_BASE_URL`, o dia em que entrar um proxy com TLS na frente a
 * flag volta sozinha: ninguém precisa lembrar de virar uma chave, que é
 * exatamente o tipo de coisa de que ninguém lembra.
 *
 * Enquanto a produção for HTTP, o refresh token trafega em claro. Isso é
 * consequência de não haver TLS, não desta linha — com `Secure` ligado ele
 * simplesmente não existia, e a autenticação não funcionava.
 */
export const refreshCookieOptions = {
  httpOnly: true,
  secure: isHttps,
  sameSite: 'lax',
  path: '/api/auth',
  maxAge: REFRESH_TTL_SECONDS,
} as const;

// ----------------------------------------------------- bloqueio por tentativa

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

export function isLocked(lockedUntil: Date | null, now: Date): boolean {
  return lockedUntil !== null && lockedUntil.getTime() > now.getTime();
}
