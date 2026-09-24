/**
 * Painéis — protótipo: `OpDashboard`, `FinDashboard`, `CliInicio`.
 *
 * Um endpoint por painel, e cada um devolve TODOS os indicadores da tela em uma
 * chamada, com os agregados calculados em SQL.
 *
 * A alternativa — o front pedir cada lista e somar — é o que o protótipo fazia
 * quando tinha o banco inteiro em memória. Sobre HTTP viraria seis requisições e
 * o dataset completo no navegador só para mostrar seis números.
 */

import {
  clientDashboardSchema,
  dashboardMonthQuerySchema,
  financialDashboardQuerySchema,
  financialDashboardSchema,
  operationalDashboardSchema,
  startOfLocalDay,
  TRIP_EXPENSE_FIELDS,
  type ClientDashboard,
  type FinancialDashboard,
  type OperationalDashboard,
  type TripExpenseKey,
} from '@acm/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { notFound } from '../lib/errors';
import { decimalToMoneyStrict, Prisma, prisma } from '../lib/prisma';
import { ownClientId, requirePermission, requireUser } from '../plugins/rbac';
import { getSettings } from './settings';
import { toTripClientDTO } from './trip';

const utcDate = (d: Date): string => d.toISOString().slice(0, 10);
const money = (d: Prisma.Decimal | null): string => (d === null ? '0.00' : d.toFixed(2));

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>();

  // ================================================================ OPERACIONAL
  route.get(
    '/operacional',
    {
      preValidation: requirePermission('dashboard:operacional'),
      schema: {
        querystring: dashboardMonthQuerySchema,
        response: { 200: operationalDashboardSchema },
      },
    },
    async (request) => {
      const now = new Date();
      const dayStart = startOfLocalDay(now);
      const dayEnd = new Date(dayStart.getTime() + 86_400_000);

      // Mês de referência (`?month=AAAA-MM`), no mesmo fuso de "hoje".
      const [refYear, refMonth] = request.query.month
        ? (request.query.month.split('-').map(Number) as [number, number])
        : [now.getFullYear(), now.getMonth() + 1];
      const monthStart = new Date(refYear, refMonth - 1, 1);
      const monthEnd = new Date(refYear, refMonth, 1);
      const inMonth = { gte: monthStart, lt: monthEnd };
      // A lista de voos do mês atual começa hoje; meses passados/futuros vêm inteiros.
      const listFrom = dayStart > monthStart && dayStart < monthEnd ? dayStart : monthStart;
      const valid = { status: { notIn: ['recusada' as const, 'cancelada' as const] } };

      // Tudo em paralelo: queries independentes, uma viagem de ida e volta.
      const [
        tripsInMonth,
        confirmedInMonth,
        requestsInMonth,
        tripsToday,
        upcomingTrips,
        pendingRequests,
        confirmedUpcoming,
        availableAircraft,
        totalAircraft,
        clientsWithDebt,
        nextTrips,
        recentRequests,
      ] = await Promise.all([
        prisma.trip.count({ where: { ...valid, departureAt: inMonth } }),
        prisma.trip.count({ where: { status: 'confirmada', departureAt: inMonth } }),
        prisma.flightRequest.count({
          where: { status: 'aguardando_analise', departureAt: inMonth },
        }),
        prisma.trip.count({
          where: { ...valid, departureAt: { gte: dayStart, lt: dayEnd } },
        }),
        prisma.trip.count({ where: { ...valid, departureAt: { gte: now } } }),
        prisma.flightRequest.count({ where: { status: 'aguardando_analise' } }),
        prisma.trip.count({ where: { status: 'confirmada', departureAt: { gte: now } } }),
        prisma.aircraft.count({ where: { deletedAt: null, status: 'disponivel' } }),
        prisma.aircraft.count({ where: { deletedAt: null } }),
        // Coluna denormalizada: contagem indexada, não varredura de cobranças.
        prisma.client.count({
          where: { deletedAt: null, financialStatus: { not: 'em_dia' } },
        }),
        prisma.trip.findMany({
          where: { ...valid, departureAt: { gte: listFrom, lt: monthEnd } },
          select: {
            id: true,
            code: true,
            origin: true,
            destination: true,
            departureAt: true,
            status: true,
            client: { select: { name: true } },
          },
          orderBy: { departureAt: 'asc' },
          take: 8,
        }),
        prisma.flightRequest.findMany({
          where: { status: 'aguardando_analise', departureAt: inMonth },
          select: {
            id: true,
            code: true,
            origin: true,
            destination: true,
            departureAt: true,
            passengers: true,
            client: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
      ]);

      const result: OperationalDashboard = {
        month: `${String(refYear)}-${String(refMonth).padStart(2, '0')}`,
        tripsInMonth,
        confirmedInMonth,
        requestsInMonth,
        tripsToday,
        upcomingTrips,
        pendingRequests,
        confirmedUpcoming,
        availableAircraft,
        totalAircraft,
        clientsWithDebt,
        nextTrips: nextTrips.map((t) => ({
          id: t.id,
          code: t.code,
          clientName: t.client.name,
          origin: t.origin,
          destination: t.destination,
          departureAt: t.departureAt.toISOString(),
          status: t.status,
        })),
        recentRequests: recentRequests.map((r) => ({
          id: r.id,
          code: r.code,
          clientName: r.client.name,
          origin: r.origin,
          destination: r.destination,
          departureAt: r.departureAt.toISOString(),
          passengers: r.passengers,
        })),
      };

      return result;
    },
  );

  // ================================================================= FINANCEIRO
  route.get(
    '/financeiro',
    {
      preValidation: requirePermission('dashboard:financeiro'),
      schema: {
        querystring: financialDashboardQuerySchema,
        response: { 200: financialDashboardSchema },
      },
    },
    async (request) => {
      const now = new Date();
      const settings = await getSettings();

      // Mês de referência (`?month=AAAA-MM`); sem filtro, o mês corrente.
      const [refYear, refMonth] = request.query.month
        ? (request.query.month.split('-').map(Number) as [number, number])
        : [now.getUTCFullYear(), now.getUTCMonth() + 1];
      const monthStart = new Date(Date.UTC(refYear, refMonth - 1, 1));
      const monthEnd = new Date(Date.UTC(refYear, refMonth, 1));
      const dueLimit = new Date(now.getTime() + settings.dueSoonDays * 86_400_000);
      const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

      // Custos das viagens: só as que valem (não canceladas/recusadas).
      const expenseSum = {
        costFuel: true,
        costFlightHour: true,
        costPilot: true,
        costFees: true,
        costInternet: true,
      } as const;
      const hasExpense = {
        OR: TRIP_EXPENSE_FIELDS.map(({ key }) => ({ [key]: { not: null } })),
      };

      const [monthExpenses, allExpenses, recentExpenseTrips] = await Promise.all([
        prisma.trip.aggregate({
          where: {
            status: { notIn: ['recusada', 'cancelada'] },
            departureAt: { gte: monthStart, lt: monthEnd },
            ...hasExpense,
          },
          _sum: expenseSum,
          _count: { _all: true },
        }),
        prisma.trip.aggregate({
          where: { status: { notIn: ['recusada', 'cancelada'] }, ...hasExpense },
          _sum: expenseSum,
          _count: { _all: true },
        }),
        prisma.trip.findMany({
          where: {
            status: { notIn: ['recusada', 'cancelada'] },
            departureAt: { gte: monthStart, lt: monthEnd },
            ...hasExpense,
          },
          select: {
            id: true,
            code: true,
            departureAt: true,
            client: { select: { name: true } },
            ...expenseSum,
          },
          orderBy: { departureAt: 'desc' },
          take: 6,
        }),
      ]);

      /** Soma os 5 custos, tratando ausência como zero. */
      const sumExpenses = (row: Record<TripExpenseKey, Prisma.Decimal | null>): Prisma.Decimal =>
        TRIP_EXPENSE_FIELDS.reduce(
          (acc, { key }) => (row[key] === null ? acc : acc.add(row[key])),
          new Prisma.Decimal(0),
        );

      const [receivable, receivableInMonth, received, overdue, dueSoonCount, openCharges, dueSoon] =
        await Promise.all([
          // Soma no banco. O protótipo somava `balance(c)` de cada cobrança em JS.
          prisma.charge.aggregate({
            where: { canceledAt: null, balance: { gt: 0 } },
            _sum: { balance: true },
          }),
          prisma.charge.aggregate({
            where: {
              canceledAt: null,
              balance: { gt: 0 },
              dueDate: { gte: monthStart, lt: monthEnd },
            },
            _sum: { balance: true },
          }),
          prisma.payment.aggregate({
            where: { reversedAt: null, paidAt: { gte: monthStart, lt: monthEnd } },
            _sum: { amount: true },
          }),
          prisma.charge.aggregate({
            where: { canceledAt: null, status: 'vencido', balance: { gt: 0 } },
            _sum: { balance: true },
          }),
          prisma.charge.count({
            where: {
              canceledAt: null,
              balance: { gt: 0 },
              dueDate: { gte: today, lte: dueLimit },
            },
          }),
          prisma.charge.findMany({
            where: {
              canceledAt: null,
              balance: { gt: 0 },
              dueDate: { gte: monthStart, lt: monthEnd },
            },
            select: {
              id: true,
              code: true,
              balance: true,
              dueDate: true,
              status: true,
              client: { select: { name: true } },
            },
            orderBy: { dueDate: 'asc' },
            take: 6,
          }),
          prisma.charge.findMany({
            where: {
              canceledAt: null,
              balance: { gt: 0 },
              dueDate: { gte: today, lte: dueLimit },
            },
            select: {
              id: true,
              code: true,
              balance: true,
              dueDate: true,
              client: { select: { name: true } },
            },
            orderBy: { dueDate: 'asc' },
            take: 10,
          }),
        ]);

      const result: FinancialDashboard = {
        month: `${String(refYear)}-${String(refMonth).padStart(2, '0')}`,
        totalReceivable: money(receivable._sum.balance),
        receivableInMonth: money(receivableInMonth._sum.balance),
        receivedThisMonth: money(received._sum.amount),
        overdueAmount: money(overdue._sum.balance),
        dueSoonCount,
        dueSoonDays: settings.dueSoonDays,
        tripExpenses: {
          month: {
            total: money(sumExpenses(monthExpenses._sum)),
            byField: {
              costFuel: money(monthExpenses._sum.costFuel),
              costFlightHour: money(monthExpenses._sum.costFlightHour),
              costPilot: money(monthExpenses._sum.costPilot),
              costFees: money(monthExpenses._sum.costFees),
              costInternet: money(monthExpenses._sum.costInternet),
            },
            tripCount: monthExpenses._count._all,
          },
          allTime: {
            total: money(sumExpenses(allExpenses._sum)),
            tripCount: allExpenses._count._all,
          },
          recent: recentExpenseTrips.map((t) => ({
            id: t.id,
            code: t.code,
            clientName: t.client.name,
            departureAt: t.departureAt.toISOString(),
            total: money(sumExpenses(t)),
          })),
        },
        openCharges: openCharges.map((c) => ({
          id: c.id,
          code: c.code,
          clientName: c.client.name,
          balance: decimalToMoneyStrict(c.balance),
          dueDate: utcDate(c.dueDate),
          status: c.status,
        })),
        dueSoon: dueSoon.map((c) => ({
          id: c.id,
          code: c.code,
          clientName: c.client.name,
          balance: decimalToMoneyStrict(c.balance),
          dueDate: utcDate(c.dueDate),
        })),
      };

      return result;
    },
  );

  // ==================================================================== CLIENTE
  route.get(
    '/cliente',
    {
      preValidation: requirePermission('dashboard:cliente'),
      schema: { response: { 200: clientDashboardSchema } },
    },
    async (request) => {
      const user = requireUser(request);
      const clientId = ownClientId(user);
      const now = new Date();

      const [client, upcomingCount, pendingRequests, nextTrips] = await Promise.all([
        prisma.client.findFirst({
          where: { id: clientId, deletedAt: null },
          select: { name: true, openBalance: true, financialStatus: true },
        }),
        prisma.trip.count({
          where: {
            clientId,
            status: { notIn: ['recusada', 'cancelada'] },
            departureAt: { gte: now },
          },
        }),
        prisma.flightRequest.count({
          where: { clientId, status: { in: ['aguardando_analise', 'em_analise'] } },
        }),
        prisma.trip.findMany({
          where: {
            clientId,
            status: { notIn: ['recusada', 'cancelada'] },
            departureAt: { gte: now },
          },
          // O select é o do DTO do cliente: sem aeronave, sem tarifa.
          select: {
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
            createdAt: true,
            client: { select: { id: true, name: true, company: true } },
            pax: {
              select: { id: true, name: true, position: true, documentFileId: true },
              orderBy: { position: 'asc' },
            },
          },
          orderBy: { departureAt: 'asc' },
          take: 5,
        }),
      ]);

      if (!client) throw notFound('Cliente');

      const result: ClientDashboard = {
        clientName: client.name,
        upcomingTrips: upcomingCount,
        pendingRequests,
        openBalance: decimalToMoneyStrict(client.openBalance),
        financialStatus: client.financialStatus,
        nextTrips: nextTrips.map((trip) =>
          toTripClientDTO({
            ...trip,
            aircraftId: null,
            aircraft: null,
            distanceKm: null,
            tariffId: null,
            internalTariff: null,
            flightHours: null,
            estimatedValue: null,
            commercialValue: null,
            costFuel: null,
            costFlightHour: null,
            costPilot: null,
            costFees: null,
            costInternet: null,
            scheduledWithDebt: false,
            cancelReason: null,
          }),
        ),
      };

      return result;
    },
  );
}
