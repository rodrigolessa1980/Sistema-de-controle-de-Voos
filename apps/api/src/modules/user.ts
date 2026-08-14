/**
 * Usuários e liberação de acesso — Configurações → Permissões.
 *
 * Fecha a lacuna que o sistema tinha: até aqui, usuário só nascia pelo seed ou
 * como efeito colateral de cadastrar um cliente com "Criar acesso ao portal".
 * Não havia como colocar alguém do operacional ou do financeiro para dentro sem
 * mexer no banco.
 *
 * O fluxo é: a pessoa se cadastra em `/auth/register` (nome, e-mail e senha) e
 * fica `pendente`; o administrador vê a fila aqui, escolhe o papel e libera.
 *
 * Quem decide o papel é sempre o administrador. O formulário público não tem
 * campo de papel, e esta rota não aceita `role` vindo do cadastro — senão
 * bastaria pedir `admin` no autocadastro para virar administrador.
 *
 * Todas as rotas exigem `user:read` / `user:update`, que na matriz de permissões
 * só o papel `admin` tem (packages/shared/src/permissions.ts).
 */

import {
  approveUserBodySchema,
  idParamSchema,
  listUserQuerySchema,
  okSchema,
  paginated,
  userSchema,
  type RoleKey,
  type User,
} from '@acm/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { recordChange } from '../lib/changefeed';
import { badRequest, notFound } from '../lib/errors';
import { buildPage, cursorArgs, searchTerm } from '../lib/pagination';
import { type Db, type Prisma, prisma } from '../lib/prisma';
import { requirePermission, requireUser } from '../plugins/rbac';

const userSelect = {
  id: true,
  name: true,
  email: true,
  status: true,
  clientId: true,
  mustChangePassword: true,
  createdAt: true,
  lastLoginAt: true,
  role: { select: { key: true } },
  client: { select: { name: true } },
} as const;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

function toUserDTO(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role.key as RoleKey,
    status: row.status,
    clientId: row.clientId,
    clientName: row.client?.name ?? null,
    mustChangePassword: row.mustChangePassword,
    createdAt: row.createdAt.toISOString(),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
  };
}

/**
 * Fecha o aviso do sino de um cadastro que acabou de ser resolvido.
 *
 * Marca como lida a notificação de TODOS os aprovadores, não só de quem clicou:
 * o pedido é um só, e depois de liberado ou recusado não há nada a fazer com ele.
 * Sem isto, os outros administradores continuariam com o pontinho vermelho e
 * abririam a fila para encontrá-la vazia — um badge que mente é pior que badge
 * nenhum.
 *
 * `updateMany` sem `userId` no `where` é seguro aqui porque o filtro é o tipo
 * mais o `entityId` do cadastro: não existe notificação de outro assunto que
 * casaria.
 */
