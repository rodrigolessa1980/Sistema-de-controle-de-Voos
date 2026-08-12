/**
 * Agenda e disponibilidade — protótipo: `Calendar`/`buildEvents` (operacional) e
 * `CliDisp`/`dayStatus` (cliente).
 *
 * Duas rotas com o MESMO dado por baixo e saídas radicalmente diferentes:
 *
 *   /calendar     → interno. Cliente, aeronave, trajeto, motivo do bloqueio.
 *   /days         → cliente. Só "disponível / ocupado / indisponível" por dia.
 *
 * O protótipo fazia isso com um parâmetro `mask` no mesmo componente. Aqui são
 * rotas e permissões distintas: não existe request do cliente que devolva o
 * calendário completo.
 *
 * Sobre N+1: `dayStatus` do protótipo era 42 dias × frota × todas as viagens, em
 * memória. Aqui são 3 queries fixas por janela, e o cruzamento é O(n).
 */

import {
  availabilityDaySchema,
  BLOCK_KINDS,
  calendarEventSchema,
  calendarQuerySchema,
  createBlockBodySchema,
  dayAvailability,
  idParamSchema,
  okSchema,
  toISODate,
  type AvailabilityDay,
  type CalendarEvent,
} from '@acm/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { recordChange } from '../lib/changefeed';
import { badRequest, notFound } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { requirePermission, requireUser } from '../plugins/rbac';

/** Teto de janela: 92 dias cobre 3 meses de calendário e evita varredura grande. */
const MAX_WINDOW_DAYS = 92;

function assertWindow(from: Date, to: Date): void {
  if (to.getTime() <= from.getTime())
    throw badRequest('O fim da janela deve ser depois do início.');
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  if (days > MAX_WINDOW_DAYS) {
    throw badRequest(`Janela muito grande (máximo ${MAX_WINDOW_DAYS} dias).`);
  }
}

