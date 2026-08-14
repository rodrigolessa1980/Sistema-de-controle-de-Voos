/**
 * Autenticação: login, autocadastro, refresh rotativo, logout, `/me`, troca de
 * senha.
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
  registerBodySchema,
  registerResponseSchema,
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
import { recordChange } from '../lib/changefeed';
import { badRequest, forbidden, unauthorized } from '../lib/errors';
import { resolveClientForUser } from '../lib/client-link';
import { findUsersWithPermission } from '../lib/notify';
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

      if (!user) throw invalid;

      // Conta desativada ou bloqueada pelo administrador cai na mensagem
      // genérica: quem foi desligado da empresa não precisa saber se o motivo é
      // a senha ou o próprio acesso.
      if (user.status === 'inativo' || user.status === 'bloqueado') throw invalid;

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

      /**
       * Cadastro ainda não liberado.
       *
       * A explicação vem DEPOIS de a senha ser conferida, e isso é deliberado:
       * dita antes, ela contaria a quem só chutou o e-mail que existe uma conta
       * naquele endereço. Dita aqui, quem recebe a mensagem já provou ser o dono
       * da senha — e aí merece saber por que não entra, em vez de ficar tentando
       * uma senha que está certa.
       */
      if (user.status === 'pendente') {
        throw forbidden('Seu cadastro foi recebido e está aguardando liberação do administrador.');
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

  // ---------------------------------------------------------------- register
  /**
   * Autocadastro pela tela de login: a conta já entra, como Cliente.
   *
   * Decisão de produto: não há fila de liberação, não há confirmação por e-mail e
   * não há exigência de senha forte. Quem se cadastra usa o sistema no mesmo
   * minuto. O que sustenta isso é o papel: `cliente` é o de MENOR alcance da
   * matriz, e o escopo por linha (`clientScope` em plugins/rbac.ts) fecha o
   * `where` de toda consulta no `clientId` da própria pessoa. Um cadastro novo
   * não enxerga aeronave, tarifa interna, nem uma linha de outro cliente.
   *
   * Nenhum caminho público concede papel: `role` NÃO existe no corpo desta rota.
   * Subir alguém para Operacional, Financeiro ou Administrador é ato do
   * administrador, em Configurações → Permissões.
   *
   * O `Client` é criado JUNTO, na mesma transação. Sem ele o `clientId` fica
   * `null`, o escopo não casa com nada e a pessoa entra num sistema onde toda
   * tela vem vazia — que na prática é pior que não entrar, porque parece defeito.
   */
  route.post(
    '/register',
    {
      schema: { body: registerBodySchema, response: { 200: registerResponseSchema } },
      config: {
        // Rota pública que escreve no banco: teto baixo, por IP. Sem isto, um
        // laço simples enche a tabela de usuários e a fila do administrador.
        rateLimit: { max: 5, timeWindow: '10 minutes' },
      },
    },
    async (request) => {
      const { name, email, password } = request.body;

      const response = {
        ok: true,
        message: 'Cadastro concluído. Você já pode entrar com o e-mail e a senha que escolheu.',
      } as const;

      const existing = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });

      /**
       * E-mail já cadastrado: responde exatamente o mesmo e não grava nada.
       *
       * Um 409 "e-mail já existe" aqui viraria um verificador público de quem tem
       * conta no sistema — e a lista de clientes de um táxi aéreo é justamente o
       * que não se quer confirmar para um estranho. Quem já tem conta e esqueceu
       * disso descobre na tela de login, autenticado.
       */
      if (existing) return response;

      const clientRole = await prisma.role.findUnique({
        where: { key: 'cliente' },
        select: { id: true },
      });
      if (!clientRole) throw badRequest('O papel "cliente" não está configurado.');

      const created = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            name,
            passwordHash: await hashPassword(password),
            roleId: clientRole.id,
            status: 'ativo',
            // Senha escolhida pela própria pessoa: não há nada de provisório.
            mustChangePassword: false,
          },
          select: { id: true },
        });

        /**
         * O cadastro de cliente que dá escopo à conta.
         *
         * `user.id` como autor do evento: quem provocou a criação foi a própria
         * pessoa, e atribuir isso a um administrador que não estava lá tornaria a
         * auditoria mentirosa.
         *
         * Reaproveita o `Client` que já existir com este e-mail — o caso comum é
         * o cliente já estar na base, cadastrado pelo operacional, e só agora
         * pedir acesso ao portal (ver `lib/client-link.ts`).
         */
        const clientId = await resolveClientForUser(tx, { name, email }, user.id);
        await tx.user.update({ where: { id: user.id }, data: { clientId } });

        /**
         * Aviso no sino de quem administra.
         *
         * Não é mais fila de trabalho — a conta já entrou. É notícia: um cliente
         * novo apareceu, e quem administra decide se quer promover o papel. Vai
         * para quem tem `user:update` (permissão, não pessoa), então um segundo
         * administrador passa a ser avisado sem deploy.
         *
         * Na MESMA transação: se o insert falhar, o cadastro não existe.
         */
        const admins = await findUsersWithPermission(tx, 'user:update');
        if (admins.length > 0) {
          await tx.notification.createMany({
            data: admins.map((admin) => ({
              userId: admin.id,
              type: 'cliente_cadastrado' as const,
              title: 'Novo cliente se cadastrou',
              body: `${name} · ${email}`,
              entity: 'user',
              entityId: user.id,
            })),
          });
        }

        // Sem `clientScopeId`: só perfis internos veem o evento. É o que faz a
        // fila de pendências do administrador aparecer sozinha, em 10 segundos.
        await recordChange(tx, { entity: 'user', entityId: user.id, action: 'created' }, user.id);

        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'auth.register',
            entity: 'user',
            entityId: user.id,
            after: { name, email, status: 'ativo', role: 'cliente' },
            ip: request.ip,
            userAgent: request.headers['user-agent']?.slice(0, 255) ?? null,
          },
        });

        return { id: user.id, clientId, notified: admins.length };
      });

      request.log.info(
        { userId: created.id, clientId: created.clientId, avisados: created.notified },
        'novo cliente cadastrado pela tela de login',
      );

      return response;
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
