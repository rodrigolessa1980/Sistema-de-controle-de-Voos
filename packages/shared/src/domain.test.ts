/**
 * Testes das regras de negócio.
 *
 * Cada bloco corresponde a uma regra do `HANDOFF.md`, e os valores esperados
 * saem do protótipo `src/index.html`. É o que garante que a migração não mudou
 * nenhum cálculo por acidente.
 */

import { describe, expect, it } from 'vitest';

import {
  calculatePricing,
  chargeBalance,
  chargeStatus,
  checkConflict,
  clientFinancialStatus,
  clientOpenBalance,
  dayAvailability,
  estimatedValue,
  flightHours,
  isChargeOverdue,
  overlaps,
  settlementStatus,
  tariffTotal,
  validatePassengers,
  validateScheduleWindow,
  type ScheduledBlock,
  type ScheduledTrip,
} from './domain';
import * as Money from './money';

// O protótipo congelava "hoje" em 2026-08-11T12:00:00. Os testes usam o mesmo
// instante para que os resultados sejam conferíveis contra a tela original.
const NOW = new Date('2026-08-11T15:00:00.000Z');

describe('Money', () => {
  it('soma em centavos, sem erro de ponto flutuante', () => {
    // 0.1 + 0.2 dá 0.30000000000000004 em float. Em centavos, não.
    expect(Money.add('0.10', '0.20')).toBe('0.30');
    expect(Money.add('3500', '3000', '1000', '1000')).toBe('8500.00');
  });

  it('nunca deixa o saldo ficar negativo', () => {
    expect(Money.clampToZero(Money.subtract('100', '150'))).toBe('0.00');
  });

  it('aceita o Decimal do Prisma via toString', () => {
    expect(Money.money({ toString: () => '132000.00' })).toBe('132000.00');
  });

  it('rejeita entrada malformada em vez de virar NaN', () => {
    expect(() => Money.money('abc')).toThrow(Money.MoneyError);
    expect(() => Money.money('1.234')).toThrow(Money.MoneyError);
  });

  it('formata em pt-BR', () => {
    expect(Money.formatBRL('132000.00')).toContain('132.000,00');
    expect(Money.formatBRLShort('132000.00')).toContain('mil');
  });
});

describe('chargeStatus — regra `chStatus` do protótipo', () => {
  const due = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  it('pago quando o total foi coberto, mesmo depois do vencimento', () => {
    const charge = { total: '198000', paidAmount: '198000', dueDate: due('2026-08-05') };
    expect(chargeStatus(charge, NOW)).toBe('pago');
  });

  it('vencido quando passou o vencimento e sobrou saldo', () => {
    // COB-3301 do protótipo: 132.000 com 40.000 pagos, vencia em 30/07.
    const charge = { total: '132000', paidAmount: '40000', dueDate: due('2026-07-30') };
    expect(chargeStatus(charge, NOW)).toBe('vencido');
  });

  it('parcial quando há pagamento e ainda não venceu', () => {
    const charge = { total: '82000', paidAmount: '30000', dueDate: due('2026-08-20') };
    expect(chargeStatus(charge, NOW)).toBe('parcial');
  });

  it('pendente quando não há pagamento e ainda não venceu', () => {
    const charge = { total: '45000', paidAmount: '0', dueDate: due('2026-08-28') };
    expect(chargeStatus(charge, NOW)).toBe('pendente');
  });

  it('cobrança de valor zero não é "paga"', () => {
    const charge = { total: '0', paidAmount: '0', dueDate: due('2026-12-31') };
    expect(chargeStatus(charge, NOW)).toBe('pendente');
  });

  it('só vence DEPOIS do último instante do dia', () => {
    const dueDate = due('2026-08-11');
    expect(isChargeOverdue(dueDate, new Date('2026-08-11T23:59:59.000Z'))).toBe(false);
    expect(isChargeOverdue(dueDate, new Date('2026-08-12T00:00:01.000Z'))).toBe(true);
  });

  it('settlementStatus ignora o tempo — é o que a coluna guarda', () => {
    const vencida = { total: '100', paidAmount: '40' };
    expect(settlementStatus(vencida)).toBe('parcial');
    expect(settlementStatus({ total: '100', paidAmount: '100' })).toBe('pago');
    expect(settlementStatus({ total: '100', paidAmount: '0' })).toBe('pendente');
  });

  it('calcula o saldo sem deixar negativo', () => {
    expect(chargeBalance({ total: '132000', paidAmount: '40000' })).toBe('92000.00');
    expect(chargeBalance({ total: '100', paidAmount: '150' })).toBe('0.00');
  });
});

