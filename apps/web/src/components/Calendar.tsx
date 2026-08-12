/**
 * Calendário da agenda — protótipo: `Calendar` (mês / semana / dia).
 *
 * Os eventos vêm prontos do servidor (`/availability/calendar`), já com cliente
 * e aeronave por `include`. O protótipo montava isso em memória com um `find`
 * por evento — o N+1 clássico.
 */

import {
  addDays,
  addMonths,
  formatTime,
  MONTH_LABELS,
  monthGrid,
  sameLocalDay,
  startOfLocalDay,
  weekGrid,
  type CalendarEvent,
} from '@acm/shared';
import { useMemo, useState } from 'react';
import type { JSX } from 'react';

import { Btn, Card, Icon } from './ui';

type View = 'mes' | 'semana' | 'dia';

const EVENT_CLS: Record<CalendarEvent['kind'], string> = {
  trip: 'bg-primary/10 text-primary border-primary/20',
  manutencao: 'bg-warning-soft text-[#9A6A10] border-warning/30',
  bloqueio: 'bg-slate-100 text-slate-600 border-slate-300',
};

const EVENT_DOT: Record<CalendarEvent['kind'], string> = {
  trip: 'bg-primary',
  manutencao: 'bg-warning',
  bloqueio: 'bg-slate-400',
};

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;

