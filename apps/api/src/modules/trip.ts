/**
 * Viagens — protótipo: `OpViagens`, `TripForm`, `CliViagens`.
 *
 * Concentra as decisões mais importantes do sistema:
 *
 * - O OPERACIONAL agenda direto: a viagem nasce `confirmada`. Não existe aceite
 *   do cliente (decisão do Rodrigo em 12/08/2026 — docs/PLANO.md §12).
 * - `checkConflict` roda no SERVIDOR. No protótipo era só no formulário, ou
 *   seja, duas pessoas agendando ao mesmo tempo criavam voo sobreposto.
 * - Precificação é calculada aqui e congelada na viagem. O cliente pode mandar
 *   `commercialValue`, mas `internalTariff`, `flightHours` e `estimatedValue`
 *   vêm da tarifa vigente, nunca do request.
 * - DTO por perfil: `tripInternalSchema` vs `tripClientSchema`.
 */

import {
  calculatePricing,
  cancelTripBodySchema,
  checkAvailabilityBodySchema,
  availabilityResultSchema,
  checkConflict,
  createTripBodySchema,
  idParamSchema,
  listTripQuerySchema,
  LOCKED_TRIP_STATUSES,
  okSchema,
  paginated,
  pricingPreviewQuerySchema,
  pricingPreviewSchema,
  tripClientSchema,
  tripInternalSchema,
  updateTripBodySchema,
  validatePassengers,
  validateScheduleWindow,
  SCHEDULE_PROBLEM_MESSAGES,
  type PassengerInputBody,
  type TripClient,
  type TripInternal,
} from '@acm/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { refreshClientAggregates } from '../lib/aggregates';
import { recordChanges } from '../lib/changefeed';
import { nextCode } from '../lib/codes';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../lib/errors';
import { buildPage, cursorArgs, searchTerm } from '../lib/pagination';
import { decimalToMoney, Prisma, prisma, toDecimal, toDecimalOrNull, type Db } from '../lib/prisma';
import {
  clientScope,
  isClientRole,
  requireAnyPermission,
  requirePermission,
  requireUser,
} from '../plugins/rbac';
import { findActiveTariff } from './tariff';
import { getSettings } from './settings';

// ============================================================================
//  SELECT E DTO
// ============================================================================

const tripSelect = {
  id: true,
  code: true,
  clientId: true,
  aircraftId: true,
  origin: true,
  destination: true,
  departureAt: true,
  returnAt: true,
  distanceKm: true,
  passengers: true,
  notes: true,
  status: true,
  tariffId: true,
  internalTariff: true,
  flightHours: true,
  estimatedValue: true,
  commercialValue: true,
  scheduledWithDebt: true,
  cancelReason: true,
  createdAt: true,
  // Tudo por include: uma query traz cliente, aeronave e passageiros.
  client: { select: { id: true, name: true, company: true } },
  aircraft: { select: { id: true, prefix: true, kind: true, model: true, cruiseSpeed: true } },
  pax: {
    select: { id: true, name: true, position: true, documentFileId: true },
    orderBy: { position: 'asc' },
  },
} as const;

type TripRow = Prisma.TripGetPayload<{ select: typeof tripSelect }>;

function paxDTO(rows: TripRow['pax']) {
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    position: p.position,
    documentFileId: p.documentFileId,
    hasDocument: p.documentFileId !== null,
  }));
}

/** Viagem para perfis internos: com aeronave e com os números da tarifa. */
export function toTripInternalDTO(row: TripRow): TripInternal {
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
    pax: paxDTO(row.pax),
    createdAt: row.createdAt.toISOString(),
    aircraftId: row.aircraftId,
    aircraft: row.aircraft,
    distanceKm: row.distanceKm === null ? null : row.distanceKm.toNumber(),
    tariffId: row.tariffId,
    internalTariff: decimalToMoney(row.internalTariff),
    flightHours: row.flightHours === null ? null : row.flightHours.toNumber(),
    estimatedValue: decimalToMoney(row.estimatedValue),
    commercialValue: decimalToMoney(row.commercialValue),
    scheduledWithDebt: row.scheduledWithDebt,
    cancelReason: row.cancelReason,
  };
}

