/**
 * Solicitações de voo — protótipo: `CliSolicitar` e `OpSolicitacoes`.
 *
 * O CLIENTE solicita; o OPERACIONAL analisa e converte em viagem. É o único
 * fluxo em que o documento com foto de cada passageiro é obrigatório.
 *
 * Requisito do Rodrigo (12/08/2026): toda solicitação nova dispara e-mail para
 * quem aprova, ALÉM do aviso no sino. Ver `notifyApprovers` no fim do arquivo.
 */

import {
  createFlightRequestBodySchema,
  flightRequestSchema,
  idParamSchema,
  listRequestQuerySchema,
  paginated,
  rejectRequestBodySchema,
  SCHEDULE_PROBLEM_MESSAGES,
  validatePassengers,
  validateScheduleWindow,
  type FlightRequest,
} from '@acm/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { recordChanges } from '../lib/changefeed';
import { nextCode } from '../lib/codes';
import { conflict, notFound, unprocessable } from '../lib/errors';
import { enqueueEmail, requestEmailPayload } from '../lib/mailer';
import { buildPage, cursorArgs, searchTerm } from '../lib/pagination';
import { type Prisma, prisma, type Db } from '../lib/prisma';
import {
  clientScope,
  isClientRole,
  ownClientId,
  requireAnyPermission,
  requirePermission,
  requireUser,
} from '../plugins/rbac';
import { assertDocumentsExist, createPassengers } from './trip';
import { getSettings } from './settings';

const requestSelect = {
  id: true,
  code: true,
  clientId: true,
  origin: true,
  destination: true,
  departureAt: true,
  returnAt: true,
  passengers: true,
  notes: true,
  status: true,
  tripId: true,
  rejectionReason: true,
  createdAt: true,
  client: { select: { id: true, name: true, company: true } },
  pax: {
    select: { id: true, name: true, position: true, documentFileId: true },
    orderBy: { position: 'asc' },
  },
} as const;

type RequestRow = Prisma.FlightRequestGetPayload<{ select: typeof requestSelect }>;

