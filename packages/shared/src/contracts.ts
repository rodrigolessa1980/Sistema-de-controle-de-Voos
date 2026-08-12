/**
 * Contratos da API — schemas Zod.
 *
 * Cada schema serve a dois propósitos ao mesmo tempo: valida em runtime na
 * borda do backend e gera o tipo TypeScript consumido pelo frontend. Não existe
 * um "tipo do request" escrito à mão em lugar nenhum — se o contrato muda, o
 * compilador aponta os dois lados.
 *
 * Convenções:
 *   - dinheiro: string decimal ("132000.00"), nunca number (ver `money.ts`);
 *   - instante: string ISO 8601 em UTC;
 *   - data pura: string "YYYY-MM-DD";
 *   - listagem: paginação por cursor, nunca offset.
 */

import { z } from 'zod';

import {
  AIRCRAFT_KINDS,
  AIRCRAFT_STATUSES,
  BLOCK_KINDS,
  CHANGE_ACTIONS,
  CHANGE_ENTITIES,
  CHARGE_STATUSES,
  CLIENT_FINANCIAL_STATUSES,
  DAY_AVAILABILITY,
  FLIGHT_REQUEST_STATUSES,
  NOTIFICATION_TYPES,
  PAYMENT_METHODS,
  ROLE_KEYS,
  TARIFF_UNITS,
  TRIP_STATUSES,
} from './enums';
import { ALL_PERMISSIONS } from './permissions';

// ============================================================================
//  PRIMITIVOS
// ============================================================================

/** Valor monetário: string decimal com até 2 casas. Rejeita negativo. */
export const moneySchema = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'Valor monetário inválido (use "1234.56")');

/** Aceita também number vindo de `<input type="number">` e normaliza. */
export const moneyInputSchema = z.union([
  moneySchema,
  z
    .number()
    .nonnegative()
    .finite()
    .transform((n) => n.toFixed(2)),
]);

export const isoDateTimeSchema = z.string().datetime({ offset: true });

export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use "AAAA-MM-DD")');

export const idSchema = z.string().min(1).max(32);
export const idParamSchema = z.object({ id: idSchema });

export const permissionSchema = z.enum(ALL_PERMISSIONS as [string, ...string[]]);
export const roleKeySchema = z.enum(ROLE_KEYS);

export const paginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  q: z.string().trim().max(120).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Envelope de listagem. `nextCursor` nulo = acabou. */
export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    total: z.number().int().nonnegative().optional(),
  });
}

export const okSchema = z.object({ ok: z.literal(true) });

export const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof errorSchema>;

// ============================================================================
//  AUTENTICAÇÃO
// ============================================================================

export const loginBodySchema = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  password: z.string().min(1, 'Informe a senha'),
});
export type LoginBody = z.infer<typeof loginBodySchema>;

export const changePasswordBodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(10, 'A senha precisa de pelo menos 10 caracteres')
    .max(128)
    .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), 'Use ao menos uma letra e um número'),
});
export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;