describe('clientFinancialStatus — regra `clientFin`', () => {
  const due = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  it('vencido pesa mais que pendente', () => {
    const charges = [
      { total: '100', paidAmount: '0', dueDate: due('2026-07-01') },
      { total: '100', paidAmount: '0', dueDate: due('2026-12-01') },
    ];
    expect(clientFinancialStatus(charges, NOW)).toBe('vencido');
  });

  it('pendente quando há saldo mas nada venceu', () => {
    const charges = [{ total: '100', paidAmount: '40', dueDate: due('2026-12-01') }];
    expect(clientFinancialStatus(charges, NOW)).toBe('pendente');
  });

  it('em dia quando tudo está quitado', () => {
    const charges = [{ total: '100', paidAmount: '100', dueDate: due('2026-07-01') }];
    expect(clientFinancialStatus(charges, NOW)).toBe('em_dia');
  });

  it('cliente sem cobrança está em dia', () => {
    expect(clientFinancialStatus([], NOW)).toBe('em_dia');
  });

  it('soma o saldo em aberto de várias cobranças', () => {
    const charges = [
      { total: '132000', paidAmount: '40000' },
      { total: '82000', paidAmount: '30000' },
    ];
    expect(clientOpenBalance(charges)).toBe('144000.00');
  });
});

describe('tarifa e precificação', () => {
  it('o total da tarifa é a soma dos 4 custos (tf-1 do protótipo)', () => {
    const total = tariffTotal({
      costFuel: '3500',
      costFlightHour: '3000',
      costFees: '1000',
      costPilot: '1000',
    });
    expect(total).toBe('8500.00');
  });

  it('horas de voo = 2 × distância ÷ velocidade, 1 casa decimal', () => {
    // Phenom 300E a 860 km/h, trecho de 360 km → 720/860 = 0,837 → 0,8
    expect(flightHours(360, 860)).toBe(0.8);
    // AW109 a 285 km/h, trecho de 400 km → 800/285 = 2,807 → 2,8
    expect(flightHours(400, 285)).toBe(2.8);
  });

  it('devolve 0 quando falta distância ou velocidade', () => {
    expect(flightHours(null, 860)).toBe(0);
    expect(flightHours(360, 0)).toBe(0);
    expect(flightHours(0, 860)).toBe(0);
  });

  it('valor estimado = tarifa × horas, arredondado ao real', () => {
    expect(estimatedValue('8500', 2.8)).toBe('23800.00');
    expect(estimatedValue('12000', 0.8)).toBe('9600.00');
  });

  it('sem horas de voo, não há valor estimado', () => {
    expect(estimatedValue('12000', 0)).toBe('0.00');
  });

  it('valor comercial informado prevalece sobre o estimado', () => {
    const result = calculatePricing({
      tariffValue: '8500',
      distanceKm: 400,
      cruiseSpeed: 285,
      commercialValue: '30000',
    });
    expect(result.estimatedValue).toBe('23800.00');
    expect(result.commercialValue).toBe('30000.00');
  });

  it('sem valor comercial, ele acompanha o estimado', () => {
    const result = calculatePricing({
      tariffValue: '8500',
      distanceKm: 400,
      cruiseSpeed: 285,
    });
    expect(result.commercialValue).toBe('23800.00');
  });

  it('aeronave sem tarifa ativa não gera valor', () => {
    const result = calculatePricing({ tariffValue: null, distanceKm: 400, cruiseSpeed: 285 });
    expect(result.internalTariff).toBe('0.00');
    expect(result.estimatedValue).toBe('0.00');
  });
});

