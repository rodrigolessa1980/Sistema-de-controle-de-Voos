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
  financialDashboardSchema,
  operationalDashboardSchema,
  startOfLocalDay,
  type ClientDashboard,
  type FinancialDashboard,
  type OperationalDashboard,
} from '@acm/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { notFound } from '../lib/errors';
import { decimalToMoneyStrict, type Prisma, prisma } from '../lib/prisma';
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
      schema: { response: { 200: operationalDashboardSchema } },
    },
    async () => {
      const now = new Date();
      const dayStart = startOfLocalDay(now);
      const dayEnd = new Date(dayStart.getTime() + 86_400_000);

      // Tudo em paralelo: 8 queries independentes, uma viagem de ida e volta.
      const [
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
        prisma.trip.count({
          where: {
            status: { notIn: ['recusada', 'cancelada'] },
            departureAt: { gte: dayStart, lt: dayEnd },
          },
        }),
        prisma.trip.count({
          where: { status: { notIn: ['recusada', 'cancelada'] }, departureAt: { gte: now } },
        }),
        prisma.flightRequest.count({ where: { status: 'aguardando_analise' } }),
        prisma.trip.count({ where: { status: 'confirmada', departureAt: { gte: now } } }),
        prisma.aircraft.count({ where: { deletedAt: null, status: 'disponivel' } }),
        prisma.aircraft.count({ where: { deletedAt: null } }),
        // Coluna denormalizada: contagem indexada, não varredura de cobranças.
        prisma.client.count({
          where: { deletedAt: null, financialStatus: { not: 'em_dia' } },
        }),
        prisma.trip.findMany({
          where: { status: { notIn: ['recusada', 'cancelada'] }, departureAt: { gte: now } },
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
          take: 6,
        }),
        prisma.flightRequest.findMany({
          where: { status: 'aguardando_analise' },
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
      schema: { response: { 200: financialDashboardSchema } },
    },
    async () => {
      const now = new Date();
      const settings = await getSettings();

      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      const dueLimit = new Date(now.getTime() + settings.dueSoonDays * 86_400_000);
      const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

      const [receivable, received, overdue, dueSoonCount, openCharges, dueSoon] = await Promise.all(
        [
          // Soma no banco. O protótipo somava `balance(c)` de cada cobrança em JS.
          prisma.charge.aggregate({
            where: { canceledAt: null, balance: { gt: 0 } },
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
            where: { canceledAt: null, balance: { gt: 0 } },
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
        ],
      );

      const result: FinancialDashboard = {
        totalReceivable: money(receivable._sum.balance),
        receivedThisMonth: money(received._sum.amount),
        overdueAmount: money(overdue._sum.balance),
        dueSoonCount,
        dueSoonDays: settings.dueSoonDays,
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
            scheduledWithDebt: false,
            cancelReason: null,
          }),
        ),
      };

      return result;
    },
  );
}