/**
 * Viagem para o CLIENTE.
 *
 * Aqui mora a regra "cliente nunca vê aeronave, prefixo, modelo, tipo nem
 * tarifa interna". Como o tipo de retorno é `TripClient` — e não `TripInternal`
 * com campos opcionais — devolver o objeto errado é erro de compilação.
 */
export function toTripClientDTO(row: TripRow): TripClient {
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
    pax: paxDTO(row.pax),
    createdAt: row.createdAt.toISOString(),
  };
}

// ============================================================================
//  CONFLITO DE AGENDA
// ============================================================================

/**
 * Busca os compromissos da aeronave numa JANELA de tempo e roda `checkConflict`.
 *
 * A janela é `[início − margem, fim + margem]`, então o índice
 * `[aircraft_id, departure_at, return_at]` resolve em poucas linhas — não é a
 * varredura da tabela inteira que o protótipo fazia em memória.
 */
export async function evaluateConflict(
  db: Db,
  params: {
    aircraftId: string;
    start: Date;
    end: Date;
    marginMinutes: number;
    ignoreTripId?: string | undefined;
  },
): Promise<ReturnType<typeof checkConflict>> {
  const marginMs = Math.max(0, params.marginMinutes) * 60_000;
  const windowStart = new Date(params.start.getTime() - marginMs);
  const windowEnd = new Date(params.end.getTime() + marginMs);

  const [trips, blocks] = await Promise.all([
    db.trip.findMany({
      where: {
        aircraftId: params.aircraftId,
        status: { notIn: ['recusada', 'cancelada'] },
        departureAt: { lte: windowEnd },
        returnAt: { gte: windowStart },
      },
      select: {
        id: true,
        code: true,
        origin: true,
        destination: true,
        departureAt: true,
        returnAt: true,
        status: true,
      },
    }),
    db.aircraftBlock.findMany({
      where: {
        aircraftId: params.aircraftId,
        startAt: { lte: windowEnd },
        endAt: { gte: windowStart },
      },
      select: { id: true, kind: true, reason: true, startAt: true, endAt: true },
    }),
  ]);

  return checkConflict({
    start: params.start,
    end: params.end,
    trips,
    blocks,
    marginMinutes: params.marginMinutes,
    ignoreTripId: params.ignoreTripId,
  });
}

// ============================================================================
//  PRECIFICAÇÃO
// ============================================================================

interface PricingSnapshot {
  tariffId: string | null;
  internalTariff: Prisma.Decimal | null;
  flightHours: Prisma.Decimal | null;
  estimatedValue: Prisma.Decimal | null;
  commercialValue: Prisma.Decimal | null;
}

/**
 * Calcula e congela a precificação.
 *
 * Congelar é intencional: se a tarifa da aeronave mudar em dezembro, a viagem de
 * agosto continua valendo o que valia quando foi agendada.
 */
async function buildPricing(
  db: Db,
  input: {
    aircraftId: string;
    distanceKm: number | null;
    cruiseSpeed: number;
    commercialValue: string | null;
    reference: Date;
  },
): Promise<PricingSnapshot> {
  const tariff = await findActiveTariff(db, input.aircraftId, input.reference);

  const pricing = calculatePricing({
    tariffValue: tariff === null ? null : tariff.value.toFixed(2),
    distanceKm: input.distanceKm,
    cruiseSpeed: input.cruiseSpeed,
    commercialValue: input.commercialValue,
  });

  return {
    tariffId: tariff?.id ?? null,
    internalTariff: tariff === null ? null : tariff.value,
    flightHours: pricing.hours > 0 ? new Prisma.Decimal(pricing.hours) : null,
    estimatedValue: pricing.hours > 0 ? toDecimal(pricing.estimatedValue) : null,
    commercialValue:
      input.commercialValue !== null
        ? toDecimal(input.commercialValue)
        : pricing.hours > 0
          ? toDecimal(pricing.commercialValue)
          : null,
  };
}

// ============================================================================
//  ROTAS
// ============================================================================