describe('checkConflict — conflito de agenda', () => {
  const trip = (over: Partial<ScheduledTrip> = {}): ScheduledTrip => ({
    id: 'tr-1',
    code: 'VOO-2041',
    origin: 'São Paulo (CGH)',
    destination: 'Rio de Janeiro (SDU)',
    departureAt: '2026-08-11T11:00:00.000Z',
    returnAt: '2026-08-11T21:00:00.000Z',
    status: 'confirmada',
    ...over,
  });

  const block = (over: Partial<ScheduledBlock> = {}): ScheduledBlock => ({
    id: 'bl-1',
    kind: 'manutencao',
    reason: 'Revisão de 100h',
    startAt: '2026-08-10T03:00:00.000Z',
    endAt: '2026-08-15T02:59:00.000Z',
    ...over,
  });

  it('acusa sobreposição direta', () => {
    const result = checkConflict({
      start: '2026-08-11T12:00:00.000Z',
      end: '2026-08-11T16:00:00.000Z',
      trips: [trip()],
      blocks: [],
      marginMinutes: 45,
    });
    expect(result.conflict).toBe(true);
    if (result.conflict) {
      expect(result.reason).toBe('trip');
      expect(result.label).toContain('VOO-2041');
    }
  });

  it('acusa violação da margem mínima entre voos', () => {
    // Começa 20 minutos depois do fim do voo anterior, com margem de 45.
    const result = checkConflict({
      start: '2026-08-11T21:20:00.000Z',
      end: '2026-08-11T23:00:00.000Z',
      trips: [trip()],
      blocks: [],
      marginMinutes: 45,
    });
    expect(result.conflict).toBe(true);
    if (result.conflict) expect(result.reason).toBe('margin');
  });

  it('libera quando a margem é respeitada', () => {
    const result = checkConflict({
      start: '2026-08-11T22:00:00.000Z',
      end: '2026-08-11T23:00:00.000Z',
      trips: [trip()],
      blocks: [],
      marginMinutes: 45,
    });
    expect(result.conflict).toBe(false);
  });

  it('margem zero desativa a checagem de intervalo', () => {
    const result = checkConflict({
      start: '2026-08-11T21:01:00.000Z',
      end: '2026-08-11T23:00:00.000Z',
      trips: [trip()],
      blocks: [],
      marginMinutes: 0,
    });
    expect(result.conflict).toBe(false);
  });

  it('acusa conflito com manutenção', () => {
    const result = checkConflict({
      start: '2026-08-12T13:00:00.000Z',
      end: '2026-08-12T21:00:00.000Z',
      trips: [],
      blocks: [block()],
      marginMinutes: 45,
    });
    expect(result.conflict).toBe(true);
    if (result.conflict) {
      expect(result.reason).toBe('block');
      expect(result.label).toContain('Manutenção');
    }
  });

  it('viagem recusada ou cancelada NÃO ocupa a aeronave', () => {
    for (const status of ['recusada', 'cancelada'] as const) {
      const result = checkConflict({
        start: '2026-08-11T12:00:00.000Z',
        end: '2026-08-11T16:00:00.000Z',
        trips: [trip({ status })],
        blocks: [],
        marginMinutes: 45,
      });
      expect(result.conflict, `status ${status} não deveria conflitar`).toBe(false);
    }
  });

  it('ao editar, a própria viagem não conflita consigo mesma', () => {
    const result = checkConflict({
      start: '2026-08-11T12:00:00.000Z',
      end: '2026-08-11T16:00:00.000Z',
      trips: [trip()],
      blocks: [],
      marginMinutes: 45,
      ignoreTripId: 'tr-1',
    });
    expect(result.conflict).toBe(false);
  });

  it('fórmula de sobreposição: encostar não é sobrepor', () => {
    // Fim de A exatamente no início de B.
    expect(
      overlaps(
        '2026-01-01T10:00:00Z',
        '2026-01-01T12:00:00Z',
        '2026-01-01T12:00:00Z',
        '2026-01-01T14:00:00Z',
      ),
    ).toBe(false);
    expect(
      overlaps(
        '2026-01-01T10:00:00Z',
        '2026-01-01T12:01:00Z',
        '2026-01-01T12:00:00Z',
        '2026-01-01T14:00:00Z',
      ),
    ).toBe(true);
  });
});

