/**
 * Chaves do TanStack Query e o mapa entidade → chave.
 *
 * O mapa é o que torna o polling de 10s barato: quando o change feed diz
 * "a cobrança X mudou", só as consultas de cobrança e de cliente são
 * invalidadas — a agenda e a frota nem são tocadas.
 */

import type { ChangeEntity } from '@acm/shared';

export const queryKeys = {
  session: ['session'] as const,

  aircraft: ['aircraft'] as const,
  aircraftList: (params: unknown) => ['aircraft', 'list', params] as const,

  tariffs: ['tariffs'] as const,
  tariffList: (params: unknown) => ['tariffs', 'list', params] as const,

  clients: ['clients'] as const,
  clientList: (params: unknown) => ['clients', 'list', params] as const,
  client: (id: string) => ['clients', 'detail', id] as const,
  clientMe: ['clients', 'me'] as const,

  trips: ['trips'] as const,
  tripList: (params: unknown) => ['trips', 'list', params] as const,
  trip: (id: string) => ['trips', 'detail', id] as const,
  pricingPreview: (aircraftId: string, distanceKm: number) =>
    ['trips', 'pricing', aircraftId, distanceKm] as const,

  requests: ['requests'] as const,
  requestList: (params: unknown) => ['requests', 'list', params] as const,

  charges: ['charges'] as const,
  chargeList: (params: unknown) => ['charges', 'list', params] as const,

  payments: ['payments'] as const,
  paymentList: (params: unknown) => ['payments', 'list', params] as const,

  blocks: ['blocks'] as const,
  calendar: (from: string, to: string) => ['calendar', from, to] as const,
  availabilityDays: (from: string, to: string) => ['availability-days', from, to] as const,

  dashboardOp: ['dashboard', 'operacional'] as const,
  dashboardFin: ['dashboard', 'financeiro'] as const,
  dashboardCli: ['dashboard', 'cliente'] as const,
  reportFinancial: ['reports', 'financial'] as const,

  notifications: ['notifications'] as const,
  settings: ['settings'] as const,
} as const;

/**
 * Que caches uma mudança em cada entidade derruba.
 *
 * Deliberadamente generoso onde há dependência: um pagamento muda a cobrança,
 * o cliente (saldo denormalizado), os painéis e os relatórios. Invalidar de
 * menos deixa número velho na tela — o pior defeito possível num financeiro.
 */
export const ENTITY_INVALIDATIONS: Record<ChangeEntity, readonly (readonly string[])[]> = {
  aircraft: [queryKeys.aircraft, queryKeys.calendar('', '').slice(0, 1), queryKeys.dashboardOp],
  tariff: [queryKeys.tariffs, queryKeys.trips],
  client: [
    queryKeys.clients,
    queryKeys.dashboardOp,
    queryKeys.dashboardFin,
    queryKeys.dashboardCli,
    queryKeys.reportFinancial,
  ],
  trip: [
    queryKeys.trips,
    ['calendar'],
    ['availability-days'],
    queryKeys.dashboardOp,
    queryKeys.dashboardCli,
    queryKeys.clients,
  ],
  request: [queryKeys.requests, queryKeys.dashboardOp, queryKeys.dashboardCli],
  charge: [
    queryKeys.charges,
    queryKeys.clients,
    queryKeys.dashboardFin,
    queryKeys.dashboardCli,
    queryKeys.reportFinancial,
  ],
  payment: [
    queryKeys.payments,
    queryKeys.charges,
    queryKeys.clients,
    queryKeys.dashboardFin,
    queryKeys.reportFinancial,
  ],
  block: [queryKeys.blocks, ['calendar'], ['availability-days'], queryKeys.dashboardOp],
  settings: [queryKeys.settings, queryKeys.trips],
  notification: [queryKeys.notifications],
};
