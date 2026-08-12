/**
 * Aeronaves — protótipo: `OpAeronaves` + `AircraftForm`.
 *
 * Área interna. Nenhuma rota aqui é alcançável pelo perfil `cliente`: a
 * permissão `aircraft:read` não existe na matriz dele (packages/shared).
 */

import {
  aircraftSchema,
  createAircraftBodySchema,
  idParamSchema,
  listAircraftQuerySchema,
  okSchema,
  paginated,
  updateAircraftBodySchema,
  type Aircraft,
} from '@acm/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { recordChange } from '../lib/changefeed';
import { conflict, notFound } from '../lib/errors';
import { buildPage, cursorArgs, searchTerm } from '../lib/pagination';
import { type Prisma, prisma } from '../lib/prisma';
import { requirePermission, requireUser } from '../plugins/rbac';

type AircraftRow = Prisma.AircraftGetPayload<{
  select: {
    id: true;
    prefix: true;
    kind: true;
    model: true;
    manufacturer: true;
    capacity: true;
    cruiseSpeed: true;
    status: true;
    notes: true;
  };
}>;

const aircraftSelect = {
  id: true,
  prefix: true,
  kind: true,
  model: true,
  manufacturer: true,
  capacity: true,
  cruiseSpeed: true,
  status: true,
  notes: true,
} as const;

export function toAircraftDTO(row: AircraftRow): Aircraft {
  return {
    id: row.id,
    prefix: row.prefix,
    kind: row.kind,
    model: row.model,
    manufacturer: row.manufacturer,
    capacity: row.capacity,
    cruiseSpeed: row.cruiseSpeed,
    status: row.status,
    notes: row.notes,
  };
}

export async function aircraftRoutes(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>();

  // ------------------------------------------------------------------- listar
  route.get(
    '/',
    {
      preValidation: requirePermission('aircraft:read'),
      schema: {
        querystring: listAircraftQuerySchema,
        response: { 200: paginated(aircraftSchema) },
      },
    },
    async (request) => {
      const { limit, cursor, q, status, kind } = request.query;
      const term = searchTerm(q);

      const rows = await prisma.aircraft.findMany({
        where: {
          deletedAt: null,
          ...(status ? { status } : {}),
          ...(kind ? { kind } : {}),
          // Busca no banco, não em memória (protótipo filtrava o array inteiro).
          ...(term
            ? {
                OR: [
                  { prefix: { contains: term } },
                  { model: { contains: term } },
                  { manufacturer: { contains: term } },
                ],
              }
            : {}),
        },
        select: aircraftSelect,
        orderBy: [{ prefix: 'asc' }, { id: 'asc' }],
        ...cursorArgs({ cursor, limit }),
      });

      return buildPage(rows, limit, toAircraftDTO);
    },
  );

  // -------------------------------------------------------------------- obter
  route.get(
    '/:id',
    {
      preValidation: requirePermission('aircraft:read'),
      schema: { params: idParamSchema, response: { 200: aircraftSchema } },
    },
    async (request) => {
      const row = await prisma.aircraft.findFirst({
        where: { id: request.params.id, deletedAt: null },
        select: aircraftSelect,
      });
      if (!row) throw notFound('Aeronave');
      return toAircraftDTO(row);
    },
  );

  // ------------------------------------------------------------------- criar
  route.post(
    '/',
    {
      preValidation: requirePermission('aircraft:create'),
      schema: { body: createAircraftBodySchema, response: { 201: aircraftSchema } },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const body = request.body;

      const created = await prisma.$transaction(async (tx) => {
        const row = await tx.aircraft.create({
          data: {
            prefix: body.prefix,
            kind: body.kind,
            model: body.model,
            manufacturer: body.manufacturer,
            capacity: body.capacity,
            cruiseSpeed: body.cruiseSpeed,
            status: body.status,
            notes: body.notes ?? null,
          },
          select: aircraftSelect,
        });

        await recordChange(
          tx,
          { entity: 'aircraft', entityId: row.id, action: 'created' },
          user.id,
        );
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'aircraft.create',
            entity: 'aircraft',
            entityId: row.id,
            after: row,
          },
        });

        return row;
      });

      void reply.status(201);
      return toAircraftDTO(created);
    },
  );

  // ----------------------------------------------------------------- atualizar
  route.patch(
    '/:id',
    {
      preValidation: requirePermission('aircraft:update'),
      schema: {
        params: idParamSchema,
        body: updateAircraftBodySchema,
        response: { 200: aircraftSchema },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { id } = request.params;
      const body = request.body;

      return prisma.$transaction(async (tx) => {
        const before = await tx.aircraft.findFirst({
          where: { id, deletedAt: null },
          select: aircraftSelect,
        });
        if (!before) throw notFound('Aeronave');

        const row = await tx.aircraft.update({
          where: { id },
          data: {
            ...(body.prefix === undefined ? {} : { prefix: body.prefix }),
            ...(body.kind === undefined ? {} : { kind: body.kind }),
            ...(body.model === undefined ? {} : { model: body.model }),
            ...(body.manufacturer === undefined ? {} : { manufacturer: body.manufacturer }),
            ...(body.capacity === undefined ? {} : { capacity: body.capacity }),
            ...(body.cruiseSpeed === undefined ? {} : { cruiseSpeed: body.cruiseSpeed }),
            ...(body.status === undefined ? {} : { status: body.status }),
            ...(body.notes === undefined ? {} : { notes: body.notes }),
          },
          select: aircraftSelect,
        });

        await recordChange(tx, { entity: 'aircraft', entityId: id, action: 'updated' }, user.id);
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'aircraft.update',
            entity: 'aircraft',
            entityId: id,
            before: before,
            after: row,
          },
        });

        return toAircraftDTO(row);
      });
    },
  );

  // ------------------------------------------------------------------ remover
  //
  // Remoção LÓGICA. O protótipo fazia `aircraft.filter(a => a.id !== id)`, o que
  // apagaria a aeronave de viagens já concluídas e quebraria o histórico. Aqui
  // ela sai das listas mas o vínculo continua íntegro.
  route.delete(
    '/:id',
    {
      preValidation: requirePermission('aircraft:delete'),
      schema: { params: idParamSchema, response: { 200: okSchema } },
    },
    async (request) => {
      const user = requireUser(request);
      const { id } = request.params;
      const now = new Date();

      return prisma.$transaction(async (tx) => {
        const aircraft = await tx.aircraft.findFirst({
          where: { id, deletedAt: null },
          select: { id: true, prefix: true },
        });
        if (!aircraft) throw notFound('Aeronave');

        // Bloqueia se há compromisso futuro: remover a aeronave de um voo já
        // agendado deixaria a viagem sem equipamento, silenciosamente.
        const upcoming = await tx.trip.count({
          where: {
            aircraftId: id,
            status: { in: ['confirmada', 'em_andamento'] },
            returnAt: { gte: now },
          },
        });

        if (upcoming > 0) {
          throw conflict(
            `${aircraft.prefix} tem ${upcoming} voo(s) agendado(s). Cancele ou remaneje antes de remover.`,
          );
        }

        await tx.aircraft.update({
          where: { id },
          data: { deletedAt: now, status: 'indisponivel' },
        });
        await tx.tariff.updateMany({ where: { aircraftId: id }, data: { active: false } });

        await recordChange(tx, { entity: 'aircraft', entityId: id, action: 'deleted' }, user.id);
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'aircraft.delete',
            entity: 'aircraft',
            entityId: id,
            before: aircraft,
          },
        });

        return { ok: true } as const;
      });
    },
  );
}