async function markRegistrationHandled(tx: Db, userId: string): Promise<void> {
  await tx.notification.updateMany({
    where: { type: 'cadastro_pendente', entity: 'user', entityId: userId, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function userRoutes(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>();

  // ---------------------------------------------------------------- listar
  route.get(
    '/',
    {
      preValidation: requirePermission('user:read'),
      schema: { querystring: listUserQuerySchema, response: { 200: paginated(userSchema) } },
    },
    async (request) => {
      const { cursor, limit, q, status } = request.query;
      const term = searchTerm(q);

      const where: Prisma.UserWhereInput = {
        deletedAt: null,
        ...(status === undefined ? {} : { status }),
        ...(term === undefined
          ? {}
          : { OR: [{ name: { contains: term } }, { email: { contains: term } }] }),
      };

      const [rows, total] = await Promise.all([
        prisma.user.findMany({
          where,
          select: userSelect,
          /**
           * Pendente primeiro, e dentro de cada grupo o mais antigo antes: a
           * fila do administrador é uma fila, não uma lista de novidades.
           *
           * `status asc` dá isso de graça porque MySQL ordena ENUM pela POSIÇÃO
           * declarada, e `pendente` é o primeiro valor do enum. Se alguém
           * reordenar o enum no schema, esta ordenação muda de sentido — está
           * anotado lá.
           *
           * `id` no fim é o desempate que a paginação por cursor exige: sem uma
           * ordem total, duas linhas empatadas podem trocar de lugar entre
           * páginas e um usuário apareceria duas vezes (ou nenhuma).
           */
          orderBy: [{ status: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          ...cursorArgs({ cursor, limit }),
        }),
        prisma.user.count({ where }),
      ]);

      return { ...buildPage(rows, limit, toUserDTO), total };
    },
  );

  // --------------------------------------------------------------- liberar
  /**
   * Libera um cadastro pendente: define o papel e ativa a conta.
   *
   * Papel `cliente` precisa de um `Client` do outro lado — é ele que dá o escopo
   * por linha (`clientScope` em plugins/rbac.ts). Sem esse vínculo, o usuário
   * entra e não vê absolutamente nada, o que na tela parece defeito do sistema.
   * Então: ou o administrador aponta um cliente existente, ou o cadastro do
   * cliente é criado aqui a partir do nome e do e-mail do autocadastro.
   */
  route.post(
    '/:id/approve',
    {
      preValidation: requirePermission('user:update'),
      schema: {
        params: idParamSchema,
        body: approveUserBodySchema,
        response: { 200: userSchema },
      },
    },
    async (request) => {
      const admin = requireUser(request);
      const { id } = request.params;
      const { role, clientId } = request.body;

      const target = await prisma.user.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, name: true, email: true, status: true, clientId: true },
      });
      if (!target) throw notFound('Usuário');

      if (target.status !== 'pendente') {
        throw badRequest('Este cadastro já foi liberado ou recusado.');
      }

      const roleRow = await prisma.role.findUnique({ where: { key: role }, select: { id: true } });
      if (!roleRow) throw badRequest(`O papel "${role}" não está configurado.`);

      if (role !== 'cliente' && clientId !== undefined) {
        throw badRequest('Vínculo com cliente só se aplica ao papel Cliente.');
      }

      const updated = await prisma.$transaction(async (tx) => {
        let linkedClientId: string | null = null;

        if (role === 'cliente') {
          if (clientId === undefined) {
            /**
             * Reaproveita o cadastro que já existir com este e-mail.
             *
             * O caso comum é o cliente já estar na base (cadastrado pelo
             * operacional) e só agora pedir acesso ao portal. Criar um segundo
             * `Client` com o mesmo e-mail partiria o histórico de viagens e
             * cobranças dele em dois, e o portal mostraria metade.
             */
            const existing = await tx.client.findFirst({
              where: { email: target.email, deletedAt: null },
              select: { id: true },
            });

            if (existing) {
              linkedClientId = existing.id;
            } else {
              const client = await tx.client.create({
                data: { name: target.name, email: target.email },
                select: { id: true },
              });
              linkedClientId = client.id;

              await recordChange(
                tx,
                { entity: 'client', entityId: client.id, action: 'created' },
                admin.id,
              );
            }
          } else {
            const chosen = await tx.client.findFirst({
              where: { id: clientId, deletedAt: null },
              select: { id: true },
            });
            if (!chosen) throw notFound('Cliente');
            linkedClientId = chosen.id;
          }
        }

        const row = await tx.user.update({
          where: { id: target.id },
          data: {
            status: 'ativo',
            roleId: roleRow.id,
            clientId: linkedClientId,
            // Zera o contador: a conta começa a vida sem histórico de tentativa.
            failedLoginCount: 0,
            lockedUntil: null,
          },
          select: userSelect,
        });

        await markRegistrationHandled(tx, row.id);
        await recordChange(tx, { entity: 'user', entityId: row.id, action: 'updated' }, admin.id);

        await tx.auditLog.create({
          data: {
            userId: admin.id,
            action: 'user.approve',
            entity: 'user',
            entityId: row.id,
            before: { status: target.status, clientId: target.clientId },
            after: { status: 'ativo', role, clientId: linkedClientId },
            ip: request.ip,
          },
        });

        return row;
      });

      return toUserDTO(updated);
    },
  );

  // --------------------------------------------------------------- recusar
  /**
   * Recusa um cadastro pendente — apaga a linha.
   *
   * Apagar em vez de marcar `inativo` porque o e-mail tem índice único: uma conta
   * recusada que fica no banco bloqueia o endereço para sempre, e como
   * `/auth/register` responde a mesma coisa para e-mail já existente (para não
   * virar verificador de contas), a pessoa tentaria de novo e receberia
   * "cadastro enviado" sem nunca ser liberada.
   *
   * É seguro apagar: uma conta `pendente` nunca logou, logo não tem sessão,
   * notificação, viagem ou cobrança apontando para ela. O `AuditLog` guarda quem
   * era — e a coluna é `ON DELETE SET NULL`, então o registro sobrevive à linha.
   */
  route.post(
    '/:id/reject',
    {
      preValidation: requirePermission('user:update'),
      schema: { params: idParamSchema, response: { 200: okSchema } },
    },
    async (request) => {
      const admin = requireUser(request);
      const { id } = request.params;

      const target = await prisma.user.findUnique({
        where: { id },
        select: { id: true, name: true, email: true, status: true },
      });
      if (!target) throw notFound('Usuário');

      if (target.status !== 'pendente') {
        throw badRequest('Só um cadastro aguardando liberação pode ser recusado.');
      }

      await prisma.$transaction(async (tx) => {
        // Auditoria ANTES do delete: depois da linha sair, `target` é a única
        // memória de quem pediu acesso.
        await tx.auditLog.create({
          data: {
            userId: admin.id,
            action: 'user.reject',
            entity: 'user',
            entityId: target.id,
            before: { name: target.name, email: target.email, status: target.status },
            ip: request.ip,
          },
        });

        await markRegistrationHandled(tx, target.id);
        await tx.user.delete({ where: { id: target.id } });

        await recordChange(
          tx,
          { entity: 'user', entityId: target.id, action: 'deleted' },
          admin.id,
        );
      });

      return { ok: true } as const;
    },
  );
}
