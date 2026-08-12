/**
 * Autenticação: login, refresh rotativo, logout, `/me`, troca de senha.
 *
 * Substitui o `Login` de fachada do protótipo (que só fazia
 * `setTimeout(onEnter, 400)`) e o seletor "Visualizar como" — o perfil agora vem
 * do banco, não de um `<select>` no header.
 */

import {
  changePasswordBodySchema,
  loginBodySchema,
  loginResponseSchema,
  okSchema,
  resolvePermissions,
  sessionUserSchema,
  type Permission,
  type RoleKey,
} from '@acm/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { env } from '../env';
import {
  ACCESS_TTL_SECONDS,
  generateRefreshToken,
  hashPassword,
  hashRefreshToken,
  isLocked,
  LOCK_MINUTES,
  MAX_FAILED_LOGINS,
  REFRESH_COOKIE,
  REFRESH_TTL_SECONDS,
  refreshCookieOptions,
  signAccessToken,
  verifyPassword,
} from '../lib/auth';
import { badRequest, unauthorized } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { requireAuth, requireUser } from '../plugins/rbac';

interface UserWithRole {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  status: string;
  clientId: string | null;
  mustChangePassword: boolean;
  failedLoginCount: number;
  lockedUntil: Date | null;
  role: { key: string };
  permissionOverrides: { effect: string; permission: { key: string } }[];
}

/** Uma query só: papel e overrides vêm por `include`, não em consulta separada. */
const userInclude = {
  role: { select: { key: true } },
  permissionOverrides: {
    select: { effect: true, permission: { select: { key: true } } },
  },
} as const;

function effectivePermissions(user: UserWithRole): Permission[] {
  const overrides = user.permissionOverrides.map((o) => ({
    permission: o.permission.key as Permission,
    effect: o.effect as 'allow' | 'deny',
  }));
  return [...resolvePermissions(user.role.key as RoleKey, overrides)];
}