export const sessionUserSchema = z.object({
  id: idSchema,
  name: z.string(),
  email: z.string(),
  role: roleKeySchema,
  clientId: idSchema.nullable(),
  mustChangePassword: z.boolean(),
  permissions: z.array(permissionSchema),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
  user: sessionUserSchema,
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

// ============================================================================
//  AERONAVES
// ============================================================================

export const aircraftSchema = z.object({
  id: idSchema,
  prefix: z.string(),
  kind: z.enum(AIRCRAFT_KINDS),
  model: z.string(),
  manufacturer: z.string(),
  capacity: z.number().int(),
  cruiseSpeed: z.number().int(),
  status: z.enum(AIRCRAFT_STATUSES),
  notes: z.string().nullable(),
});
export type Aircraft = z.infer<typeof aircraftSchema>;

export const createAircraftBodySchema = z.object({
  prefix: z
    .string()
    .trim()
    .min(2)
    .max(12)
    .transform((v) => v.toUpperCase()),
  kind: z.enum(AIRCRAFT_KINDS),
  model: z.string().trim().min(1).max(120),
  manufacturer: z.string().trim().min(1).max(120),
  capacity: z.coerce.number().int().min(1).max(999),
  cruiseSpeed: z.coerce.number().int().min(0).max(5000).default(0),
  status: z.enum(AIRCRAFT_STATUSES).default('disponivel'),
  notes: z.string().trim().max(2000).optional(),
});
export type CreateAircraftBody = z.infer<typeof createAircraftBodySchema>;

export const updateAircraftBodySchema = createAircraftBodySchema.partial();
export type UpdateAircraftBody = z.infer<typeof updateAircraftBodySchema>;

export const listAircraftQuerySchema = paginationQuerySchema.extend({
  status: z.enum(AIRCRAFT_STATUSES).optional(),
  kind: z.enum(AIRCRAFT_KINDS).optional(),
});

// ============================================================================
//  TARIFAS
// ============================================================================

export const tariffSchema = z.object({
  id: idSchema,
  aircraftId: idSchema,
  aircraft: aircraftSchema.pick({ id: true, prefix: true, kind: true, model: true }).nullable(),
  value: moneySchema,
  costFuel: moneySchema,
  costFlightHour: moneySchema,
  costFees: moneySchema,
  costPilot: moneySchema,
  unit: z.enum(TARIFF_UNITS),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema.nullable(),
  active: z.boolean(),
});
export type Tariff = z.infer<typeof tariffSchema>;

export const createTariffBodySchema = z
  .object({
    aircraftId: idSchema,
    costFuel: moneyInputSchema.default('0'),
    costFlightHour: moneyInputSchema.default('0'),
    costFees: moneyInputSchema.default('0'),
    costPilot: moneyInputSchema.default('0'),
    unit: z.enum(TARIFF_UNITS).default('por_hora'),
    startDate: dateOnlySchema,
    endDate: dateOnlySchema.nullish(),
    active: z.boolean().default(true),
  })
  .refine(
    (v) =>
      Number(v.costFuel) + Number(v.costFlightHour) + Number(v.costFees) + Number(v.costPilot) > 0,
    { message: 'Informe ao menos um valor de custo', path: ['costFlightHour'] },
  )
  .refine((v) => !v.endDate || v.endDate >= v.startDate, {
    message: 'A data final precisa ser depois da inicial',
    path: ['endDate'],
  });
export type CreateTariffBody = z.infer<typeof createTariffBodySchema>;

export const updateTariffBodySchema = z.object({
  costFuel: moneyInputSchema.optional(),
  costFlightHour: moneyInputSchema.optional(),
  costFees: moneyInputSchema.optional(),
  costPilot: moneyInputSchema.optional(),
  unit: z.enum(TARIFF_UNITS).optional(),
  startDate: dateOnlySchema.optional(),
  endDate: dateOnlySchema.nullish(),
  active: z.boolean().optional(),
});
export type UpdateTariffBody = z.infer<typeof updateTariffBodySchema>;

export const listTariffQuerySchema = paginationQuerySchema.extend({
  aircraftId: idSchema.optional(),
  active: z.coerce.boolean().optional(),
});

// ============================================================================
//  CLIENTES
// ============================================================================

export const clientSchema = z.object({
  id: idSchema,
  name: z.string(),
  company: z.string().nullable(),
  document: z.string().nullable(),
  email: z.string(),
  phone: z.string().nullable(),
  notes: z.string().nullable(),
  active: z.boolean(),
  openBalance: moneySchema,
  overdueBalance: moneySchema,
  totalInvoiced: moneySchema,
  totalPaid: moneySchema,
  financialStatus: z.enum(CLIENT_FINANCIAL_STATUSES),
  tripCount: z.number().int(),
});
export type Client = z.infer<typeof clientSchema>;

/** O que o próprio cliente vê de si mesmo — sem os agregados internos. */
export const clientSelfSchema = clientSchema.pick({
  id: true,
  name: true,
  company: true,
  document: true,
  email: true,
  phone: true,
  openBalance: true,
  financialStatus: true,
  tripCount: true,
});
export type ClientSelf = z.infer<typeof clientSelfSchema>;

export const createClientBodySchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(180),
  company: z.string().trim().max(180).optional(),
  document: z.string().trim().max(20).optional(),
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  phone: z.string().trim().max(32).optional(),
  notes: z.string().trim().max(2000).optional(),
  /** Cria o login do portal e envia senha provisória (docs/PLANO.md §12.2). */
  createPortalUser: z.boolean().default(false),
});
export type CreateClientBody = z.infer<typeof createClientBodySchema>;

export const updateClientBodySchema = createClientBodySchema
  .omit({ createPortalUser: true })
  .partial();
export type UpdateClientBody = z.infer<typeof updateClientBodySchema>;

