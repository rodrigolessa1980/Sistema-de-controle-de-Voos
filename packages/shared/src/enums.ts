/**
 * Enums do domínio.
 *
 * Os VALORES são idênticos aos do protótipo `src/index.html` e aos do
 * `prisma/schema.prisma` — em snake_case PT-BR. Isso é deliberado: o front
 * consegue usar `LABELS` direto sobre o que vem da API, sem camada de tradução,
 * e uma renomeação aqui quebra o compilador em todos os pontos de uso.
 *
 * O padrão `as const` + `(typeof X)[number]` dá uma única fonte de verdade que
 * serve como lista em runtime (para `<select>` e validação Zod) e como união de
 * tipos em tempo de compilação.
 */

export const AIRCRAFT_KINDS = ['aviao', 'helicoptero'] as const;
export type AircraftKind = (typeof AIRCRAFT_KINDS)[number];

export const AIRCRAFT_STATUSES = ['disponivel', 'em_voo', 'manutencao', 'indisponivel'] as const;
export type AircraftStatus = (typeof AIRCRAFT_STATUSES)[number];

export const TARIFF_UNITS = ['por_hora', 'por_trecho', 'diaria'] as const;
export type TariffUnit = (typeof TARIFF_UNITS)[number];

export const TRIP_STATUSES = [
  'confirmada',
  'recusada',
  'em_andamento',
  'concluida',
  'cancelada',
] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

export const FLIGHT_REQUEST_STATUSES = [
  'aguardando_analise',
  'em_analise',
  'convertida',
  'recusada',
] as const;
export type FlightRequestStatus = (typeof FLIGHT_REQUEST_STATUSES)[number];

export const CHARGE_STATUSES = ['pendente', 'parcial', 'pago', 'vencido'] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

export const CLIENT_FINANCIAL_STATUSES = ['em_dia', 'pendente', 'vencido'] as const;
export type ClientFinancialStatus = (typeof CLIENT_FINANCIAL_STATUSES)[number];

export const PAYMENT_METHODS = ['pix', 'transferencia', 'boleto', 'cartao', 'dinheiro'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const BLOCK_KINDS = ['manutencao', 'bloqueio'] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export const USER_STATUSES = ['ativo', 'inativo', 'bloqueado'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Chaves de `Role.key`. O RBAC é por permissão; isto é só o papel de origem. */
export const ROLE_KEYS = ['operacional', 'financeiro', 'cliente', 'admin'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const NOTIFICATION_TYPES = [
  'solicitacao_nova',
  'solicitacao_convertida',
  'solicitacao_recusada',
  'viagem_agendada',
  'viagem_alterada',
  'viagem_cancelada',
  'cobranca_criada',
  'cobranca_vencida',
  'pagamento_recebido',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const CHANGE_ACTIONS = ['created', 'updated', 'deleted'] as const;
export type ChangeAction = (typeof CHANGE_ACTIONS)[number];

/** Entidades que aparecem no change feed (base do polling de 10s). */
export const CHANGE_ENTITIES = [
  'aircraft',
  'tariff',
  'client',
  'trip',
  'request',
  'charge',
  'payment',
  'block',
  'settings',
  'notification',
] as const;
export type ChangeEntity = (typeof CHANGE_ENTITIES)[number];

/** Status de um dia no calendário mascarado do cliente. */
export const DAY_AVAILABILITY = ['disponivel', 'ocupado', 'indisponivel'] as const;
export type DayAvailability = (typeof DAY_AVAILABILITY)[number];

/**
 * Status de viagem que NÃO ocupam a aeronave na agenda.
 *
 * Protótipo: `db.trips.filter(t => t.status !== 'recusada' && t.status !== 'cancelada')`,
 * repetido em `checkConflict`, `buildEvents`, `dayStatus` e nos dashboards. Aqui é
 * uma constante só — se um status novo entrar no enum, há um lugar para pensar.
 */
export const INACTIVE_TRIP_STATUSES: readonly TripStatus[] = ['recusada', 'cancelada'];

/** Status de viagem que impedem edição (protótipo: menu "Editar" oculto). */
export const LOCKED_TRIP_STATUSES: readonly TripStatus[] = ['concluida', 'cancelada'];