export async function tripRoutes(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>();

  // ------------------------------------------------------------------- listar
  route.get(
    '/',
    {
      preValidation: requireAnyPermission('trip:read', 'trip:read_own'),
      schema: {
        querystring: listTripQuerySchema,
        response: { 200: paginated(tripInternalSchema.or(tripClientSchema)) },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { limit, cursor, q, status, clientId, aircraftId, from, to, upcoming } = request.query;
      const term = searchTerm(q);
      const now = new Date();

      const rows = await prisma.trip.findMany({
        where: {
          // Camada 2: escopo injetado no where. Cliente nunca lê o de outro.
          ...clientScope(user),
          ...(status ? { status } : {}),
          ...(clientId && !isClientRole(user) ? { clientId } : {}),
          ...(aircraftId ? { aircraftId } : {}),
          ...(from || to || upcoming
            ? {
                departureAt: {
                  ...(from ? { gte: new Date(from) } : {}),
                  ...(to ? { lte: new Date(to) } : {}),
                  ...(upcoming ? { gte: now } : {}),
                },
              }
            : {}),
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
        select: tripSelect,
        orderBy: [{ departureAt: 'desc' }, { id: 'asc' }],
        ...cursorArgs({ cursor, limit }),
      });

      return buildPage(rows, limit, isClientRole(user) ? toTripClientDTO : toTripInternalDTO);
    },
  );

  // ------------------------------------------- disponibilidade (checkConflict)
  route.post(
    '/check-availability',
    {
      preValidation: requirePermission('trip:create'),
      schema: { body: checkAvailabilityBodySchema, response: { 200: availabilityResultSchema } },
    },
    async (request) => {
      const body = request.body;
      const settings = await getSettings();

      const result = await evaluateConflict(prisma, {
        aircraftId: body.aircraftId,
        start: new Date(body.departureAt),
        end: new Date(body.returnAt),
        marginMinutes: settings.marginMinutes,
        ignoreTripId: body.ignoreTripId ?? undefined,
      });

      return {
        available: !result.conflict,
        reason: result.conflict ? result.reason : null,
        label: result.conflict ? result.label : null,
        marginMinutes: settings.marginMinutes,
      };
    },
  );

  // ----------------------------------------------- prévia do cálculo de tarifa
  route.get(
    '/pricing-preview',
    {
      preValidation: requirePermission('tariff:read'),
      schema: { querystring: pricingPreviewQuerySchema, response: { 200: pricingPreviewSchema } },
    },
    async (request) => {
      const { aircraftId, distanceKm } = request.query;

      const [aircraft, tariff] = await Promise.all([
        prisma.aircraft.findFirst({
          where: { id: aircraftId, deletedAt: null },
          select: { cruiseSpeed: true },
        }),
        findActiveTariff(prisma, aircraftId, new Date()),
      ]);

      if (!aircraft) throw notFound('Aeronave');

      const pricing = calculatePricing({
        tariffValue: tariff === null ? null : tariff.value.toFixed(2),
        distanceKm: distanceKm ?? null,
        cruiseSpeed: aircraft.cruiseSpeed,
      });

      return {
        tariffId: tariff?.id ?? null,
        tariffValue: tariff === null ? null : tariff.value.toFixed(2),
        costFuel: tariff === null ? null : tariff.costFuel.toFixed(2),
        costFlightHour: tariff === null ? null : tariff.costFlightHour.toFixed(2),
        costFees: tariff === null ? null : tariff.costFees.toFixed(2),
        costPilot: tariff === null ? null : tariff.costPilot.toFixed(2),
        unit: tariff?.unit ?? null,
        cruiseSpeed: aircraft.cruiseSpeed,
        distanceKm: distanceKm ?? 0,
        hours: pricing.hours,
        estimatedValue: pricing.estimatedValue,
      };
    },
  );

  // -------------------------------------------------------------------- obter
  route.get(
    '/:id',
    {
      preValidation: requireAnyPermission('trip:read', 'trip:read_own'),
      schema: {
        params: idParamSchema,
        response: { 200: tripInternalSchema.or(tripClientSchema) },
      },
    },
    async (request) => {
      const user = requireUser(request);

      const row = await prisma.trip.findFirst({
        where: { id: request.params.id, ...clientScope(user) },
        select: tripSelect,
      });
      if (!row) throw notFound('Viagem');

      return isClientRole(user) ? toTripClientDTO(row) : toTripInternalDTO(row);
    },
  );

  // ------------------------------------------------------------------- criar
  route.post(
    '/',
    {
      preValidation: requirePermission('trip:create'),
      schema: { body: createTripBodySchema, response: { 201: tripInternalSchema } },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const body = request.body;
      const now = new Date();

      const departureAt = new Date(body.departureAt);
      const returnAt = new Date(body.returnAt);

      // Mesmas validações do formulário, agora com o servidor como autoridade.
      const problems = [
        ...validateScheduleWindow({ departureAt, returnAt, now }),
        // Documento é opcional quando o operacional cadastra direto.
        ...validatePassengers(body.pax, false),
      ];
      if (problems.length > 0) {
        throw unprocessable(SCHEDULE_PROBLEM_MESSAGES[problems[0] as never], problems);
      }

      // Leituras de VALIDAÇÃO ficam fora da transação, em paralelo.
      //
      // Manter tudo dentro custava ~13 idas ao banco em série; com o MySQL
      // remoto, isso passava do timeout da transação e a viagem falhava sem
      // nenhum problema de domínio. Estas quatro consultas não precisam de
      // atomicidade: se a aeronave for removida entre a leitura e o commit, a
      // FK barra do mesmo jeito.
      //
      // A verificação de CONFLITO continua dentro — essa sim precisa.
      const [client, aircraft, settings] = await Promise.all([
        prisma.client.findFirst({
          where: { id: body.clientId, deletedAt: null },
          select: { id: true, name: true, financialStatus: true, openBalance: true },
        }),
        prisma.aircraft.findFirst({
          where: { id: body.aircraftId, deletedAt: null },
          select: { id: true, prefix: true, cruiseSpeed: true },
        }),
        getSettings(),
      ]);

      if (!client) throw notFound('Cliente');
      if (!aircraft) throw notFound('Aeronave');

      const createdId = await prisma.$transaction(async (tx) => {
        // Conflito verificado DENTRO da transação: é o que impede duas
        // requisições simultâneas de criarem voos sobrepostos.
        const clash = await evaluateConflict(tx, {
          aircraftId: body.aircraftId,
          start: departureAt,
          end: returnAt,
          marginMinutes: settings.marginMinutes,
        });

        if (clash.conflict) {
          throw conflict(
            clash.reason === 'margin'
              ? 'Não há intervalo mínimo suficiente entre este voo e outro compromisso da aeronave.'
              : 'A aeronave já possui um compromisso neste período.',
            { reason: clash.reason, label: clash.label },
          );
        }

        // Pendência financeira: o protótipo pedia confirmação na tela. Aqui o
        // servidor exige `acknowledgeDebt` — a decisão fica registrada.
        const hasDebt = client.financialStatus !== 'em_dia';
        if (hasDebt && !body.acknowledgeDebt) {
          throw unprocessable(
            `${client.name} possui ${client.openBalance.toFixed(2)} em aberto (situação: ${client.financialStatus}). Confirme para agendar mesmo assim.`,
            { code: 'CLIENT_HAS_DEBT', financialStatus: client.financialStatus },
          );
        }

        const pricing = await buildPricing(tx, {
          aircraftId: body.aircraftId,
          distanceKm: body.distanceKm ?? null,
          cruiseSpeed: aircraft.cruiseSpeed,
          commercialValue: body.commercialValue ?? null,
          reference: departureAt,
        });

        const code = await nextCode(tx, 'trip');

        const trip = await tx.trip.create({
          data: {
            code,
            clientId: body.clientId,
            aircraftId: body.aircraftId,
            origin: body.origin,
            destination: body.destination,
            departureAt,
            returnAt,
            distanceKm: toDecimalOrNull(body.distanceKm ?? null),
            passengers: body.pax.length,
            notes: body.notes ?? null,
            // Nasce confirmada: o operacional agenda direto, sem aceite.
            status: 'confirmada',
            tariffId: pricing.tariffId,
            internalTariff: pricing.internalTariff,
            flightHours: pricing.flightHours,
            estimatedValue: pricing.estimatedValue,
            commercialValue: pricing.commercialValue,
            scheduledWithDebt: hasDebt,
            createdById: user.id,
          },
          select: { id: true },
        });

        // Um único INSERT para todos os passageiros, não um por passageiro.
        await createPassengers(tx, body.pax, { tripId: trip.id });

        // Conversão de solicitação: marca a origem como convertida.
        if (body.requestId) {
          const flightRequest = await tx.flightRequest.findUnique({
            where: { id: body.requestId },
            select: { id: true, status: true, clientId: true },
          });

          if (!flightRequest) throw notFound('Solicitação');
          if (flightRequest.status === 'convertida') {
            throw conflict('Esta solicitação já foi convertida em viagem.');
          }

          await tx.flightRequest.update({
            where: { id: body.requestId },
            data: {
              status: 'convertida',
              tripId: trip.id,
              reviewedById: user.id,
              reviewedAt: now,
            },
          });

          await tx.notification.create({
            data: {
              // Notifica o usuário do portal do cliente, se existir.
              userId:
                (
                  await tx.user.findFirst({
                    where: { clientId: flightRequest.clientId, status: 'ativo' },
                    select: { id: true },
                  })
                )?.id ?? user.id,
              type: 'solicitacao_convertida',
              title: `Solicitação convertida em viagem ${code}`,
              body: `${body.origin} → ${body.destination}`,
              entity: 'trip',
              entityId: trip.id,
            },
          });
        }

        // O `tripCount` do cliente é denormalizado — atualiza junto.
        await refreshClientAggregates(tx, body.clientId, now);

        await recordChanges(
          tx,
          [
            {
              entity: 'trip',
              entityId: trip.id,
              action: 'created',
              clientScopeId: body.clientId,
            },
            {
              entity: 'client',
              entityId: body.clientId,
              action: 'updated',
              clientScopeId: body.clientId,
            },
            ...(body.requestId
              ? ([
                  {
                    entity: 'request' as const,
                    entityId: body.requestId,
                    action: 'updated' as const,
                    clientScopeId: body.clientId,
                  },
                ] as const)
              : []),
          ],
          user.id,
        );

        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'trip.create',
            entity: 'trip',
            entityId: trip.id,
            after: {
              code,
              clientId: body.clientId,
              aircraftId: body.aircraftId,
              scheduledWithDebt: hasDebt,
            },
          },
        });

        return trip.id;
      });

      // A releitura completa é feita FORA da transação: é leitura pura e não
      // precisa segurar a transação aberta por mais uma ida ao banco.
      const created = await prisma.trip.findUniqueOrThrow({
        where: { id: createdId },
        select: tripSelect,
      });

      void reply.status(201);
      return toTripInternalDTO(created);
    },
  );

  // ---------------------------------------------------------------- atualizar
  route.patch(
    '/:id',
    {
      preValidation: requirePermission('trip:update'),
      schema: {
        params: idParamSchema,
        body: updateTripBodySchema,
        response: { 200: tripInternalSchema },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { id } = request.params;
      const body = request.body;
      const now = new Date();

      const updated = await prisma.$transaction(async (tx) => {
        const before = await tx.trip.findUnique({
          where: { id },
          select: {
            id: true,
            code: true,
            clientId: true,
            aircraftId: true,
            departureAt: true,
            returnAt: true,
            status: true,
            distanceKm: true,
          },
        });
        if (!before) throw notFound('Viagem');

        if (LOCKED_TRIP_STATUSES.includes(before.status)) {
          throw conflict(`Viagem ${before.status} não pode ser editada.`);
        }

        const departureAt = body.departureAt ? new Date(body.departureAt) : before.departureAt;
        const returnAt = body.returnAt ? new Date(body.returnAt) : before.returnAt;
        const aircraftId = body.aircraftId ?? before.aircraftId;

        // Editar permite data no passado (corrigir um registro antigo).
        const problems = validateScheduleWindow({
          departureAt,
          returnAt,
          now,
          allowPast: true,
        });
        if (problems.length > 0) {
          throw unprocessable(SCHEDULE_PROBLEM_MESSAGES[problems[0] as never], problems);
        }

        const settings = await getSettings(tx);

        if (aircraftId !== null) {
          const clash = await evaluateConflict(tx, {
            aircraftId,
            start: departureAt,
            end: returnAt,
            marginMinutes: settings.marginMinutes,
            ignoreTripId: id,
          });
          if (clash.conflict) {
            throw conflict('A aeronave já possui um compromisso neste período.', {
              reason: clash.reason,
              label: clash.label,
            });
          }
        }

        // Recalcula a precificação quando muda o que a influencia.
        const needsRepricing =
          body.aircraftId !== undefined ||
          body.distanceKm !== undefined ||
          body.commercialValue !== undefined ||
          body.departureAt !== undefined;

        let pricing: PricingSnapshot | null = null;
        if (needsRepricing && aircraftId !== null) {
          const aircraft = await tx.aircraft.findFirst({
            where: { id: aircraftId, deletedAt: null },
            select: { cruiseSpeed: true },
          });
          if (!aircraft) throw notFound('Aeronave');

          pricing = await buildPricing(tx, {
            aircraftId,
            distanceKm:
              body.distanceKm === undefined
                ? (before.distanceKm?.toNumber() ?? null)
                : (body.distanceKm ?? null),
            cruiseSpeed: aircraft.cruiseSpeed,
            commercialValue: body.commercialValue ?? null,
            reference: departureAt,
          });
        }

        if (body.pax) {
          // Substitui a lista inteira: o formulário sempre manda o estado final.
          await tx.passenger.deleteMany({ where: { tripId: id } });
          await createPassengers(tx, body.pax, { tripId: id });
        }

        await tx.trip.update({
          where: { id },
          data: {
            ...(body.clientId === undefined ? {} : { clientId: body.clientId }),
            ...(body.aircraftId === undefined ? {} : { aircraftId: body.aircraftId }),
            ...(body.origin === undefined ? {} : { origin: body.origin }),
            ...(body.destination === undefined ? {} : { destination: body.destination }),
            ...(body.departureAt === undefined ? {} : { departureAt }),
            ...(body.returnAt === undefined ? {} : { returnAt }),
            ...(body.distanceKm === undefined
              ? {}
              : { distanceKm: toDecimalOrNull(body.distanceKm) }),
            ...(body.notes === undefined ? {} : { notes: body.notes }),
            ...(body.pax === undefined ? {} : { passengers: body.pax.length }),
            ...(pricing === null
              ? {}
              : {
                  tariffId: pricing.tariffId,
                  internalTariff: pricing.internalTariff,
                  flightHours: pricing.flightHours,
                  estimatedValue: pricing.estimatedValue,
                  commercialValue: pricing.commercialValue,
                }),
          },
        });

        // Trocar de cliente move a contagem de viagens dos dois lados.
        if (body.clientId !== undefined && body.clientId !== before.clientId) {
          await refreshClientAggregates(tx, before.clientId, now);
          await refreshClientAggregates(tx, body.clientId, now);
        }

        await recordChanges(
          tx,
          [{ entity: 'trip', entityId: id, action: 'updated', clientScopeId: before.clientId }],
          user.id,
        );

        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'trip.update',
            entity: 'trip',
            entityId: id,
            before: { code: before.code, status: before.status },
          },
        });

        return tx.trip.findUniqueOrThrow({ where: { id }, select: tripSelect });
      });

      return toTripInternalDTO(updated);
    },
  );

  // ---------------------------------------------------------------- cancelar
  route.post(
    '/:id/cancel',
    {
      preValidation: requirePermission('trip:cancel'),
      schema: {
        params: idParamSchema,
        body: cancelTripBodySchema,
        response: { 200: tripInternalSchema },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { id } = request.params;
      const now = new Date();

      const updated = await prisma.$transaction(async (tx) => {
        const trip = await tx.trip.findUnique({
          where: { id },
          select: { id: true, code: true, status: true, clientId: true },
        });
        if (!trip) throw notFound('Viagem');

        if (['concluida', 'cancelada', 'recusada'].includes(trip.status)) {
          throw conflict(`Viagem ${trip.status} não pode ser cancelada.`);
        }

        await tx.trip.update({
          where: { id },
          data: {
            status: 'cancelada',
            canceledAt: now,
            canceledById: user.id,
            cancelReason: request.body.reason ?? null,
          },
        });

        await refreshClientAggregates(tx, trip.clientId, now);

        const portalUser = await tx.user.findFirst({
          where: { clientId: trip.clientId, status: 'ativo' },
          select: { id: true },
        });
        if (portalUser) {
          await tx.notification.create({
            data: {
              userId: portalUser.id,
              type: 'viagem_cancelada',
              title: `Viagem ${trip.code} cancelada`,
              body: request.body.reason ?? null,
              entity: 'trip',
              entityId: id,
            },
          });
        }

        await recordChanges(
          tx,
          [
            { entity: 'trip', entityId: id, action: 'updated', clientScopeId: trip.clientId },
            {
              entity: 'client',
              entityId: trip.clientId,
              action: 'updated',
              clientScopeId: trip.clientId,
            },
          ],
          user.id,
        );

        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'trip.cancel',
            entity: 'trip',
            entityId: id,
            before: { status: trip.status },
            after: { status: 'cancelada', reason: request.body.reason ?? null },
          },
        });

        return tx.trip.findUniqueOrThrow({ where: { id }, select: tripSelect });
      });

      return toTripInternalDTO(updated);
    },
  );

  // ---------------------------------------------------------------- concluir
  route.post(
    '/:id/complete',
    {
      preValidation: requirePermission('trip:complete'),
      schema: { params: idParamSchema, response: { 200: tripInternalSchema } },
    },
    async (request) => {
      const user = requireUser(request);
      const { id } = request.params;
      const now = new Date();

      const updated = await prisma.$transaction(async (tx) => {
        const trip = await tx.trip.findUnique({
          where: { id },
          select: { id: true, status: true, clientId: true, returnAt: true },
        });
        if (!trip) throw notFound('Viagem');

        if (trip.status !== 'confirmada' && trip.status !== 'em_andamento') {
          throw conflict(`Viagem ${trip.status} não pode ser concluída.`);
        }

        await tx.trip.update({
          where: { id },
          data: { status: 'concluida', completedAt: now },
        });

        await recordChanges(
          tx,
          [{ entity: 'trip', entityId: id, action: 'updated', clientScopeId: trip.clientId }],
          user.id,
        );

        await tx.auditLog.create({
          data: { userId: user.id, action: 'trip.complete', entity: 'trip', entityId: id },
        });

        return tx.trip.findUniqueOrThrow({ where: { id }, select: tripSelect });
      });

      return toTripInternalDTO(updated);
    },
  );

  // Bloqueia explicitamente o cliente em qualquer tentativa de escrita.
  route.post(
    '/:id/reject',
    {
      preValidation: requirePermission('trip:cancel'),
      schema: { params: idParamSchema, response: { 200: okSchema } },
    },
    async (request) => {
      const user = requireUser(request);
      if (isClientRole(user)) throw forbidden('O cliente não pode alterar viagens.');
      await prisma.trip.update({ where: { id: request.params.id }, data: { status: 'recusada' } });
      return { ok: true } as const;
    },
  );
}