/** O cliente edita só os próprios dados de contato (protótipo: `CliPerfil`). */
export const updateOwnClientBodySchema = z.object({
  name: z.string().trim().min(2).max(180).optional(),
  company: z.string().trim().max(180).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  phone: z.string().trim().max(32).optional(),
  document: z.string().trim().max(20).optional(),
});
export type UpdateOwnClientBody = z.infer<typeof updateOwnClientBodySchema>;

export const listClientQuerySchema = paginationQuerySchema.extend({
  financialStatus: z.enum(CLIENT_FINANCIAL_STATUSES).optional(),
});

// ============================================================================
//  PASSAGEIROS E DOCUMENTOS
// ============================================================================

export const passengerSchema = z.object({
  id: idSchema,
  name: z.string(),
  position: z.number().int(),
  documentFileId: idSchema.nullable(),
  hasDocument: z.boolean(),
});
export type Passenger = z.infer<typeof passengerSchema>;

export const passengerInputSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome completo').max(180),
  documentFileId: idSchema.nullish(),
});
export type PassengerInputBody = z.infer<typeof passengerInputSchema>;

export const documentFileSchema = z.object({
  id: idSchema,
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  createdAt: isoDateTimeSchema,
});
export type DocumentFile = z.infer<typeof documentFileSchema>;

// ============================================================================
//  VIAGENS
// ============================================================================

const tripBaseSchema = z.object({
  id: idSchema,
  code: z.string(),
  clientId: idSchema,
  client: z.object({ id: idSchema, name: z.string(), company: z.string().nullable() }).nullable(),
  origin: z.string(),
  destination: z.string(),
  departureAt: isoDateTimeSchema,
  returnAt: isoDateTimeSchema,
  passengers: z.number().int(),
  notes: z.string().nullable(),
  status: z.enum(TRIP_STATUSES),
  pax: z.array(passengerSchema),
  createdAt: isoDateTimeSchema,
});

/**
 * Viagem como o pessoal interno vê: com aeronave e com os números da tarifa.
 */
export const tripInternalSchema = tripBaseSchema.extend({
  aircraftId: idSchema.nullable(),
  aircraft: aircraftSchema
    .pick({ id: true, prefix: true, kind: true, model: true, cruiseSpeed: true })
    .nullable(),
  distanceKm: z.number().nullable(),
  tariffId: idSchema.nullable(),
  internalTariff: moneySchema.nullable(),
  flightHours: z.number().nullable(),
  estimatedValue: moneySchema.nullable(),
  commercialValue: moneySchema.nullable(),
  scheduledWithDebt: z.boolean(),
  cancelReason: z.string().nullable(),
});
export type TripInternal = z.infer<typeof tripInternalSchema>;

/**
 * Viagem como o CLIENTE vê.
 *
 * É este schema que cumpre a regra do HANDOFF: "Cliente nunca vê aeronave,
 * prefixo, modelo, tipo nem tarifa interna". Como é um tipo diferente — e não o
 * mesmo tipo com campos opcionais — devolver o schema errado é erro de
 * compilação, não um vazamento que só aparece em produção.
 */
export const tripClientSchema = tripBaseSchema;
export type TripClient = z.infer<typeof tripClientSchema>;

export const createTripBodySchema = z.object({
  clientId: idSchema,
  aircraftId: idSchema,
  origin: z.string().trim().min(2, 'Informe a origem').max(160),
  destination: z.string().trim().min(2, 'Informe o destino').max(160),
  departureAt: isoDateTimeSchema,
  returnAt: isoDateTimeSchema,
  distanceKm: z.coerce.number().min(0).max(50_000).nullish(),
  notes: z.string().trim().max(2000).optional(),
  commercialValue: moneyInputSchema.nullish(),
  pax: z.array(passengerInputSchema).min(1, 'Informe ao menos um passageiro').max(50),
  /** Origem da viagem, quando nasce da conversão de uma solicitação. */
  requestId: idSchema.nullish(),
  /** Confirmação explícita de agendar apesar de pendência financeira. */
  acknowledgeDebt: z.boolean().default(false),
});
export type CreateTripBody = z.infer<typeof createTripBodySchema>;

export const updateTripBodySchema = createTripBodySchema
  .omit({ requestId: true, acknowledgeDebt: true })
  .partial();
export type UpdateTripBody = z.infer<typeof updateTripBodySchema>;

export const cancelTripBodySchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const listTripQuerySchema = paginationQuerySchema.extend({
  status: z.enum(TRIP_STATUSES).optional(),
  clientId: idSchema.optional(),
  aircraftId: idSchema.optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  upcoming: z.coerce.boolean().optional(),
});