export function toRequestDTO(row: RequestRow): FlightRequest {
  return {
    id: row.id,
    code: row.code,
    clientId: row.clientId,
    client: row.client,
    origin: row.origin,
    destination: row.destination,
    departureAt: row.departureAt.toISOString(),
    returnAt: row.returnAt.toISOString(),
    passengers: row.passengers,
    notes: row.notes,
    status: row.status,
    tripId: row.tripId,
    rejectionReason: row.rejectionReason,
    pax: row.pax.map((p) => ({
      id: p.id,
      name: p.name,
      position: p.position,
      documentFileId: p.documentFileId,
      hasDocument: p.documentFileId !== null,
    })),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function requestRoutes(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>();

  // ------------------------------------------------------------------- listar
  route.get(
    '/',
    {
      preValidation: requireAnyPermission('request:read', 'request:read_own'),
      schema: {
        querystring: listRequestQuerySchema,
        response: { 200: paginated(flightRequestSchema) },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { limit, cursor, q, status, clientId } = request.query;
      const term = searchTerm(q);

      const rows = await prisma.flightRequest.findMany({
        where: {
          ...clientScope(user),
          ...(status ? { status } : {}),
          ...(clientId && !isClientRole(user) ? { clientId } : {}),
          ...(term
            ? {
                OR: [
                  { code: { contains: term } },
                  { origin: { contains: term } },
                  { destination: { contains: term } },
                  { client: { name: { contains: term } } },
                ],
              }
            : {}),
        },
        select: requestSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...cursorArgs({ cursor, limit }),
      });

      return buildPage(rows, limit, toRequestDTO);
    },
  );

  route.get(
    '/:id',
    {
      preValidation: requireAnyPermission('request:read', 'request:read_own'),
      schema: { params: idParamSchema, response: { 200: flightRequestSchema } },
    },
    async (request) => {
      const user = requireUser(request);
      const row = await prisma.flightRequest.findFirst({
        where: { id: request.params.id, ...clientScope(user) },
        select: requestSelect,
      });
      if (!row) throw notFound('Solicitação');
      return toRequestDTO(row);
    },
  );

  // -------------------------------------------------- criar (só o CLIENTE)
  route.post(
    '/',
    {
      preValidation: requirePermission('request:create_own'),
      schema: { body: createFlightRequestBodySchema, response: { 201: flightRequestSchema } },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const clientId = ownClientId(user);
      const body = request.body;
      const now = new Date();

      const departureAt = new Date(body.departureAt);
      const returnAt = new Date(body.returnAt);

      // Documento com foto é OBRIGATÓRIO quando quem solicita é o cliente.
      const problems = [
        ...validateScheduleWindow({ departureAt, returnAt, now }),
        ...validatePassengers(body.pax, true),
      ];
      if (problems.length > 0) {
        throw unprocessable(SCHEDULE_PROBLEM_MESSAGES[problems[0] as never], problems);
      }

      const created = await prisma.$transaction(async (tx) => {
        await assertDocumentsExist(tx, body.pax);

        const client = await tx.client.findFirst({
          where: { id: clientId, deletedAt: null },
          select: { id: true, name: true },
        });
        if (!client) throw notFound('Cliente');

        const code = await nextCode(tx, 'request');

        const created = await tx.flightRequest.create({
          data: {
            code,
            clientId,
            origin: body.origin,
            destination: body.destination,
            departureAt,
            returnAt,
            passengers: body.pax.length,
            notes: body.notes ?? null,
            status: 'aguardando_analise',
          },
          select: { id: true },
        });

        await createPassengers(tx, body.pax, { requestId: created.id });

        // ---- os dois avisos, na MESMA transação da solicitação ----
        await notifyApprovers(tx, {
          requestId: created.id,
          code,
          clientName: client.name,
          origin: body.origin,
          destination: body.destination,
          departureAt,
          returnAt,
          passengers: body.pax.length,
          notes: body.notes ?? null,
        });

        await recordChanges(
          tx,
          [{ entity: 'request', entityId: created.id, action: 'created', clientScopeId: clientId }],
          user.id,
        );

        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'request.create',
            entity: 'request',
            entityId: created.id,
            after: { code, clientId },
          },
        });

        return tx.flightRequest.findUniqueOrThrow({
          where: { id: created.id },
          select: requestSelect,
        });
      });

      void reply.status(201);
      return toRequestDTO(created);
    },
  );

  // ------------------------------------------------------- marcar em análise
  route.post(
    '/:id/review',
    {
      preValidation: requirePermission('request:review'),
      schema: { params: idParamSchema, response: { 200: flightRequestSchema } },
    },
    async (request) => {
      const user = requireUser(request);
      const { id } = request.params;

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.flightRequest.findUnique({
          where: { id },
          select: { id: true, status: true, clientId: true },
        });
        if (!row) throw notFound('Solicitação');
        if (row.status !== 'aguardando_analise') {
          throw conflict(`Solicitação já está "${row.status}".`);
        }

        await tx.flightRequest.update({
          where: { id },
          data: { status: 'em_analise', reviewedById: user.id, reviewedAt: new Date() },
        });

        await recordChanges(
          tx,
          [{ entity: 'request', entityId: id, action: 'updated', clientScopeId: row.clientId }],
          user.id,
        );

        return tx.flightRequest.findUniqueOrThrow({ where: { id }, select: requestSelect });
      });

      return toRequestDTO(updated);
    },
  );

  // ------------------------------------------------------------------ recusar
  route.post(
    '/:id/reject',
    {
      preValidation: requirePermission('request:reject'),
      schema: {
        params: idParamSchema,
        body: rejectRequestBodySchema,
        response: { 200: flightRequestSchema },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { id } = request.params;
      const now = new Date();

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.flightRequest.findUnique({
          where: { id },
          select: { id: true, code: true, status: true, clientId: true },
        });
        if (!row) throw notFound('Solicitação');
        if (row.status === 'convertida') {
          throw conflict('Solicitação já convertida em viagem não pode ser recusada.');
        }
        if (row.status === 'recusada') throw conflict('Solicitação já recusada.');

        await tx.flightRequest.update({
          where: { id },
          data: {
            status: 'recusada',
            rejectionReason: request.body.reason ?? null,
            reviewedById: user.id,
            reviewedAt: now,
          },
        });

        const portalUser = await tx.user.findFirst({
          where: { clientId: row.clientId, status: 'ativo' },
          select: { id: true },
        });
        if (portalUser) {
          await tx.notification.create({
            data: {
              userId: portalUser.id,
              type: 'solicitacao_recusada',
              title: `Solicitação ${row.code} recusada`,
              body: request.body.reason ?? null,
              entity: 'request',
              entityId: id,
            },
          });
        }

        await recordChanges(
          tx,
          [{ entity: 'request', entityId: id, action: 'updated', clientScopeId: row.clientId }],
          user.id,
        );

        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'request.reject',
            entity: 'request',
            entityId: id,
            after: { reason: request.body.reason ?? null },
          },
        });

        return tx.flightRequest.findUniqueOrThrow({ where: { id }, select: requestSelect });
      });

      return toRequestDTO(updated);
    },
  );
}