function eventsOnDay(events: readonly CalendarEvent[], day: Date): CalendarEvent[] {
  const target = startOfLocalDay(day).getTime();
  return events
    .filter((event) => {
      const start = startOfLocalDay(event.start).getTime();
      const end = startOfLocalDay(event.end).getTime();
      return target >= start && target <= end;
    })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

export function Calendar({
  events,
  cursor,
  onCursorChange,
  onEventClick,
  onDayClick,
  today,
}: {
  events: readonly CalendarEvent[];
  cursor: Date;
  onCursorChange: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
  onDayClick?: (day: Date) => void;
  today: Date;
}): JSX.Element {
  const [view, setView] = useState<View>('mes');

  const move = (direction: number): void => {
    onCursorChange(
      view === 'mes'
        ? addMonths(cursor, direction)
        : addDays(cursor, view === 'semana' ? direction * 7 : direction),
    );
  };

  const title = useMemo(() => {
    if (view === 'mes') {
      return `${MONTH_LABELS[cursor.getMonth()] ?? ''} de ${cursor.getFullYear()}`;
    }
    if (view === 'dia') {
      return `${WEEKDAYS[cursor.getDay()] ?? ''}, ${cursor.getDate()} de ${MONTH_LABELS[cursor.getMonth()] ?? ''}`;
    }
    const start = addDays(cursor, -cursor.getDay());
    const end = addDays(start, 6);
    return `${start.getDate()}/${start.getMonth() + 1} – ${end.getDate()}/${end.getMonth() + 1}`;
  }, [view, cursor]);

  const todayStart = startOfLocalDay(today);
  const monthDays = monthGrid(cursor);
  const weekDays = weekGrid(cursor);

  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-1">
          <Btn
            variant="outline"
            size="icon"
            aria-label="Anterior"
            onClick={() => {
              move(-1);
            }}
          >
            <Icon name="ChevronLeft" size={16} />
          </Btn>
          <Btn
            variant="outline"
            size="icon"
            aria-label="Próximo"
            onClick={() => {
              move(1);
            }}
          >
            <Icon name="ChevronRight" size={16} />
          </Btn>
          <Btn
            variant="ghost"
            size="sm"
            onClick={() => {
              onCursorChange(today);
            }}
          >
            Hoje
          </Btn>
          <span className="ml-2 text-sm font-semibold capitalize">{title}</span>
        </div>

        <div className="sm:ml-auto">
          <div className="inline-flex rounded-lg bg-soft p-1">
            {(
              [
                ['mes', 'Mês'],
                ['semana', 'Semana'],
                ['dia', 'Dia'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setView(key);
                }}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  view === key ? 'bg-white shadow-card' : 'text-sub'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === 'mes' && (
        <div>
          <div className="grid grid-cols-7 border-b border-line">
            {WEEKDAYS.map((weekday) => (
              <div
                key={weekday}
                className="px-2 py-2 text-center text-xs font-semibold uppercase text-sub"
              >
                {weekday}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {monthDays.map((day, index) => {
              const dayEvents = eventsOnDay(events, day);
              const inMonth = day.getMonth() === cursor.getMonth();
              const isToday = sameLocalDay(day, today);
              const isPast = startOfLocalDay(day).getTime() < todayStart.getTime();
              const canPick = onDayClick !== undefined && !isPast && inMonth;

              return (
                <div
                  key={day.toISOString()}
                  onClick={() => {
                    if (canPick) onDayClick(day);
                  }}
                  title={
                    canPick
                      ? 'Agendar viagem nesta data'
                      : isPast && onDayClick !== undefined
                        ? 'Data já passou'
                        : undefined
                  }
                  className={`group min-h-[104px] border-b border-r border-line p-1.5 ${
                    !inMonth ? 'bg-soft/40' : ''
                  } ${isPast && inMonth ? 'bg-soft/30' : ''} ${index % 7 === 0 ? 'border-l' : ''} ${
                    canPick ? 'cursor-pointer transition-colors hover:bg-primary-soft/40' : ''
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between">
                    {canPick ? (
                      <span className="text-primary opacity-0 transition-opacity group-hover:opacity-100">
                        <Icon name="Plus" size={14} />
                      </span>
                    ) : (
                      <span />
                    )}
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                        isToday ? 'bg-primary text-white' : inMonth ? '' : 'text-sub/50'
                      }`}
                    >
                      {day.getDate()}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {dayEvents.slice(0, 3).map((event) => (
                      <button
                        key={event.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEventClick(event);
                        }}
                        className={`flex w-full items-center gap-1 truncate rounded border px-1.5 py-0.5 text-left text-[11px] ${EVENT_CLS[event.kind]}`}
                      >
                        <span className="font-medium">{formatTime(event.start)}</span>
                        <span className="truncate">
                          {event.aircraftPrefix !== null ? `${event.aircraftPrefix} · ` : ''}
                          {event.clientName ?? event.title}
                        </span>
                      </button>
                    ))}
                    {dayEvents.length > 3 && (
                      <span className="block px-1 text-[11px] text-sub">
                        +{dayEvents.length - 3} mais
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view === 'semana' && (
        <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-7 sm:divide-x sm:divide-y-0">
          {weekDays.map((day) => {
            const dayEvents = eventsOnDay(events, day);
            const isToday = sameLocalDay(day, today);
            return (
              <div key={day.toISOString()} className="min-h-[200px] p-2">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium uppercase text-sub">
                    {WEEKDAYS[day.getDay()]}
                  </span>
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                      isToday ? 'bg-primary text-white' : ''
                    }`}
                  >
                    {day.getDate()}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {dayEvents.length === 0 ? (
                    <p className="px-1 text-[11px] text-sub/50">—</p>
                  ) : (
                    dayEvents.map((event) => (
                      <button
                        key={event.id}
                        type="button"
                        onClick={() => {
                          onEventClick(event);
                        }}
                        className={`w-full rounded-md border p-1.5 text-left text-[11px] ${EVENT_CLS[event.kind]}`}
                      >
                        <span className="block font-semibold">{formatTime(event.start)}</span>
                        <span className="block truncate">{event.clientName ?? event.title}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view === 'dia' && (
        <div className="p-4">
          {eventsOnDay(events, cursor).length === 0 ? (
            <div className="py-12 text-center text-sm text-sub">Nenhum compromisso neste dia.</div>
          ) : (
            <div className="space-y-2">
              {eventsOnDay(events, cursor).map((event) => (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => {
                    onEventClick(event);
                  }}
                  className="flex w-full items-center gap-3 rounded-lg border border-line p-3 text-left hover:bg-soft/60"
                >
                  <span className={`h-2.5 w-2.5 rounded-full ${EVENT_DOT[event.kind]}`} />
                  <span className="w-14 text-sm font-semibold">{formatTime(event.start)}</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{event.clientName ?? event.title}</p>
                    <p className="text-xs text-sub">
                      {event.origin !== null
                        ? `${event.origin} → ${event.destination ?? ''}`
                        : (event.subtitle ?? '')}
                      {event.aircraftPrefix !== null ? ` · ${event.aircraftPrefix}` : ''}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 border-t border-line p-4 text-xs text-sub">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-primary" />
          Voo
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-warning" />
          Manutenção
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
          Bloqueio
        </span>
      </div>
    </Card>
  );
}