export const checkAvailabilityBodySchema = z.object({
  aircraftId: idSchema,
  departureAt: isoDateTimeSchema,
  returnAt: isoDateTimeSchema,
  ignoreTripId: idSchema.nullish(),
});
export type CheckAvailabilityBody = z.infer<typeof checkAvailabilityBodySchema>;

export const availabilityResultSchema = z.object({
  available: z.boolean(),
  reason: z.enum(['trip', 'margin', 'block']).nullable(),
  label: z.string().nullable(),
  marginMinutes: z.number().int(),
});
export type AvailabilityResult = z.infer<typeof availabilityResultSchema>;

/** Prévia do cálculo de tarifa, para o painel do `TripForm`. */
export const pricingPreviewQuerySchema = z.object({
  aircraftId: idSchema,
  distanceKm: z.coerce.number().min(0).max(50_000).optional(),
});

export const pricingPreviewSchema = z.object({
  tariffId: idSchema.nullable(),
  tariffValue: moneySchema.nullable(),
  costFuel: moneySchema.nullable(),
  costFlightHour: moneySchema.nullable(),
  costFees: moneySchema.nullable(),
  costPilot: moneySchema.nullable(),
  unit: z.enum(TARIFF_UNITS).nullable(),
  cruiseSpeed: z.number().int(),
  distanceKm: z.number(),
  hours: z.number(),
  estimatedValue: moneySchema,
});
export type PricingPreview = z.infer<typeof pricingPreviewSchema>;

// ============================================================================
//  SOLICITAÇÕES DE VOO
// ============================================================================

export const flightRequestSchema = z.object({
  id: idSchema,
  code: z.string(),
  clientId: idSchema,
  client: z.object({ id: idSchema, name: z.string(), company: z.string().nullable() }).nullable(),
  origin: z.string(),
  destination: z.string(),
  departureAt: isoDateTimeSchema,
  returnAt: isoDateTimeSchema,
  passengers: z.number().int(),
  notes: z.string().nullable(),
  status: z.enum(FLIGHT_REQUEST_STATUSES),
  tripId: idSchema.nullable(),
  rejectionReason: z.string().nullable(),
  pax: z.array(passengerSchema),
  createdAt: isoDateTimeSchema,
});
export type FlightRequest = z.infer<typeof flightRequestSchema>;

export const createFlightRequestBodySchema = z.object({
  origin: z.string().trim().min(2, 'Informe a origem').max(160),
  destination: z.string().trim().min(2, 'Informe o destino').max(160),
  departureAt: isoDateTimeSchema,
  returnAt: isoDateTimeSchema,
  notes: z.string().trim().max(2000).optional(),
  pax: z.array(passengerInputSchema).min(1, 'Informe ao menos um passageiro').max(50),
});
export type CreateFlightRequestBody = z.infer<typeof createFlightRequestBodySchema>;

export const rejectRequestBodySchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const listRequestQuerySchema = paginationQuerySchema.extend({
  status: z.enum(FLIGHT_REQUEST_STATUSES).optional(),
  clientId: idSchema.optional(),
});

// ============================================================================
//  COBRANÇAS E PAGAMENTOS
// ============================================================================

