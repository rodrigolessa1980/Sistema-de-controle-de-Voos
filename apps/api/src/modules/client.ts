/**
 * Clientes — protótipo: `ClientsView`, `ClientForm`, `ClientDetail`, `CliPerfil`.
 *
 * Dois pontos de atenção:
 *
 * 1. SEM N+1. A listagem do protótipo chamava `clientBalance`, `clientFin` e
 *    `clientTrips` para CADA linha, e cada uma varria todas as cobranças. Aqui
 *    esses três valores são colunas denormalizadas: a listagem é um SELECT só.
 *
 * 2. ESCOPO. O cliente alcança apenas o próprio cadastro, e recebe um DTO
 *    reduzido (`clientSelfSchema`) sem os agregados internos.
 */

import {
  clientSchema,
  clientSelfSchema,
  createClientBodySchema,
  idParamSchema,
  listClientQuerySchema,
  paginated,
  updateClientBodySchema,
  updateOwnClientBodySchema,
  type Client,
  type ClientSelf,
} from '@acm/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { recordChange } from '../lib/changefeed';
import { generateProvisionalPassword, hashPassword } from '../lib/auth';
import { badRequest, notFound } from '../lib/errors';
import { enqueueEmail } from '../lib/mailer';
import { buildPage, cursorArgs, searchTerm } from '../lib/pagination';
import { decimalToMoneyStrict, type Prisma, prisma } from '../lib/prisma';
import { env } from '../env';
import {
  assertClientAccess,
  isClientRole,
  ownClientId,
  requireAnyPermission,
  requirePermission,
  requireUser,
} from '../plugins/rbac';

const clientSelect = {
  id: true,
  name: true,
  company: true,
  document: true,
  email: true,
  phone: true,
  notes: true,
  active: true,
  openBalance: true,
  overdueBalance: true,
  totalInvoiced: true,
  totalPaid: true,
  financialStatus: true,
  tripCount: true,
} as const;

type ClientRow = Prisma.ClientGetPayload<{ select: typeof clientSelect }>;

/** DTO interno — com os agregados financeiros. */
export function toClientDTO(row: ClientRow): Client {
  return {
    id: row.id,
    name: row.name,
    company: row.company,
    document: row.document,
    email: row.email,
    phone: row.phone,
    notes: row.notes,
    active: row.active,
    openBalance: decimalToMoneyStrict(row.openBalance),
    overdueBalance: decimalToMoneyStrict(row.overdueBalance),
    totalInvoiced: decimalToMoneyStrict(row.totalInvoiced),
    totalPaid: decimalToMoneyStrict(row.totalPaid),
    financialStatus: row.financialStatus,
    tripCount: row.tripCount,
  };
}

/** DTO do próprio cliente — sem faturado/recebido/vencido consolidados. */
export function toClientSelfDTO(row: ClientRow): ClientSelf {
  return {
    id: row.id,
    name: row.name,
    company: row.company,
    document: row.document,
    email: row.email,
    phone: row.phone,
    openBalance: decimalToMoneyStrict(row.openBalance),
    financialStatus: row.financialStatus,
    tripCount: row.tripCount,
  };
}

