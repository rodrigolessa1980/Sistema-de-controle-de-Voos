/**
 * Regras de negócio — funções PURAS.
 *
 * Porte fiel do que estava no protótipo `src/index.html`: `paid`, `balance`,
 * `chStatus`, `clientFin`, `costSum`, `checkConflict`, `dayStatus` e o cálculo
 * de tarifa dentro de `TripForm`.
 *
 * Este arquivo é importado pelos DOIS lados: o backend é a autoridade, e o
 * frontend usa as mesmas funções para dar feedback imediato (o aviso "Voo NÃO
 * disponível" tem que aparecer enquanto a pessoa digita, não depois do POST).
 * Uma implementação, dois consumidores — impossível divergirem.
 *
 * Nenhuma função aqui lê o relógio: `now` é sempre parâmetro.
 */

import { endOfUtcDay, startOfLocalDay, toDate } from './dates';
import type { BlockKind, ChargeStatus, ClientFinancialStatus, DayAvailability } from './enums';
import { INACTIVE_TRIP_STATUSES, type TripStatus } from './enums';
import * as Money from './money';

// ============================================================================
//  FINANCEIRO
// ============================================================================

export interface ChargeAmounts {
  readonly total: string | number;
  readonly paidAmount: string | number;
  readonly dueDate: Date | string;
}

/** Protótipo: `balance = Math.max(0, total − paid)`. */
export function chargeBalance(charge: Pick<ChargeAmounts, 'total' | 'paidAmount'>): Money.Money {
  return Money.clampToZero(Money.subtract(charge.total, charge.paidAmount));
}

/** Vencida = passou o ÚLTIMO instante do dia de vencimento. */
export function isChargeOverdue(dueDate: Date | string, now: Date): boolean {
  return now.getTime() > endOfUtcDay(dueDate).getTime();
}

/**
 * Protótipo: `chStatus`.
 *
 * Ordem importa: quitada é quitada mesmo que o vencimento já tenha passado.
 * `total > 0` está na condição original — cobrança de valor zero não é "paga".
 */
export function chargeStatus(charge: ChargeAmounts, now: Date): ChargeStatus {
  const totalCents = Money.toCents(charge.total);
  const paidCents = Money.toCents(charge.paidAmount);

  if (paidCents >= totalCents && totalCents > 0) return 'pago';

  const overdue = isChargeOverdue(charge.dueDate, now);
  if (paidCents > 0) return overdue ? 'vencido' : 'parcial';
  return overdue ? 'vencido' : 'pendente';
}

/**
 * Status que depende apenas dos valores, ignorando o tempo.
 *
 * É este que a coluna `Charge.status` guarda no momento da escrita; virar
 * `vencido` é trabalho do job `refreshOverdueCharges`, porque depende do
 * relógio e não de nenhuma mutação (docs/PLANO.md §7.2).
 */
export function settlementStatus(
  charge: Pick<ChargeAmounts, 'total' | 'paidAmount'>,
): Extract<ChargeStatus, 'pendente' | 'parcial' | 'pago'> {
  const totalCents = Money.toCents(charge.total);
  const paidCents = Money.toCents(charge.paidAmount);
  if (paidCents >= totalCents && totalCents > 0) return 'pago';
  return paidCents > 0 ? 'parcial' : 'pendente';
}

/** Protótipo: `clientBalance`. */
export function clientOpenBalance(
  charges: readonly Pick<ChargeAmounts, 'total' | 'paidAmount'>[],
): Money.Money {
  return charges.reduce<Money.Money>(
    (sum, charge) => Money.add(sum, chargeBalance(charge)),
    Money.ZERO,
  );
}

export function clientOverdueBalance(charges: readonly ChargeAmounts[], now: Date): Money.Money {
  return charges
    .filter((charge) => chargeStatus(charge, now) === 'vencido')
    .reduce<Money.Money>((sum, charge) => Money.add(sum, chargeBalance(charge)), Money.ZERO);
}

