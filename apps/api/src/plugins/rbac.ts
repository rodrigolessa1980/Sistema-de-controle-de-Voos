/**
 * Autenticação e autorização (docs/PLANO.md §4.2).
 *
 * Três camadas, e as três são obrigatórias:
 *
 *   1. ROTA    — `requirePermission('trip:create')` roda antes do handler.
 *   2. LINHA   — `clientScope(user)` é injetado no `where` da query. O filtro
 *                entra na busca; não se lê tudo para conferir depois.
 *   3. CAMPO   — o DTO por perfil decide o que sai. É o que garante que o
 *                cliente nunca receba aeronave nem tarifa interna.
 *
 * Este arquivo cuida das camadas 1 e 2. A 3 vive nos `*.dto.ts` de cada módulo.
 */

import type { Permission } from '@acm/shared';
import { resolvePermissions } from '@acm/shared';
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify';
import fp from 'fastify-plugin';

import { verifyAccessToken, type AuthenticatedUser } from '../lib/auth';
import { forbidden, unauthorized } from '../lib/errors';

declare module 'fastify' {
  interface FastifyRequest {
    /** Preenchido pelo hook de autenticação. `undefined` em rota pública. */
    user?: AuthenticatedUser;
  }
}

/** Devolve o usuário ou lança 401 — evita `request.user!` espalhado. */
export function requireUser(request: FastifyRequest): AuthenticatedUser {
  if (!request.user) throw unauthorized();
  return request.user;
}

export function extractBearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

/**
 * Rotas que um usuário com `mustChangePassword` ainda pode usar.
 *
 * Sem esta lista, quem precisa trocar a senha não consegue nem chamar a rota
 * que troca a senha.
 */
const ALLOWED_WHILE_MUST_CHANGE = new Set([
  '/api/auth/me',
  '/api/auth/change-password',
  '/api/auth/logout',
  '/api/auth/refresh',
]);

export const rbacPlugin = fp(
  function rbacPlugin(app: FastifyInstance, _opts: unknown, done: () => void) {
    /** Autentica. Rota pública não chama este hook. */
    app.decorate(
      'authenticate',
      async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
        const token = extractBearer(request);
        if (!token) throw unauthorized('Informe o token de acesso.');

        const claims = await verifyAccessToken(token);

        // As permissões vêm do token, mas passam por `resolvePermissions` para
        // que um token antigo não conceda permissão que o papel já não tem.
        const fromRole = resolvePermissions(claims.role);
        const effective = new Set<Permission>();
        for (const perm of claims.perms) {
          if (fromRole.has(perm as Permission)) effective.add(perm as Permission);
        }

        request.user = {
          id: claims.sub,
          email: '',
          name: '',
          role: claims.role,
          clientId: claims.cid,
          permissions: effective,
          mustChangePassword: claims.mcp,
        };

        if (claims.mcp && !ALLOWED_WHILE_MUST_CHANGE.has(request.routeOptions.url ?? '')) {
          throw forbidden('Troque a sua senha provisória antes de continuar.');
        }
      },
    );

    done();
  },
  { name: 'acm-rbac' },
);

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Exige UMA permissão.
 *
 * Registrado como `preValidation`, não `preHandler`, por causa da ordem do ciclo
 * de vida do Fastify: onRequest → preParsing → preValidation → VALIDAÇÃO →
 * preHandler → handler.
 *
 * Em `preHandler`, quem não tem permissão recebia 422 com os detalhes de
 * validação do corpo antes de chegar no 403 — ou seja, o schema da rota era
 * revelado a quem não pode usá-la. Autorização não deve depender de o corpo ser
 * válido.
 *
 * Autentica e autoriza no mesmo hook: é impossível registrar a permissão e
 * esquecer a autenticação.
 */
export function requirePermission(permission: Permission): preValidationAsyncHookHandler {
  return async function check(request, reply): Promise<void> {
    await request.server.authenticate(request, reply);
    const user = requireUser(request);
    if (!user.permissions.has(permission)) {
      throw forbidden(`Ação não permitida para o perfil ${user.role}.`);
    }
  };
}

/** Exige ao menos UMA das permissões — para rotas que servem vários perfis. */
export function requireAnyPermission(...permissions: Permission[]): preValidationAsyncHookHandler {
  return async function check(request, reply): Promise<void> {
    await request.server.authenticate(request, reply);
    const user = requireUser(request);
    if (!permissions.some((p) => user.permissions.has(p))) {
      throw forbidden(`Ação não permitida para o perfil ${user.role}.`);
    }
  };
}

/** Só autentica, sem exigir permissão específica. */
export const requireAuth: preValidationAsyncHookHandler = async function requireAuth(
  request,
  reply,
) {
  await request.server.authenticate(request, reply);
};

export const can = (user: AuthenticatedUser, permission: Permission): boolean =>
  user.permissions.has(permission);

// ============================================================================
//  CAMADA 2 — escopo por linha
// ============================================================================

/**
 * Filtro de escopo para injetar no `where`.
 *
 * Cliente → `{ clientId: '<o dele>' }`. Interno → `{}` (vê tudo).
 *
 * O `clientId` nulo em um usuário de perfil cliente é tratado como "não vê
 * nada" (`__never__`) e não como "vê tudo". Um cadastro incompleto tem que
 * negar acesso, não liberar.
 */
export function clientScope(user: AuthenticatedUser): { clientId?: string } {
  if (user.role !== 'cliente') return {};
  return { clientId: user.clientId ?? '__never__' };
}

export function isClientRole(user: AuthenticatedUser): boolean {
  return user.role === 'cliente';
}

/**
 * Garante que o usuário alcança um `clientId` específico.
 *
 * Para rotas em que o id vem do path — o escopo no `where` não protege quando o
 * cliente pede `/clients/<id-de-outro>`.
 */
export function assertClientAccess(user: AuthenticatedUser, clientId: string): void {
  if (user.role !== 'cliente') return;
  if (user.clientId !== clientId) throw forbidden('Você só pode acessar os seus próprios dados.');
}

/** O `clientId` do próprio usuário, ou 403 se o vínculo não existir. */
export function ownClientId(user: AuthenticatedUser): string {
  if (user.clientId === null) {
    throw forbidden('Este usuário não está vinculado a nenhum cliente.');
  }
  return user.clientId;
}