describe('dayAvailability — calendário mascarado do cliente', () => {
  const day = new Date(2026, 7, 12); // 12/08/2026, hora local

  const trip = (aircraftId: string): ScheduledTrip & { aircraftId: string } => ({
    id: `tr-${aircraftId}`,
    code: 'VOO-1',
    origin: 'A',
    destination: 'B',
    departureAt: new Date(2026, 7, 12, 8).toISOString(),
    returnAt: new Date(2026, 7, 12, 18).toISOString(),
    status: 'confirmada',
    aircraftId,
  });

  it('disponível quando ao menos uma aeronave está livre', () => {
    const status = dayAvailability(
      { aircraftIds: ['ac-1', 'ac-2'], trips: [trip('ac-1')], blocks: [] },
      day,
    );
    expect(status).toBe('disponivel');
  });

  it('ocupado quando todas estão em voo', () => {
    const status = dayAvailability(
      { aircraftIds: ['ac-1'], trips: [trip('ac-1')], blocks: [] },
      day,
    );
    expect(status).toBe('ocupado');
  });

  it('indisponível quando a única aeronave está bloqueada', () => {
    const status = dayAvailability(
      {
        aircraftIds: ['ac-1'],
        trips: [],
        blocks: [
          {
            id: 'bl-1',
            kind: 'manutencao',
            reason: 'Revisão',
            startAt: new Date(2026, 7, 10).toISOString(),
            endAt: new Date(2026, 7, 15).toISOString(),
            aircraftId: 'ac-1',
          },
        ],
      },
      day,
    );
    expect(status).toBe('indisponivel');
  });
});

describe('validações de agendamento', () => {
  const now = new Date('2026-08-11T15:00:00.000Z');

  it('recusa volta antes da ida', () => {
    const problems = validateScheduleWindow({
      departureAt: '2026-09-10T10:00:00Z',
      returnAt: '2026-09-09T10:00:00Z',
      now,
    });
    expect(problems).toContain('volta_antes_da_ida');
  });

  it('recusa data no passado ao criar', () => {
    const problems = validateScheduleWindow({
      departureAt: '2026-08-01T10:00:00Z',
      returnAt: '2026-08-02T10:00:00Z',
      now,
    });
    expect(problems).toContain('data_no_passado');
  });

  it('permite data no passado ao editar um registro antigo', () => {
    const problems = validateScheduleWindow({
      departureAt: '2026-08-01T10:00:00Z',
      returnAt: '2026-08-02T10:00:00Z',
      now,
      allowPast: true,
    });
    expect(problems).not.toContain('data_no_passado');
  });

  it('exige documento quando o CLIENTE solicita', () => {
    const problems = validatePassengers([{ name: 'Fernando Tavares' }], true);
    expect(problems).toContain('passageiro_sem_documento');
  });

  it('NÃO exige documento quando o OPERACIONAL agenda direto', () => {
    const problems = validatePassengers([{ name: 'Fernando Tavares' }], false);
    expect(problems).toEqual([]);
  });

  it('exige nome de todo passageiro', () => {
    const problems = validatePassengers([{ name: '  ', documentFileId: 'doc-1' }], true);
    expect(problems).toContain('passageiro_sem_nome');
  });

  it('exige ao menos um passageiro', () => {
    expect(validatePassengers([], false)).toContain('sem_passageiros');
  });
});