/** Protótipo: `clientFin`. Vencido pesa mais que pendente. */
export function clientFinancialStatus(
  charges: readonly ChargeAmounts[],
  now: Date,
): ClientFinancialStatus {
  if (charges.some((charge) => chargeStatus(charge, now) === 'vencido')) return 'vencido';
  if (charges.some((charge) => Money.isPositive(chargeBalance(charge)))) return 'pendente';
  return 'em_dia';
}

// ============================================================================
//  TARIFA E PRECIFICAÇÃO
// ============================================================================

export interface TariffCosts {
  readonly costFuel: string | number;
  readonly costFlightHour: string | number;
  readonly costFees: string | number;
  readonly costPilot: string | number;
}

/** Protótipo: `costSum`. O total da tarifa é a soma dos 4 custos, nada mais. */
export function tariffTotal(costs: TariffCosts): Money.Money {
  return Money.add(costs.costFuel, costs.costFlightHour, costs.costFees, costs.costPilot);
}

/**
 * Horas de voo estimadas — protótipo:
 * `hours = Math.round((2 * distance / speed) * 10) / 10`
 *
 * O 2 é ida e volta: `distanceKm` é a distância de um trecho só.
 * Retorna 0 quando falta distância ou velocidade de cruzeiro — a UI mostra "—"
 * e avisa qual dos dois está faltando.
 */
export function flightHours(distanceKm: number | null | undefined, cruiseSpeed: number): number {
  if (!distanceKm || distanceKm <= 0 || !cruiseSpeed || cruiseSpeed <= 0) return 0;
  return Math.round(((2 * distanceKm) / cruiseSpeed) * 10) / 10;
}

/**
 * Protótipo: `estimated = Math.round(tariff.value * hours)`.
 *
 * O arredondamento do protótipo é para real inteiro, não para centavo — mantido
 * de propósito para que os valores conferidos na homologação batam exatamente
 * com os do protótipo.
 */
export function estimatedValue(tariffValue: string | number, hours: number): Money.Money {
  if (hours <= 0) return Money.ZERO;
  const reais = Math.round((Money.toCents(tariffValue) / 100) * hours);
  return Money.fromCents(reais * 100);
}

export interface PricingInput {
  readonly tariffValue: string | number | null;
  readonly distanceKm: number | null | undefined;
  readonly cruiseSpeed: number | null | undefined;
  readonly commercialValue?: string | number | null;
}

export interface PricingResult {
  readonly hours: number;
  readonly estimatedValue: Money.Money;
  readonly commercialValue: Money.Money;
  readonly internalTariff: Money.Money;
}

/** Cálculo completo do painel "Cálculo de tarifa" do `TripForm`. */
export function calculatePricing(input: PricingInput): PricingResult {
  const internalTariff = input.tariffValue === null ? Money.ZERO : Money.money(input.tariffValue);
  const hours = flightHours(input.distanceKm, input.cruiseSpeed ?? 0);
  const estimated = estimatedValue(internalTariff, hours);

  // Protótipo: `commercial = f.commercial ? Number(f.commercial) : estimated`
  const hasCommercial =
    input.commercialValue !== null &&
    input.commercialValue !== undefined &&
    input.commercialValue !== '';

  return {
    hours,
    estimatedValue: estimated,
    commercialValue: hasCommercial ? Money.money(input.commercialValue) : estimated,
    internalTariff,
  };
}

// ============================================================================
//  AGENDA E CONFLITO
// ============================================================================

/** Protótipo: `overlap` — `inicioA < fimB && fimA > inicioB`. */
export function overlaps(
  aStart: Date | string,
  aEnd: Date | string,
  bStart: Date | string,
  bEnd: Date | string,
): boolean {
  const as = toDate(aStart).getTime();
  const ae = toDate(aEnd).getTime();
  const bs = toDate(bStart).getTime();
  const be = toDate(bEnd).getTime();
  return as < be && ae > bs;
}

export function isTripActive(status: TripStatus): boolean {
  return !INACTIVE_TRIP_STATUSES.includes(status);
}