export const paymentSchema = z.object({
  id: idSchema,
  chargeId: idSchema,
  amount: moneySchema,
  paidAt: dateOnlySchema,
  method: z.enum(PAYMENT_METHODS),
  note: z.string().nullable(),
  isSettlement: z.boolean(),
  reversedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type Payment = z.infer<typeof paymentSchema>;

export const chargeSchema = z.object({
  id: idSchema,
  code: z.string(),
  clientId: idSchema,
  client: z.object({ id: idSchema, name: z.string(), company: z.string().nullable() }).nullable(),
  tripId: idSchema.nullable(),
  trip: z
    .object({ id: idSchema, code: z.string(), origin: z.string(), destination: z.string() })
    .nullable(),
  total: moneySchema,
  paidAmount: moneySchema,
  balance: moneySchema,
  dueDate: dateOnlySchema,
  description: z.string().nullable(),
  status: z.enum(CHARGE_STATUSES),
  settledAt: isoDateTimeSchema.nullable(),
  payments: z.array(paymentSchema),
  createdAt: isoDateTimeSchema,
});
export type Charge = z.infer<typeof chargeSchema>;

export const createChargeBodySchema = z.object({
  clientId: idSchema,
  tripId: idSchema.nullish(),
  total: moneyInputSchema,
  dueDate: dateOnlySchema,
  description: z.string().trim().max(255).optional(),
});
export type CreateChargeBody = z.infer<typeof createChargeBodySchema>;

export const createPaymentBodySchema = z.object({
  amount: moneyInputSchema,
  paidAt: dateOnlySchema,
  method: z.enum(PAYMENT_METHODS),
  note: z.string().trim().max(500).optional(),
});
export type CreatePaymentBody = z.infer<typeof createPaymentBodySchema>;

export const settleChargeBodySchema = z.object({
  paidAt: dateOnlySchema,
  method: z.enum(PAYMENT_METHODS).default('transferencia'),
  note: z.string().trim().max(500).optional(),
});

export const reversePaymentBodySchema = z.object({
  reason: z.string().trim().min(3, 'Informe o motivo do estorno').max(500),
});

export const listChargeQuerySchema = paginationQuerySchema.extend({
  status: z.enum(CHARGE_STATUSES).optional(),
  clientId: idSchema.optional(),
  openOnly: z.coerce.boolean().optional(),
  dueBefore: dateOnlySchema.optional(),
});

export const listPaymentQuerySchema = paginationQuerySchema.extend({
  clientId: idSchema.optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});

/** Linha do histórico de pagamentos (protótipo: `FinPagamentos`). */
export const paymentHistoryItemSchema = paymentSchema.extend({
  chargeCode: z.string(),
  clientName: z.string(),
});
export type PaymentHistoryItem = z.infer<typeof paymentHistoryItemSchema>;

// ============================================================================
//  BLOQUEIOS E AGENDA
// ============================================================================

export const aircraftBlockSchema = z.object({
  id: idSchema,
  aircraftId: idSchema,
  aircraft: aircraftSchema.pick({ id: true, prefix: true, model: true }).nullable(),
  kind: z.enum(BLOCK_KINDS),
  reason: z.string(),
  startAt: isoDateTimeSchema,
  endAt: isoDateTimeSchema,
});
export type AircraftBlock = z.infer<typeof aircraftBlockSchema>;

export const createBlockBodySchema = z
  .object({
    aircraftId: idSchema,
    kind: z.enum(BLOCK_KINDS),
    reason: z.string().trim().min(2, 'Informe o motivo').max(255),
    startAt: isoDateTimeSchema,
    endAt: isoDateTimeSchema,
  })
  .refine((v) => new Date(v.endAt) > new Date(v.startAt), {
    message: 'O fim precisa ser depois do início',
    path: ['endAt'],
  });
export type CreateBlockBody = z.infer<typeof createBlockBodySchema>;

export const calendarQuerySchema = z.object({
  from: isoDateTimeSchema,
  to: isoDateTimeSchema,
  aircraftId: idSchema.optional(),
});

/** Evento da agenda interna — protótipo: `buildEvents` com `mask = false`. */
export const calendarEventSchema = z.object({
  id: idSchema,
  kind: z.enum(['trip', 'manutencao', 'bloqueio']),
  start: isoDateTimeSchema,
  end: isoDateTimeSchema,
  title: z.string(),
  subtitle: z.string().nullable(),
  clientName: z.string().nullable(),
  aircraftPrefix: z.string().nullable(),
  origin: z.string().nullable(),
  destination: z.string().nullable(),
  status: z.enum(TRIP_STATUSES).nullable(),
});
export type CalendarEvent = z.infer<typeof calendarEventSchema>;

/** Dia do calendário MASCARADO do cliente — nenhum detalhe de frota. */
export const availabilityDaySchema = z.object({
  date: dateOnlySchema,
  status: z.enum(DAY_AVAILABILITY),
});
export type AvailabilityDay = z.infer<typeof availabilityDaySchema>;

// ============================================================================
//  CONFIGURAÇÕES
// ============================================================================

export const settingsSchema = z.object({
  companyName: z.string(),
  contactEmail: z.string(),
  timezone: z.string(),
  marginMinutes: z.number().int(),
  dueSoonDays: z.number().int(),
  documentRetentionDays: z.number().int(),
  notifyOnNewRequest: z.boolean(),
  notifyExtraEmails: z.string().nullable(),
});
export type Settings = z.infer<typeof settingsSchema>;

export const updateSettingsBodySchema = z.object({
  companyName: z.string().trim().min(1).max(180).optional(),
  contactEmail: z.string().trim().toLowerCase().email().optional(),
  timezone: z.string().trim().max(64).optional(),
  marginMinutes: z.coerce
    .number()
    .int()
    .min(0)
    .max(24 * 60)
    .optional(),
  dueSoonDays: z.coerce.number().int().min(1).max(365).optional(),
  documentRetentionDays: z.coerce.number().int().min(1).max(3650).optional(),
  notifyOnNewRequest: z.boolean().optional(),
  notifyExtraEmails: z.string().trim().max(500).nullish(),
});
export type UpdateSettingsBody = z.infer<typeof updateSettingsBodySchema>;

// ============================================================================
//  PAINÉIS
// ============================================================================

export const operationalDashboardSchema = z.object({
  tripsToday: z.number().int(),
  upcomingTrips: z.number().int(),
  pendingRequests: z.number().int(),
  confirmedUpcoming: z.number().int(),
  availableAircraft: z.number().int(),
  totalAircraft: z.number().int(),
  clientsWithDebt: z.number().int(),
  nextTrips: z.array(
    z.object({
      id: idSchema,
      code: z.string(),
      clientName: z.string(),
      origin: z.string(),
      destination: z.string(),
      departureAt: isoDateTimeSchema,
      status: z.enum(TRIP_STATUSES),
    }),
  ),
  recentRequests: z.array(
    z.object({
      id: idSchema,
      code: z.string(),
      clientName: z.string(),
      origin: z.string(),
      destination: z.string(),
      departureAt: isoDateTimeSchema,
      passengers: z.number().int(),
    }),
  ),
});
export type OperationalDashboard = z.infer<typeof operationalDashboardSchema>;

export const financialDashboardSchema = z.object({
  totalReceivable: moneySchema,
  receivedThisMonth: moneySchema,
  overdueAmount: moneySchema,
  dueSoonCount: z.number().int(),
  dueSoonDays: z.number().int(),
  openCharges: z.array(
    z.object({
      id: idSchema,
      code: z.string(),
      clientName: z.string(),
      balance: moneySchema,
      dueDate: dateOnlySchema,
      status: z.enum(CHARGE_STATUSES),
    }),
  ),
  dueSoon: z.array(
    z.object({
      id: idSchema,
      code: z.string(),
      clientName: z.string(),
      balance: moneySchema,
      dueDate: dateOnlySchema,
    }),
  ),
});
export type FinancialDashboard = z.infer<typeof financialDashboardSchema>;

export const clientDashboardSchema = z.object({
  clientName: z.string(),
  upcomingTrips: z.number().int(),
  pendingRequests: z.number().int(),
  openBalance: moneySchema,
  financialStatus: z.enum(CLIENT_FINANCIAL_STATUSES),
  nextTrips: z.array(tripClientSchema),
});
export type ClientDashboard = z.infer<typeof clientDashboardSchema>;

export const financialReportSchema = z.object({
  totalInvoiced: moneySchema,
  totalReceived: moneySchema,
  delinquentClients: z.number().int(),
  monthlyReceipts: z.array(
    z.object({ year: z.number().int(), month: z.number().int(), amount: moneySchema }),
  ),
  byStatus: z.array(z.object({ status: z.enum(CHARGE_STATUSES), count: z.number().int() })),
  topDebtors: z.array(z.object({ clientId: idSchema, name: z.string(), balance: moneySchema })),
});
export type FinancialReport = z.infer<typeof financialReportSchema>;

// ============================================================================
//  NOTIFICAÇÕES
// ============================================================================

export const notificationSchema = z.object({
  id: idSchema,
  type: z.enum(NOTIFICATION_TYPES),
  title: z.string(),
  body: z.string().nullable(),
  entity: z.string().nullable(),
  entityId: idSchema.nullable(),
  readAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationListSchema = z.object({
  items: z.array(notificationSchema),
  unread: z.number().int(),
});

// ============================================================================
//  CHANGE FEED — polling de 10 segundos (docs/PLANO.md §6)
// ============================================================================

export const changesQuerySchema = z.object({
  /** Cursor da última leitura. Ausente = primeira consulta, devolve só o topo. */
  since: z.string().regex(/^\d+$/).optional(),
});

export const changesResponseSchema = z.object({
  /** Cursor a enviar na próxima chamada. */
  seq: z.string(),
  /** `true` quando o cursor é antigo demais: o cliente recarrega tudo. */
  reset: z.boolean(),
  changes: z.array(
    z.object({
      entity: z.enum(CHANGE_ENTITIES),
      entityId: idSchema,
      action: z.enum(CHANGE_ACTIONS),
    }),
  ),
});
export type ChangesResponse = z.infer<typeof changesResponseSchema>;
