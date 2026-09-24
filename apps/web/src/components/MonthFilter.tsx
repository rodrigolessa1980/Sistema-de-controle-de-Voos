/**
 * Filtro de mês dos painéis — anterior / seletor / próximo / volta ao mês atual.
 *
 * O valor é sempre uma chave "AAAA-MM", o mesmo formato do `?month=` da API.
 */

import { MONTH_LABELS } from '@acm/shared';
import type { JSX } from 'react';

import { Btn, Icon, Select } from './ui';

/** "AAAA-MM" do mês corrente, no fuso local. */
export function currentMonthKey(): string {
  const now = new Date();
  return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** "AAAA-MM" → [ano, mês 1–12]. */
function parseMonthKey(key: string): [number, number] {
  const [year = '', month = ''] = key.split('-');
  return [Number(year), Number(month)];
}

/** Desloca um "AAAA-MM" em `delta` meses. */
export function shiftMonthKey(key: string, delta: number): string {
  const [year, month] = parseMonthKey(key);
  const d = new Date(year, month - 1 + delta, 1);
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** "setembro de 2026". */
export function monthKeyLabel(key: string): string {
  const [year, month] = parseMonthKey(key);
  return `${MONTH_LABELS[month - 1] ?? ''} de ${String(year)}`;
}

export function MonthFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}): JSX.Element {
  const current = currentMonthKey();
  // 24 meses para trás e 12 para frente do mês atual — e o selecionado, se estiver fora.
  const options = Array.from({ length: 37 }, (_, i) => shiftMonthKey(current, 12 - i));
  if (!options.includes(value)) options.push(value);

  return (
    <div className="flex items-center gap-2">
      <Btn
        variant="outline"
        size="icon"
        aria-label="Mês anterior"
        onClick={() => {
          onChange(shiftMonthKey(value, -1));
        }}
      >
        <Icon name="ChevronLeft" size={16} />
      </Btn>
      <Select
        aria-label="Mês de referência"
        className="w-48 capitalize"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      >
        {options.map((key) => (
          <option key={key} value={key} className="capitalize">
            {monthKeyLabel(key)}
          </option>
        ))}
      </Select>
      <Btn
        variant="outline"
        size="icon"
        aria-label="Próximo mês"
        onClick={() => {
          onChange(shiftMonthKey(value, 1));
        }}
      >
        <Icon name="ChevronRight" size={16} />
      </Btn>
      {value !== current && (
        <Btn
          variant="ghost"
          size="sm"
          onClick={() => {
            onChange(current);
          }}
        >
          Mês atual
        </Btn>
      )}
    </div>
  );
}