export interface ScheduledTrip {
  readonly id: string;
  readonly code: string;
  readonly origin: string;
  readonly destination: string;
  readonly departureAt: Date | string;
  readonly returnAt: Date | string;
  readonly status: TripStatus;
}

export interface ScheduledBlock {
  readonly id: string;
  readonly kind: BlockKind;
  readonly reason: string;
  readonly startAt: Date | string;
  readonly endAt: Date | string;
}

export type ConflictReason = 'trip' | 'margin' | 'block';

export type ConflictResult =
  | { readonly conflict: false }
  | {
      readonly conflict: true;
      readonly reason: ConflictReason;
      readonly label: string;
      readonly conflictingId: string;
    };

export interface ConflictInput {
  readonly start: Date | string;
  readonly end: Date | string;
  readonly trips: readonly ScheduledTrip[];
  readonly blocks: readonly ScheduledBlock[];
  readonly marginMinutes: number;
  /** Ao editar, a própria viagem não conflita consigo mesma. */
  readonly ignoreTripId?: string | undefined;
}

/**
 * Protótipo: `checkConflict`.
 *
 * Duas verificações distintas, e a ordem é a do original:
 *   1. Sobreposição direta com outra viagem da MESMA aeronave.
 *   2. Margem mínima entre voos (`settings.marginMinutes`) — tempo de
 *      preparação, reabastecimento e troca de tripulação.
 * Depois, sobreposição com bloqueio ou manutenção.
 *
 * Quem chama passa apenas as viagens e bloqueios da aeronave em questão, já
 * filtrados por janela de tempo no banco — é isso que evita varrer a tabela
 * inteira como o protótipo fazia (docs/PLANO.md §7.1).
 */
export function checkConflict(input: ConflictInput): ConflictResult {
  const start = toDate(input.start).getTime();
  const end = toDate(input.end).getTime();
  const marginMs = Math.max(0, input.marginMinutes) * 60_000;

  const busy = input.trips.filter(
    (trip) => trip.id !== input.ignoreTripId && isTripActive(trip.status),
  );

  for (const trip of busy) {
    const tripStart = toDate(trip.departureAt).getTime();
    const tripEnd = toDate(trip.returnAt).getTime();

    if (start < tripEnd && end > tripStart) {
      return {
        conflict: true,
        reason: 'trip',
        label: `${trip.code} · ${trip.origin} → ${trip.destination}`,
        conflictingId: trip.id,
      };
    }

    if (marginMs > 0 && start < tripEnd + marginMs && end > tripStart - marginMs) {
      return {
        conflict: true,
        reason: 'margin',
        label: `${trip.code} · intervalo mínimo de ${input.marginMinutes} min entre voos`,
        conflictingId: trip.id,
      };
    }
  }

  for (const block of input.blocks) {
    if (overlaps(input.start, input.end, block.startAt, block.endAt)) {
      return {
        conflict: true,
        reason: 'block',
        label: `${block.kind === 'manutencao' ? 'Manutenção' : 'Bloqueio'} · ${block.reason}`,
        conflictingId: block.id,
      };
    }
  }

  return { conflict: false };
}

// ============================================================================
//  DISPONIBILIDADE MASCARADA (calendário do cliente)
// ============================================================================

/** Protótipo: `coversRange` — o compromisso cobre este dia local? */
export function coversLocalDay(
  rangeStart: Date | string,
  rangeEnd: Date | string,
  day: Date,
): boolean {
  const target = startOfLocalDay(day).getTime();
  return (
    target >= startOfLocalDay(rangeStart).getTime() && target <= startOfLocalDay(rangeEnd).getTime()
  );
}

export interface FleetDayInput {
  readonly aircraftIds: readonly string[];
  readonly trips: readonly (ScheduledTrip & { readonly aircraftId: string | null })[];
  readonly blocks: readonly (ScheduledBlock & { readonly aircraftId: string })[];
}