export async function clientRoutes(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>();

  // ------------------------------------------------------------------- listar
  route.get(
    '/',
    {
      preValidation: requirePermission('client:read'),
      schema: { querystring: listClientQuerySchema, response: { 200: paginated(clientSchema) } },
    },
    async (request) => {
      const { limit, cursor, q, financialStatus } = request.query;
      const term = searchTerm(q);

      const rows = await prisma.client.findMany({
        where: {
          deletedAt: null,
          ...(financialStatus ? { financialStatus } : {}),
          ...(term
            ? {
                OR: [
                  { name: { contains: term } },
                  { company: { contains: term } },
                  { email: { contains: term } },
                  { document: { contains: term } },
                ],
              }
            : {}),
        },
        select: clientSelect,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...cursorArgs({ cursor, limit }),
      });

      return buildPage(rows, limit, toClientDTO);
    },
  );

  // ------------------------------------------------------------------ próprio
  // Declarada ANTES de `/:id` para que "me" não seja capturado como um id.
  route.get(
    '/me',
    {
      preValidation: requirePermission('client:read_own'),
      schema: { response: { 200: clientSelfSchema } },
    },
    async (request) => {
      const user = requireUser(request);
      const row = await prisma.client.findFirst({
        where: { id: ownClientId(user), deletedAt: null },
        select: clientSelect,
      });
      if (!row) throw notFound('Cliente');
      return toClientSelfDTO(row);
    },
  );

  route.patch(
    '/me',
    {
      preValidation: requirePermission('client:update_own'),
      schema: { body: updateOwnClientBodySchema, response: { 200: clientSelfSchema } },
    },
    async (request) => {
      const user = requireUser(request);
      const clientId = ownClientId(user);
      const body = request.body;

      return prisma.$transaction(async (tx) => {
        const row = await tx.client.update({
          where: { id: clientId },
          data: {
            ...(body.name === undefined ? {} : { name: body.name }),
            ...(body.company === undefined ? {} : { company: body.company }),
            ...(body.email === undefined ? {} : { email: body.email }),
            ...(body.phone === undefined ? {} : { phone: body.phone }),
            ...(body.document === undefined ? {} : { document: body.document }),
          },
          select: clientSelect,
        });

        await recordChange(
          tx,
          { entity: 'client', entityId: clientId, action: 'updated', clientScopeId: clientId },
          user.id,
        );

        return toClientSelfDTO(row);
      });
    },
  );

  // -------------------------------------------------------------------- obter
  route.get(
    '/:id',
    {
      preValidation: requireAnyPermission('client:read', 'client:read_own'),
      schema: { params: idParamSchema, response: { 200: clientSchema.or(clientSelfSchema) } },
    },
    async (request) => {
      const user = requireUser(request);
      const { id } = request.params;

      // O escopo no `where` não cobre id vindo do path: um cliente pedindo
      // `/clients/<id-de-outro>` precisa desta verificação explícita.
      assertClientAccess(user, id);

      const row = await prisma.client.findFirst({
        where: { id, deletedAt: null },
        select: clientSelect,
      });
      if (!row) throw notFound('Cliente');

      return isClientRole(user) ? toClientSelfDTO(row) : toClientDTO(row);
    },
  );

  // ------------------------------------------------------------------- criar
  route.post(
    '/',
    {
      preValidation: requirePermission('client:create'),
      schema: { body: createClientBodySchema, response: { 201: clientSchema } },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const body = request.body;

      const created = await prisma.$transaction(async (tx) => {
        const row = await tx.client.create({
          data: {
            name: body.name,
            company: body.company ?? null,
            document: body.document ?? null,
            email: body.email,
            phone: body.phone ?? null,
            notes: body.notes ?? null,
          },
          select: clientSelect,
        });

        // Login do portal com senha provisória (docs/PLANO.md §12.2).
        if (body.createPortalUser) {
          const clientRole = await tx.role.findUnique({
            where: { key: 'cliente' },
            select: { id: true },
          });
          if (!clientRole) throw badRequest('O papel "cliente" não está configurado.');

          const existing = await tx.user.findUnique({
            where: { email: body.email },
            select: { id: true },
          });
          if (existing) {
            throw badRequest(`Já existe um usuário com o e-mail ${body.email}.`);
          }

          const provisional = generateProvisionalPassword();

          await tx.user.create({
            data: {
              email: body.email,
              name: body.name,
              passwordHash: await hashPassword(provisional),
              roleId: clientRole.id,
              clientId: row.id,
              mustChangePassword: true,
            },
          });

          // Enfileirado na MESMA transação: se algo falhar aqui, não sai e-mail
          // com senha de um cliente que não foi criado.
          await enqueueEmail(tx, {
            dedupeKey: `client.provisional:${row.id}`,
            recipients: [body.email],
            subject: 'Seu acesso ao Air Charter Manager',
            template: 'senha-provisoria',
            payload: {
              name: body.name,
              email: body.email,
              password: provisional,
              link: `${env.WEB_BASE_URL}/login`,
            },
          });
        }

        await recordChange(tx, { entity: 'client', entityId: row.id, action: 'created' }, user.id);
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'client.create',
            entity: 'client',
            entityId: row.id,
            after: { name: body.name, email: body.email },
          },
        });

        return row;
      });

      void reply.status(201);
      return toClientDTO(created);
    },
  );

  // ---------------------------------------------------------------- atualizar
  route.patch(
    '/:id',
    {
      preValidation: requirePermission('client:update'),
      schema: {
        params: idParamSchema,
        body: updateClientBodySchema,
        response: { 200: clientSchema },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { id } = request.params;
      const body = request.body;

      return prisma.$transaction(async (tx) => {
        const before = await tx.client.findFirst({
          where: { id, deletedAt: null },
          select: { id: true, name: true, email: true },
        });
        if (!before) throw notFound('Cliente');

        const row = await tx.client.update({
          where: { id },
          data: {
            ...(body.name === undefined ? {} : { name: body.name }),
            ...(body.company === undefined ? {} : { company: body.company }),
            ...(body.document === undefined ? {} : { document: body.document }),
            ...(body.email === undefined ? {} : { email: body.email }),
            ...(body.phone === undefined ? {} : { phone: body.phone }),
            ...(body.notes === undefined ? {} : { notes: body.notes }),
          },
          select: clientSelect,
        });

        await recordChange(
          tx,
          { entity: 'client', entityId: id, action: 'updated', clientScopeId: id },
          user.id,
        );
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'client.update',
            entity: 'client',
            entityId: id,
            before: before,
            after: { name: row.name, email: row.email },
          },
        });

        return toClientDTO(row);
      });
    },
  );
}