// ============================================================================
//  PASSAGEIROS
// ============================================================================

/**
 * Insere os passageiros em UM comando.
 *
 * `createMany` em vez de um `create` por passageiro: com 9 passageiros, 1 insert
 * em vez de 9. É o mesmo princípio que vale para o resto do sistema.
 */
export async function createPassengers(
  tx: Db,
  pax: readonly PassengerInputBody[],
  owner: { tripId: string } | { requestId: string },
): Promise<void> {
  if (pax.length === 0) return;

  await tx.passenger.createMany({
    data: pax.map((p, index) => ({
      name: p.name,
      position: index,
      documentFileId: p.documentFileId ?? null,
      ...('tripId' in owner ? { tripId: owner.tripId } : { requestId: owner.requestId }),
    })),
  });
}

/** Valida que os documentos citados existem — evita FK apontando para nada. */
export async function assertDocumentsExist(
  tx: Db,
  pax: readonly PassengerInputBody[],
): Promise<void> {
  const ids = pax.map((p) => p.documentFileId).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return;

  // Uma query para todos os ids — não uma por passageiro.
  const found = await tx.documentFile.count({
    where: { id: { in: ids }, deletedAt: null },
  });

  if (found !== new Set(ids).size) {
    throw badRequest('Algum documento enviado não foi encontrado. Reenvie os arquivos.');
  }
}
