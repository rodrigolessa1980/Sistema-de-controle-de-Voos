/**
 * Utilidades de data.
 *
 * REGRA DE FUSO (docs/PLANO.md §12.1): o banco guarda tudo em **UTC**; a
 * apresentação é em `America/Sao_Paulo`. O protótipo congelava o "hoje" em
 * `const TODAY = new Date('2026-08-11T12:00:00')` — aqui `now` é sempre
 * parâmetro explícito, nunca lido de dentro da função. Sem isso, nenhuma regra
 * que depende de tempo é testável.
 */

export const DISPLAY_TIME_ZONE = 'America/Sao_Paulo';

/** Aceita `Date` ou string ISO. Lança em entrada inválida em vez de virar NaN. */
export function toDate(value: Date | string): Date {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new RangeError(`Data inválida: ${String(value)}`);
  return d;
}

/**
 * Type guard: além de responder se a data é válida, ELIMINA `null`/`undefined`
 * do tipo. É o que deixa os formatadores abaixo chamarem `toDate` sem cast.
 */
export function isValidDate(value: Date | string | null | undefined): value is Date | string {
  if (value === null || value === undefined || value === '') return false;
  const d = value instanceof Date ? value : new Date(value);
  return !Number.isNaN(d.getTime());
}

// ------------------------------------------------------------------ dia local
// Usadas na montagem do calendário, que raciocina no fuso do usuário.

export function startOfLocalDay(value: Date | string): Date {
  const d = toDate(value);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(value: Date | string, days: number): Date {
  const d = toDate(value);
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

export function addMonths(value: Date | string, months: number): Date {
  const d = toDate(value);
  const out = new Date(d);
  out.setMonth(out.getMonth() + months);
  return out;
}

/** `YYYY-MM-DD` no fuso local — protótipo: `toISODate`. */
export function toISODate(value: Date | string): string {
  const d = toDate(value);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

export function sameLocalDay(a: Date | string, b: Date | string): boolean {
  const da = toDate(a);
  const db = toDate(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/** Protótipo: `combine(d, t)` → `"2026-08-11T08:00:00"`. */
export function combineDateTime(date: string, time: string): string {
  if (!date) return '';
  return `${date}T${time || '00:00'}:00`;
}

/**
 * Grade de 42 células do calendário mensal (6 semanas × 7 dias), começando no
 * domingo — protótipo: `monthDays`.
 */
export function monthGrid(cursor: Date | string): Date[] {
  const d = toDate(cursor);
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const gridStart = addDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

/** Os 7 dias da semana que contém `cursor`, de domingo a sábado. */
export function weekGrid(cursor: Date | string): Date[] {
  const d = toDate(cursor);
  const weekStart = addDays(d, -d.getDay());
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

// -------------------------------------------------------------------- dia UTC
// Usadas nas regras de vencimento, onde a coluna é `@db.Date` e o Prisma
// devolve meia-noite UTC.

/** Último instante do dia UTC de `value` — protótipo: `dueDate + 'T23:59:59'`. */
export function endOfUtcDay(value: Date | string): Date {
  const d = toDate(value);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

export function startOfUtcDay(value: Date | string): Date {
  const d = toDate(value);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** `YYYY-MM-DD` em UTC — para colunas `@db.Date`, sem risco de virar o dia. */
export function toUtcISODate(value: Date | string): string {
  const d = toDate(value);
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${month}-${day}`;
}

/** `YYYY-MM-DD` → `Date` na meia-noite UTC, para gravar em coluna `@db.Date`. */
export function parseUtcDateOnly(value: string): Date {
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new RangeError(`Data inválida: ${value}`);
  return d;
}

// -------------------------------------------------------------- apresentação

export const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;

export const MONTH_LABELS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

export const MONTH_ABBR = [
  'Jan',
  'Fev',
  'Mar',
  'Abr',
  'Mai',
  'Jun',
  'Jul',
  'Ago',
  'Set',
  'Out',
  'Nov',
  'Dez',
] as const;

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: DISPLAY_TIME_ZONE,
});

const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: DISPLAY_TIME_ZONE,
});

const timeFmt = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: DISPLAY_TIME_ZONE,
});

/**
 * Datas puras (`@db.Date`) são formatadas em UTC de propósito: um vencimento em
 * 30/07 gravado como `2026-07-30T00:00:00Z` viraria 29/07 se exibido em
 * São Paulo (UTC-3).
 */
const dateOnlyFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});

const EMPTY = '—';

/** Protótipo: `fdate` — para instantes (com fuso de exibição). */
export function formatDate(value: Date | string | null | undefined): string {
  if (!isValidDate(value)) return EMPTY;
  return dateFmt.format(toDate(value));
}

/** Para colunas de data pura: vencimento, vigência de tarifa, data de pagamento. */
export function formatDateOnly(value: Date | string | null | undefined): string {
  if (!isValidDate(value)) return EMPTY;
  return dateOnlyFmt.format(toDate(value));
}

/** Protótipo: `fdatetime`. */
export function formatDateTime(value: Date | string | null | undefined): string {
  if (!isValidDate(value)) return EMPTY;
  return dateTimeFmt.format(toDate(value));
}

/** Protótipo: `hhmm`. */
export function formatTime(value: Date | string | null | undefined): string {
  if (!isValidDate(value)) return EMPTY;
  return timeFmt.format(toDate(value));
}

/** Iniciais para o avatar — protótipo: `initials`. */
export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase();
}
