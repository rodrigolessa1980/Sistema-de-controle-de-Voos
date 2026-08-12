/**
 * Tarifas — protótipo: aba "Tarifas" de `OpConfig` + `TariffForm`.
 *
 * `value` é sempre a soma dos 4 custos, calculada NO SERVIDOR. O protótipo
 * confiava no total que o formulário mandava; aqui o cliente pode mandar o que
 * quiser e o valor gravado é o recalculado.
 */

import {
  createTariffBodySchema,
  idParamSchema,
  listTariffQuerySchema,
  paginated,
  tariffSchema,
  tariffTotal,
  updateTariffBodySchema,
  type Tariff,
} from '@acm/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { recordChange } from '../lib/changefeed';
import { notFound } from '../lib/errors';
import { buildPage, cursorArgs } from '../lib/pagination';
import { decimalToMoneyStrict, type Prisma, prisma, toDecimal } from '../lib/prisma';
import { requirePermission, requireUser } from '../plugins/rbac';

const tariffSelect = {
  id: true,
  aircraftId: true,
  value: true,
  costFuel: true,
  costFlightHour: true,
  costFees: true,
  costPilot: true,
  unit: true,
  startDate: true,
  endDate: true,
  active: true,
  // Relação por include: evita uma consulta de aeronave por linha (N+1).
  aircraft: { select: { id: true, prefix: true, kind: true, model: true } },
} as const;

type TariffRow = Prisma.TariffGetPayload<{ select: typeof tariffSelect }>;

const utcDate = (d: Date): string => d.toISOString().slice(0, 10);

export function toTariffDTO(row: TariffRow): Tariff {
  return {
    id: row.id,
    aircraftId: row.aircraftId,
    aircraft: row.aircraft,
    value: decimalToMoneyStrict(row.value),
    costFuel: decimalToMoneyStrict(row.costFuel),
    costFlightHour: decimalToMoneyStrict(row.costFlightHour),
    costFees: decimalToMoneyStrict(row.costFees),
    costPilot: decimalToMoneyStrict(row.costPilot),
    unit: row.unit,
    startDate: utcDate(row.startDate),
    endDate: row.endDate === null ? null : utcDate(row.endDate),
    active: row.active,
  };
}

/**
 * Tarifa ativa de uma aeronave.
 *
 * Protótipo: `db.tariffs.find(t => t.aircraftId === X && t.active)` — varredura
 * linear. Aqui é o índice `[aircraftId, active, startDate]`, e com o filtro de
 * vigência que o protótipo declarava mas não aplicava.
 */
export async function findActiveTariff(
  db: Prisma.TransactionClient | typeof prisma,
  aircraftId: string,
  reference: Date,
): Promise<TariffRow | null> {
  return db.tariff.findFirst({
    where: {
      aircraftId,
      active: true,
      startDate: { lte: reference },
      OR: [{ endDate: null }, { endDate: { gte: reference } }],
    },
    select: tariffSelect,
    orderBy: { startDate: 'desc' },
  });
}

export async function tariffRoutes(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.get(
    '/',
    {
      preValidation: requirePermission('tariff:read'),
      schema: { querystring: listTariffQuerySchema, response: { 200: paginated(tariffSchema) } },
    },
    async (request) => {
      const { limit, cursor, aircraftId, active } = request.query;

      const rows = await prisma.tariff.findMany({
        where: {
          ...(aircraftId ? { aircraftId } : {}),
          ...(active === undefined ? {} : { active }),
          aircraft: { deletedAt: null },
        },
        select: tariffSelect,
        orderBy: [{ active: 'desc' }, { startDate: 'desc' }, { id: 'asc' }],
        ...cursorArgs({ cursor, limit }),
      });

      return buildPage(rows, limit, toTariffDTO);
    },
  );

  route.post(
    '/',
    {
      preValidation: requirePermission('tariff:create'),
      schema: { body: createTariffBodySchema, response: { 201: tariffSchema } },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const body = request.body;

      // O total é derivado, nunca recebido.
      const value = tariffTotal({
        costFuel: body.costFuel,
        costFlightHour: body.costFlightHour,
        costFees: body.costFees,
        costPilot: body.costPilot,
      });

      const created = await prisma.$transaction(async (tx) => {
        const aircraft = await tx.aircraft.findFirst({
          where: { id: body.aircraftId, deletedAt: null },
          select: { id: true },
        });
        if (!aircraft) throw notFound('Aeronave');

        const row = await tx.tariff.create({
          data: {
            aircraftId: body.aircraftId,
            value: toDecimal(value),
            costFuel: toDecimal(body.costFuel),
            costFlightHour: toDecimal(body.costFlightHour),
            costFees: toDecimal(body.costFees),
            costPilot: toDecimal(body.costPilot),
            unit: body.unit,
            startDate: new Date(`${body.startDate}T00:00:00.000Z`),
            endDate: body.endDate ? new Date(`${body.endDate}T00:00:00.000Z`) : null,
            active: body.active,
          },
          select: tariffSelect,
        });

        await recordChange(tx, { entity: 'tariff', entityId: row.id, action: 'created' }, user.id);
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'tariff.create',
            entity: 'tariff',
            entityId: row.id,
            after: { value, aircraftId: body.aircraftId },
          },
        });

        return row;
      });

      void reply.status(201);
      return toTariffDTO(created);
    },
  );

  route.patch(
    '/:id',
    {
      preValidation: requirePermission('tariff:update'),
      schema: {
        params: idParamSchema,
        body: updateTariffBodySchema,
        response: { 200: tariffSchema },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { id } = request.params;
      const body = request.body;

      return prisma.$transaction(async (tx) => {
        const before = await tx.tariff.findUnique({ where: { id }, select: tariffSelect });
        if (!before) throw notFound('Tarifa');

        // Os custos que não vieram no PATCH permanecem; o total é recalculado
        // sobre a composição resultante.
        const costs = {
          costFuel: body.costFuel ?? decimalToMoneyStrict(before.costFuel),
          costFlightHour: body.costFlightHour ?? decimalToMoneyStrict(before.costFlightHour),
          costFees: body.costFees ?? decimalToMoneyStrict(before.costFees),
          costPilot: body.costPilot ?? decimalToMoneyStrict(before.costPilot),
        };
        const value = tariffTotal(costs);

        const row = await tx.tariff.update({
          where: { id },
          data: {
            value: toDecimal(value),
            costFuel: toDecimal(costs.costFuel),
            costFlightHour: toDecimal(costs.costFlightHour),
            costFees: toDecimal(costs.costFees),
            costPilot: toDecimal(costs.costPilot),
            ...(body.unit === undefined ? {} : { unit: body.unit }),
            ...(body.startDate === undefined
              ? {}
              : { startDate: new Date(`${body.startDate}T00:00:00.000Z`) }),
            ...(body.endDate === undefined
              ? {}
              : { endDate: body.endDate ? new Date(`${body.endDate}T00:00:00.000Z`) : null }),
            ...(body.active === undefined ? {} : { active: body.active }),
          },
          select: tariffSelect,
        });

        await recordChange(tx, { entity: 'tariff', entityId: id, action: 'updated' }, user.id);
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'tariff.update',
            entity: 'tariff',
            entityId: id,
            before: { value: decimalToMoneyStrict(before.value) },
            after: { value },
          },
        });

        return toTariffDTO(row);
      });
    },
  );
}