// ============================================================================
//  AVISOS DE NOVA SOLICITAÇÃO  (docs/PLANO.md §13)
// ============================================================================

interface NotifyInput {
  requestId: string;
  code: string;
  clientName: string;
  origin: string;
  destination: string;
  departureAt: Date;
  returnAt: Date;
  passengers: number;
  notes: string | null;
}

/**
 * Quem aprova é resolvido por PERMISSÃO, não por e-mail fixo no código.
 *
 * Fixar o endereço da Fernanda significaria que, no dia em que ela sair de
 * férias, ninguém seria avisado. Amarrando em `request:review`, quem entrar no
 * perfil passa a receber automaticamente, sem deploy.
 *
 * Um `deny` explícito no usuário tira ele da lista — a mesma regra de
 * precedência do RBAC (deny vence).
 */
async function findApprovers(tx: Db): Promise<{ id: string; email: string; name: string }[]> {
  const users = await tx.user.findMany({
    where: {
      status: 'ativo',
      deletedAt: null,
      role: { permissions: { some: { permission: { key: 'request:review' } } } },
    },
    select: {
      id: true,
      email: true,
      name: true,
      permissionOverrides: {
        where: { permission: { key: 'request:review' }, effect: 'deny' },
        select: { effect: true },
      },
    },
  });

  return users
    .filter((u) => u.permissionOverrides.length === 0)
    .map((u) => ({ id: u.id, email: u.email, name: u.name }));
}

/**
 * Dispara os DOIS canais: sino no sistema e e-mail.
 *
 * Chamada de dentro da transação da solicitação. O e-mail é ENFILEIRADO, nunca
 * enviado aqui: se a transação falhar, o aviso some junto; se o provedor estiver
 * fora do ar, o worker tenta de novo (docs/PLANO.md §13.2).
 */
async function notifyApprovers(tx: Db, input: NotifyInput): Promise<void> {
  const settings = await getSettings(tx);
  const approvers = await findApprovers(tx);

  // --- canal 1: sino no sistema. Um insert para todos os aprovadores.
  if (approvers.length > 0) {
    await tx.notification.createMany({
      data: approvers.map((approver) => ({
        userId: approver.id,
        type: 'solicitacao_nova' as const,
        title: `Nova solicitação ${input.code}`,
        body: `${input.clientName} · ${input.origin} → ${input.destination}`,
        entity: 'request',
        entityId: input.requestId,
      })),
    });
  }

  if (!settings.notifyOnNewRequest) return;

  // --- canal 2: e-mail.
  const extras = (settings.notifyExtraEmails ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);

  await enqueueEmail(tx, {
    // Idempotência: retry do worker ou duplo clique não gera segundo e-mail.
    dedupeKey: `request.created:${input.requestId}`,
    recipients: [...approvers.map((a) => a.email), settings.contactEmail, ...extras],
    subject: `Nova solicitação de voo ${input.code} — aprovação pendente`,
    template: 'solicitacao-nova',
    // Sem dado sensível: o documento do passageiro NÃO viaja por e-mail.
    payload: requestEmailPayload(input),
  });
}
