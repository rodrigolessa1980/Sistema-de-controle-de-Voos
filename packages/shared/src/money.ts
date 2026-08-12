/**
 * Dinheiro.
 *
 * REGRA: valor monetário trafega na API como **string decimal** ("132000.00"),
 * nunca como `number`. Ponto flutuante binário não representa 0,1 exatamente,
 * então somar centavos em `number` acumula erro — inaceitável em cobrança.
 *
 * Toda aritmética aqui acontece em **centavos inteiros**. `Number.isSafeInteger`
 * cobre até 9.007.199.254.740.991 centavos (~90 trilhões de reais), folga
 * suficiente para o domínio.
 *
 * No servidor, o valor vira `Prisma.Decimal` na borda do banco; no cliente, é
 * exibido por `formatBRL`. O tipo `Money` é uma string marcada (branded) para
 * que um `number` cru não entre por engano onde se espera dinheiro.
 */

declare const moneyBrand: unique symbol;

/** String decimal com 2 casas. Construa com `money()` ou `fromCents()`. */
export type Money = string & { readonly [moneyBrand]: 'Money' };

export const ZERO = '0.00' as Money;

const MONEY_PATTERN = /^-?\d+(\.\d{1,2})?$/;

/** Erro de valor monetário malformado — capturado na borda, nunca ignorado. */
export class MoneyError extends Error {
  constructor(value: unknown) {
    super(`Valor monetário inválido: ${JSON.stringify(value)}`);
    this.name = 'MoneyError';
  }
}

/**
 * Converte para centavos inteiros.
 *
 * Aceita string decimal, `number` finito, ou objeto com `toString()` — que é o
 * caso de `Prisma.Decimal`, permitindo passar o valor do banco direto.
 */
export function toCents(value: string | number | { toString(): string }): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new MoneyError(value);
    return Math.round(value * 100);
  }

  const raw = typeof value === 'string' ? value.trim() : value.toString().trim();
  if (!MONEY_PATTERN.test(raw)) throw new MoneyError(value);

  const negative = raw.startsWith('-');
  const digits = negative ? raw.slice(1) : raw;
  const dot = digits.indexOf('.');

  const whole = dot === -1 ? digits : digits.slice(0, dot);
  const frac = dot === -1 ? '' : digits.slice(dot + 1).padEnd(2, '0');

  const cents = Number(whole) * 100 + Number(frac);
  if (!Number.isSafeInteger(cents)) throw new MoneyError(value);
  return negative ? -cents : cents;
}

/** Centavos inteiros → string decimal de 2 casas. */
export function fromCents(cents: number): Money {
  if (!Number.isInteger(cents)) throw new MoneyError(cents);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${frac}` as Money;
}

/** Normaliza qualquer entrada para `Money`. Lança se for inválida. */
export function money(value: string | number | { toString(): string }): Money {
  return fromCents(toCents(value));
}

/**
 * Normaliza, ou devolve `fallback` se a entrada for nula/inválida.
 *
 * Aceita `unknown` de propósito: é o ponto de entrada para valor vindo de JSON
 * ou de formulário, onde o tipo ainda não foi verificado.
 */
export function moneyOr(value: unknown, fallback: Money = ZERO): Money {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  if (value === '') return fallback;
  try {
    return money(value);
  } catch {
    return fallback;
  }
}

export function add(...values: (string | number)[]): Money {
  return fromCents(values.reduce<number>((acc, v) => acc + toCents(v), 0));
}

export function subtract(a: string | number, b: string | number): Money {
  return fromCents(toCents(a) - toCents(b));
}

/** Multiplica por um fator (ex.: horas de voo), arredondando ao centavo. */
export function multiply(value: string | number, factor: number): Money {
  if (!Number.isFinite(factor)) throw new MoneyError(factor);
  return fromCents(Math.round(toCents(value) * factor));
}

export function compare(a: string | number, b: string | number): -1 | 0 | 1 {
  const ca = toCents(a);
  const cb = toCents(b);
  if (ca < cb) return -1;
  if (ca > cb) return 1;
  return 0;
}

export const isZero = (v: string | number): boolean => toCents(v) === 0;
export const isPositive = (v: string | number): boolean => toCents(v) > 0;

/** `max(0, value)` — protótipo: `balance = Math.max(0, total - paid)`. */
export function clampToZero(value: string | number): Money {
  const cents = toCents(value);
  return cents < 0 ? ZERO : fromCents(cents);
}

export function maxMoney(a: string | number, b: string | number): Money {
  return compare(a, b) >= 0 ? money(a) : money(b);
}

// ---------------------------------------------------------------- apresentação

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const BRL_COMPACT = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Protótipo: `money()`. Entrada inválida vira R$ 0,00 em vez de quebrar a tela. */
export function formatBRL(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return BRL.format(0);
  try {
    return BRL.format(toCents(value) / 100);
  } catch {
    return BRL.format(0);
  }
}

/** Protótipo: `moneyShort()` — compacta a partir de mil. */
export function formatBRLShort(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return BRL.format(0);
  let cents: number;
  try {
    cents = toCents(value);
  } catch {
    return BRL.format(0);
  }
  const reais = cents / 100;
  return Math.abs(reais) >= 1000 ? BRL_COMPACT.format(reais) : BRL.format(reais);
}