export async function availabilityRoutes(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>();

  // ------------------------------------------------- agenda interna completa
  route.get(
    '/calendar',
    {
      preValidation: requirePermission('availability:read_full'),
      schema: {
        querystring: calendarQuerySchema,
        response: { 200: z.object({ events: z.array(calendarEventSchema) }) },
      },
    },
    async (request) => {
      const from = new Date(request.query.from);
      const to = new Date(request.query.to);
      assertWindow(from, to);

      const aircraftFilter = request.query.aircraftId
        ? { aircraftId: request.query.aircraftId }
        : {};

      // Duas queries para a janela inteira, com cliente e aeronave por include.
      const [trips, blocks] = await Promise.all([
        prisma.trip.findMany({
          where: {
            ...aircraftFilter,
            status: { notIn: ['recusada', 'cancelada'] },
            departureAt: { lte: to },
            returnAt: { gte: from },
          },
          select: {
            id: true,
            origin: true,
            destination: true,
            departureAt: true,
            returnAt: true,
            status: true,
            client: { select: { name: true } },
            aircraft: { select: { prefix: true } },
          },
          orderBy: { departureAt: 'asc' },
        }),
        prisma.aircraftBlock.findMany({
          where: { ...aircraftFilter, startAt: { lte: to }, endAt: { gte: from } },
          select: {
            id: true,
            kind: true,
            reason: true,
            startAt: true,
            endAt: true,
            aircraft: { select: { prefix: true } },
          },
          orderBy: { startAt: 'asc' },
        }),
      ]);

      const events: CalendarEvent[] = [
        ...trips.map((trip) => ({
          id: trip.id,
          kind: 'trip' as const,
          start: trip.departureAt.toISOString(),
          end: trip.returnAt.toISOString(),
          title: `${trip.origin} → ${trip.destination}`,
          subtitle: null,
          clientName: trip.client.name,
          aircraftPrefix: trip.aircraft?.prefix ?? null,
          origin: trip.origin,
          destination: trip.destination,
          status: trip.status,
        })),
        ...blocks.map((block) => ({
          id: block.id,
          kind: block.kind,
          start: block.startAt.toISOString(),
          end: block.endAt.toISOString(),
          title: block.kind === 'manutencao' ? 'Manutenção' : 'Bloqueio',
          subtitle: block.reason,
          clientName: null,
          aircraftPrefix: block.aircraft.prefix,
          origin: null,
          destination: null,
          status: null,
        })),
      ];

      return { events };
    },
  );

  // ------------------------------------------- disponibilidade MASCARADA
  route.get(
    '/days',
    {
      preValidation: requirePermission('availability:read_masked'),
      schema: {
        querystring: calendarQuerySchema.omit({ aircraftId: true }),
        response: { 200: z.object({ days: z.array(availabilityDaySchema) }) },
      },
    },
    async (request) => {
      const from = new Date(request.query.from);
      const to = new Date(request.query.to);
      assertWindow(from, to);

      // 3 queries para a janela toda, independente de quantos dias ela tem.
      const [aircraft, trips, blocks] = await Promise.all([
        prisma.aircraft.findMany({
          where: { deletedAt: null, status: { not: 'indisponivel' } },
          select: { id: true },
        }),
        prisma.trip.findMany({
          where: {
            status: { notIn: ['recusada', 'cancelada'] },
            departureAt: { lte: to },
            returnAt: { gte: from },
          },
          // Nada de cliente, prefixo ou valor: o cliente não vê nada disso.
          select: {
            id: true,
            aircraftId: true,
            departureAt: true,
            returnAt: true,
            status: true,
          },
        }),
        prisma.aircraftBlock.findMany({
          where: { startAt: { lte: to }, endAt: { gte: from } },
          select: { id: true, aircraftId: true, startAt: true, endAt: true, kind: true },
        }),
      ]);

      const aircraftIds = aircraft.map((a) => a.id);

      const fleetInput = {
        aircraftIds,
        trips: trips.map((t) => ({
          id: t.id,
          code: '',
          origin: '',
          destination: '',
          departureAt: t.departureAt,
          returnAt: t.returnAt,
          status: t.status,
          aircraftId: t.aircraftId,
        })),
        blocks: blocks.map((b) => ({
          id: b.id,
          kind: b.kind,
          reason: '',
          startAt: b.startAt,
          endAt: b.endAt,
          aircraftId: b.aircraftId,
        })),
      };

      const days: AvailabilityDay[] = [];
      const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
      const last = new Date(to.getFullYear(), to.getMonth(), to.getDate());

      // A mesma função de domínio que o frontend usaria — sem divergência.
      while (cursor.getTime() <= last.getTime()) {
        days.push({
          date: toISODate(cursor),
          status: aircraftIds.length === 0 ? 'indisponivel' : dayAvailability(fleetInput, cursor),
        });
        cursor.setDate(cursor.getDate() + 1);
      }

      return { days };
    },
  );

  // ----------------------------------------------- bloqueios e manutenções
  route.get(
    '/blocks',
    {
      preValidation: requirePermission('block:read'),
      schema: {
        querystring: calendarQuerySchema,
        response: {
          200: z.object({
            blocks: z.array(
              z.object({
                id: z.string(),
                aircraftId: z.string(),
                aircraftPrefix: z.string(),
                kind: z.enum(BLOCK_KINDS),
                reason: z.string(),
                startAt: z.string(),
                endAt: z.string(),
              }),
            ),
          }),
        },
      },
    },
    async (request) => {
      const from = new Date(request.query.from);
      const to = new Date(request.query.to);
      assertWindow(from, to);

      const rows = await prisma.aircraftBlock.findMany({
        where: {
          ...(request.query.aircraftId ? { aircraftId: request.query.aircraftId } : {}),
          startAt: { lte: to },
          endAt: { gte: from },
        },
        select: {
          id: true,
          aircraftId: true,
          kind: true,
          reason: true,
          startAt: true,
          endAt: true,
          aircraft: { select: { prefix: true } },
        },
        orderBy: { startAt: 'asc' },
      });

      return {
        blocks: rows.map((b) => ({
          id: b.id,
          aircraftId: b.aircraftId,
          aircraftPrefix: b.aircraft.prefix,
          kind: b.kind,
          reason: b.reason,
          startAt: b.startAt.toISOString(),
          endAt: b.endAt.toISOString(),
        })),
      };
    },
  );

  route.post(
    '/blocks',
    {
      preValidation: requirePermission('block:create'),
      schema: {
        body: createBlockBodySchema,
        response: { 201: z.object({ id: z.string() }) },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const body = request.body;

      const created = await prisma.$transaction(async (tx) => {
        const aircraft = await tx.aircraft.findFirst({
          where: { id: body.aircraftId, deletedAt: null },
          select: { id: true },
        });
        if (!aircraft) throw notFound('Aeronave');

        const block = await tx.aircraftBlock.create({
          data: {
            aircraftId: body.aircraftId,
            kind: body.kind,
            reason: body.reason,
            startAt: new Date(body.startAt),
            endAt: new Date(body.endAt),
            createdById: user.id,
          },
          select: { id: true },
        });

        await recordChange(tx, { entity: 'block', entityId: block.id, action: 'created' }, user.id);
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'block.create',
            entity: 'block',
            entityId: block.id,
            after: { kind: body.kind, reason: body.reason },
          },
        });

        return block;
      });

      void reply.status(201);
      return created;
    },
  );

  route.delete(
    '/blocks/:id',
    {
      preValidation: requirePermission('block:delete'),
      schema: { params: idParamSchema, response: { 200: okSchema } },
    },
    async (request) => {
      const user = requireUser(request);
      const { id } = request.params;

      await prisma.$transaction(async (tx) => {
        const block = await tx.aircraftBlock.findUnique({ where: { id }, select: { id: true } });
        if (!block) throw notFound('Bloqueio');

        await tx.aircraftBlock.delete({ where: { id } });
        await recordChange(tx, { entity: 'block', entityId: id, action: 'deleted' }, user.id);
        await tx.auditLog.create({
          data: { userId: user.id, action: 'block.delete', entity: 'block', entityId: id },
        });
      });

      return { ok: true } as const;
    },
  );
}