/**
 * Protótipo: `dayStatus`.
 *
 * `disponivel` se ao menos UMA aeronave da frota está livre no dia; senão
 * `ocupado` se há voo; senão `indisponivel`. O cliente nunca sabe quantas nem
 * quais aeronaves existem — só se dá para voar.
 */
export function dayAvailability(input: FleetDayInput, day: Date): DayAvailability {
  const activeTrips = input.trips.filter((trip) => isTripActive(trip.status));

  let free = 0;
  let anyTrip = false;

  for (const aircraftId of input.aircraftIds) {
    const hasTrip = activeTrips.some(
      (trip) =>
        trip.aircraftId === aircraftId && coversLocalDay(trip.departureAt, trip.returnAt, day),
    );
    const hasBlock = input.blocks.some(
      (block) => block.aircraftId === aircraftId && coversLocalDay(block.startAt, block.endAt, day),
    );

    if (hasTrip) anyTrip = true;
    if (!hasTrip && !hasBlock) free += 1;
  }

  if (free > 0) return 'disponivel';
  return anyTrip ? 'ocupado' : 'indisponivel';
}

// ============================================================================
//  VALIDAÇÕES DE AGENDAMENTO
// ============================================================================

export type ScheduleProblem =
  | 'datas_incompletas'
  | 'volta_antes_da_ida'
  | 'data_no_passado'
  | 'sem_passageiros'
  | 'passageiro_sem_nome'
  | 'passageiro_sem_documento';

export const SCHEDULE_PROBLEM_MESSAGES: Record<ScheduleProblem, string> = {
  datas_incompletas: 'Informe as datas e horários de ida e volta.',
  volta_antes_da_ida: 'A volta precisa ser depois da ida.',
  data_no_passado: 'A data de ida não pode ser anterior a hoje.',
  sem_passageiros: 'Informe ao menos um passageiro.',
  passageiro_sem_nome: 'Todo passageiro precisa de nome completo.',
  passageiro_sem_documento:
    'Envie a foto do documento com foto de cada passageiro (RG, CNH ou passaporte).',
};

export interface ScheduleWindowInput {
  readonly departureAt: Date | string | null;
  readonly returnAt: Date | string | null;
  readonly now: Date;
  /** Ao editar uma viagem já existente, a data no passado é permitida. */
  readonly allowPast?: boolean;
}

/** Protótipo: as validações de `submit` em `TripForm` e `attempt` em `CliSolicitar`. */
export function validateScheduleWindow(input: ScheduleWindowInput): ScheduleProblem[] {
  const problems: ScheduleProblem[] = [];

  if (!input.departureAt || !input.returnAt) {
    problems.push('datas_incompletas');
    return problems;
  }

  const departure = toDate(input.departureAt);
  const ret = toDate(input.returnAt);

  if (ret.getTime() <= departure.getTime()) problems.push('volta_antes_da_ida');

  if (input.allowPast !== true) {
    if (startOfLocalDay(departure).getTime() < startOfLocalDay(input.now).getTime()) {
      problems.push('data_no_passado');
    }
  }

  return problems;
}

export interface PassengerInput {
  readonly name: string;
  readonly documentFileId?: string | null | undefined;
}

/**
 * Protótipo: `paxOk`.
 *
 * `requireDocument` é a diferença real entre os dois fluxos: quando o CLIENTE
 * solicita, a foto do documento é obrigatória; quando o OPERACIONAL cadastra a
 * viagem direto, ela é opcional.
 */
export function validatePassengers(
  passengers: readonly PassengerInput[],
  requireDocument: boolean,
): ScheduleProblem[] {
  const problems: ScheduleProblem[] = [];

  if (passengers.length === 0) {
    problems.push('sem_passageiros');
    return problems;
  }

  if (passengers.some((p) => p.name.trim() === '')) problems.push('passageiro_sem_nome');
  if (requireDocument && passengers.some((p) => !p.documentFileId)) {
    problems.push('passageiro_sem_documento');
  }

  return problems;
}