function sessionPayload(user: UserWithRole, permissions: Permission[]) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role.key as RoleKey,
    clientId: user.clientId,
    mustChangePassword: user.mustChangePassword,
    permissions,
  };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>();

  // ------------------------------------------------------------------- login
  route.post(
    '/login',
    {
      schema: { body: loginBodySchema, response: { 200: loginResponseSchema } },
      config: {
        // Limite apertado: login é o alvo natural de força bruta.
        rateLimit: { max: 10, timeWindow: '1 minute' },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;
      const now = new Date();

      const user = (await prisma.user.findUnique({
        where: { email },
        include: userInclude,
      })) as UserWithRole | null;

      // Mensagem única para e-mail inexistente e senha errada: enumerar
      // usuários válidos é informação que não precisa ser dada.
      const invalid = unauthorized('E-mail ou senha incorretos.');

      if (user?.status !== 'ativo') throw invalid;

      if (isLocked(user.lockedUntil, now)) {
        throw unauthorized(
          `Acesso bloqueado por ${LOCK_MINUTES} minutos após várias tentativas. Tente mais tarde.`,
        );
      }

      const ok = await verifyPassword(password, user.passwordHash);

      if (!ok) {
        const failed = user.failedLoginCount + 1;
        const shouldLock = failed >= MAX_FAILED_LOGINS;
        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: shouldLock ? 0 : failed,
            lockedUntil: shouldLock ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null,
          },
        });
        throw invalid;
      }

      const permissions = effectivePermissions(user);
      const { token: refreshToken, hash } = generateRefreshToken();

      await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: now, failedLoginCount: 0, lockedUntil: null },
        }),
        prisma.refreshToken.create({
          data: {
            userId: user.id,
            tokenHash: hash,
            expiresAt: new Date(now.getTime() + REFRESH_TTL_SECONDS * 1000),
            ip: request.ip,
            userAgent: request.headers['user-agent']?.slice(0, 255) ?? null,
          },
        }),
        prisma.auditLog.create({
          data: {
            userId: user.id,
            action: 'auth.login',
            entity: 'user',
            entityId: user.id,
            ip: request.ip,
            userAgent: request.headers['user-agent']?.slice(0, 255) ?? null,
          },
        }),
      ]);

      void reply.setCookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions);

      return {
        accessToken: await signAccessToken({
          id: user.id,
          role: user.role.key as RoleKey,
          clientId: user.clientId,
          permissions,
          mustChangePassword: user.mustChangePassword,
        }),
        expiresIn: ACCESS_TTL_SECONDS,
        user: sessionPayload(user, permissions),
      };
    },
  );

  // ----------------------------------------------------------------- refresh
  // Rotativo: o token usado é revogado e um novo é emitido. Reuso de um token já
  // revogado indica roubo, e aí toda a sessão do usuário cai.
  route.post(
    '/refresh',
    { schema: { response: { 200: loginResponseSchema } } },
    async (request, reply) => {
      const presented = request.cookies[REFRESH_COOKIE];
      if (!presented) throw unauthorized('Sessão não encontrada.');

      const now = new Date();
      const stored = await prisma.refreshToken.findUnique({
        where: { tokenHash: hashRefreshToken(presented) },
        include: { user: { include: userInclude } },
      });

      if (!stored) {
        void reply.clearCookie(REFRESH_COOKIE, { path: refreshCookieOptions.path });
        throw unauthorized('Sessão inválida.');
      }

      if (stored.revokedAt !== null) {
        // Token revogado sendo reapresentado: derruba tudo do usuário.
        await prisma.refreshToken.updateMany({
          where: { userId: stored.userId, revokedAt: null },
          data: { revokedAt: now },
        });
        void reply.clearCookie(REFRESH_COOKIE, { path: refreshCookieOptions.path });
        throw unauthorized('Sessão revogada. Entre novamente.');
      }

      if (stored.expiresAt.getTime() < now.getTime()) {
        void reply.clearCookie(REFRESH_COOKIE, { path: refreshCookieOptions.path });
        throw unauthorized('Sessão expirada. Entre novamente.');
      }

      const user = stored.user as unknown as UserWithRole;
      if (user.status !== 'ativo') throw unauthorized('Usuário inativo.');

      const permissions = effectivePermissions(user);
      const { token: nextToken, hash: nextHash } = generateRefreshToken();

      await prisma.$transaction([
        prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: now } }),
        prisma.refreshToken.create({
          data: {
            userId: user.id,
            tokenHash: nextHash,
            expiresAt: new Date(now.getTime() + REFRESH_TTL_SECONDS * 1000),
            ip: request.ip,
            userAgent: request.headers['user-agent']?.slice(0, 255) ?? null,
          },
        }),
      ]);

      void reply.setCookie(REFRESH_COOKIE, nextToken, refreshCookieOptions);

      return {
        accessToken: await signAccessToken({
          id: user.id,
          role: user.role.key as RoleKey,
          clientId: user.clientId,
          permissions,
          mustChangePassword: user.mustChangePassword,
        }),
        expiresIn: ACCESS_TTL_SECONDS,
        user: sessionPayload(user, permissions),
      };
    },
  );

  // ------------------------------------------------------------------ logout
  route.post('/logout', { schema: { response: { 200: okSchema } } }, async (request, reply) => {
    const presented = request.cookies[REFRESH_COOKIE];
    if (presented) {
      await prisma.refreshToken.updateMany({
        where: { tokenHash: hashRefreshToken(presented), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    void reply.clearCookie(REFRESH_COOKIE, { path: refreshCookieOptions.path });
    return { ok: true } as const;
  });

  // ---------------------------------------------------------------------- me
  route.get(
    '/me',
    { preValidation: requireAuth, schema: { response: { 200: sessionUserSchema } } },
    async (request) => {
      const authed = requireUser(request);

      // Relê do banco: papel ou permissão podem ter mudado depois do token.
      const user = (await prisma.user.findUnique({
        where: { id: authed.id },
        include: userInclude,
      })) as UserWithRole | null;

      if (user?.status !== 'ativo') throw unauthorized('Usuário inativo.');

      return sessionPayload(user, effectivePermissions(user));
    },
  );

  // ---------------------------------------------------------- change-password
  route.post(
    '/change-password',
    {
      preValidation: requireAuth,
      schema: { body: changePasswordBodySchema, response: { 200: okSchema } },
      config: { rateLimit: { max: 5, timeWindow: '5 minutes' } },
    },
    async (request, reply) => {
      const authed = requireUser(request);
      const { currentPassword, newPassword } = request.body;

      const user = await prisma.user.findUniqueOrThrow({
        where: { id: authed.id },
        select: { id: true, passwordHash: true },
      });

      if (!(await verifyPassword(currentPassword, user.passwordHash))) {
        throw badRequest('A senha atual está incorreta.');
      }

      if (await verifyPassword(newPassword, user.passwordHash)) {
        throw badRequest('A nova senha precisa ser diferente da atual.');
      }

      const now = new Date();

      // Trocar senha derruba todas as outras sessões — é o comportamento
      // esperado de quem troca a senha por suspeita de acesso indevido.
      await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false },
        }),
        prisma.refreshToken.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: now },
        }),
        prisma.auditLog.create({
          data: {
            userId: user.id,
            action: 'auth.change_password',
            entity: 'user',
            entityId: user.id,
            ip: request.ip,
          },
        }),
      ]);

      void reply.clearCookie(REFRESH_COOKIE, { path: refreshCookieOptions.path });
      return { ok: true } as const;
    },
  );

  // Exposto para o front saber o intervalo do polling sem hard-code (10s).
  route.get('/config', async () => ({
    pollIntervalMs: env.POLL_INTERVAL_MS,
    accessTokenTtlSeconds: ACCESS_TTL_SECONDS,
  }));
}
