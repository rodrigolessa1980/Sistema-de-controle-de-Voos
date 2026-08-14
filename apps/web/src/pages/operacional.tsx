/**
 * Telas do Operacional — protótipo: `OpDashboard`, `OpAgenda`, `OpSolicitacoes`,
 * `OpViagens`, `OpAeronaves`, `OpConfig`.
 */

import {
  AIRCRAFT_KINDS,
  AIRCRAFT_STATUS_LABELS,
  AIRCRAFT_STATUSES,
  COST_FIELDS,
  KIND_LABELS,
  Money,
  ROLE_KEYS,
  ROLE_LABELS,
  TARIFF_UNIT_LABELS,
  createAircraftBodySchema,
  createTariffBodySchema,
  updateAircraftBodySchema,
  updateTariffBodySchema,
  TARIFF_UNITS,
  TRIP_STATUS_LABELS,
  TRIP_STATUSES,
  addDays,
  addMonths,
  formatDate,
  formatDateTime,
  LOCKED_TRIP_STATUSES,
  toISODate,
  type Aircraft,
  type CalendarEvent,
  type Client,
  type FlightRequest,
  type RoleKey,
  type Settings,
  type Tariff,
  type TripInternal,
  type TripStatus,
  type User,
} from '@acm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { JSX } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Calendar } from '../components/Calendar';
import { PassengerList } from '../components/PassengersEditor';
import { TripForm, type TripPrefill } from '../components/TripForm';
import {
  AircraftBadge,
  Avatar,
  Badge,
  Banner,
  Btn,
  Card,
  DetailRow,
  Empty,
  ErrorState,
  Field,
  Icon,
  Input,
  Loading,
  Menu,
  Modal,
  PageHead,
  RequestBadge,
  SearchBox,
  Select,
  Stat,
  Tabs,
  TD,
  TH,
  Toggle,
  TripBadge,
  UserBadge,
} from '../components/ui';
import { api, ApiRequestError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFormErrors, validateBody } from '../lib/form';
import { useFeedback } from '../lib/feedback';
import { queryKeys } from '../lib/query-keys';

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

// ============================================================================
//  DASHBOARD
// ============================================================================

interface OperationalDashboardData {
  tripsToday: number;
  upcomingTrips: number;
  pendingRequests: number;
  confirmedUpcoming: number;
  availableAircraft: number;
  totalAircraft: number;
  clientsWithDebt: number;
  nextTrips: {
    id: string;
    code: string;
    clientName: string;
    origin: string;
    destination: string;
    departureAt: string;
    status: TripStatus;
  }[];
  recentRequests: {
    id: string;
    code: string;
    clientName: string;
    origin: string;
    destination: string;
    departureAt: string;
    passengers: number;
  }[];
}

export function OpDashboard(): JSX.Element {
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: queryKeys.dashboardOp,
    queryFn: () => api.get<OperationalDashboardData>('/dashboard/operacional'),
  });

  if (query.isPending) return <Loading />;
  if (query.isError) {
    return (
      <ErrorState
        message="Não foi possível carregar o painel."
        onRetry={() => void query.refetch()}
      />
    );
  }

  const d = query.data;

  return (
    <div className="space-y-6">
      <PageHead
        title="Dashboard"
        desc={`Visão geral da operação de hoje, ${formatDate(new Date())}.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Stat
          label="Voos hoje"
          value={d.tripsToday}
          icon="PlaneTakeoff"
          hint="Embarques agendados"
        />
        <Stat label="Próximos voos" value={d.upcomingTrips} icon="Clock3" hint="A partir de hoje" />
        <Stat
          label="Solicitações"
          value={d.pendingRequests}
          icon="Inbox"
          tone="warning"
          hint="Aguardando análise"
        />
        <Stat
          label="Confirmados"
          value={d.confirmedUpcoming}
          icon="CheckCircle2"
          tone="success"
          hint="Próximos voos confirmados"
        />
        <Stat
          label="Aeronaves livres"
          value={`${d.availableAircraft}/${d.totalAircraft}`}
          icon="Plane"
          tone="success"
          hint="Disponíveis"
        />
        <Stat
          label="Clientes c/ pendência"
          value={d.clientsWithDebt}
          icon="AlertTriangle"
          tone="danger"
          hint="Pagamento em aberto"
        />
      </div>

      {d.clientsWithDebt > 0 && (
        <Banner
          tone="warning"
          icon="AlertTriangle"
          title={`${d.clientsWithDebt} ${d.clientsWithDebt === 1 ? 'cliente possui pagamento pendente' : 'clientes possuem pagamentos pendentes'}`}
          action={
            <Btn
              variant="outline"
              size="sm"
              onClick={() => {
                void navigate('/operacional/clientes');
              }}
            >
              Ver clientes
            </Btn>
          }
        >
          Revise a situação financeira antes de confirmar novos voos.
        </Banner>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between p-5 pb-3">
            <div>
              <h3 className="font-semibold">Próximos voos</h3>
              <p className="text-sm text-sub">Agenda dos próximos embarques</p>
            </div>
            <Btn
              variant="ghost"
              size="sm"
              onClick={() => {
                void navigate('/operacional/viagens');
              }}
            >
              Ver todas <Icon name="ArrowRight" size={16} />
            </Btn>
          </div>
          {d.nextTrips.length === 0 ? (
            <Empty icon="PlaneTakeoff" title="Nenhum voo agendado" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <TH>Horário</TH>
                    <TH>Cliente</TH>
                    <TH>Origem</TH>
                    <TH>Destino</TH>
                    <TH>Status</TH>
                  </tr>
                </thead>
                <tbody>
                  {d.nextTrips.map((trip) => (
                    <tr key={trip.id} className="border-b border-line last:border-0">
                      <TD className="whitespace-nowrap font-medium">
                        {formatDateTime(trip.departureAt)}
                      </TD>
                      <TD>
                        <div className="flex items-center gap-2">
                          <Avatar name={trip.clientName} size="h-7 w-7 text-[10px]" />
                          <span className="whitespace-nowrap">{trip.clientName}</span>
                        </div>
                      </TD>
                      <TD className="text-sub">{trip.origin}</TD>
                      <TD className="text-sub">{trip.destination}</TD>
                      <TD>
                        <TripBadge status={trip.status} />
                      </TD>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <div className="p-5 pb-3">
            <h3 className="font-semibold">Solicitações recentes</h3>
            <p className="text-sm text-sub">Aguardando sua análise</p>
          </div>
          <div className="space-y-3 px-5 pb-5">
            {d.recentRequests.length === 0 ? (
              <Empty icon="Inbox" title="Tudo em dia" />
            ) : (
              <>
                {d.recentRequests.map((request) => (
                  <div
                    key={request.id}
                    className="rounded-lg border border-line p-3 hover:bg-soft/40"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{request.clientName}</span>
                      <span className="text-xs text-sub">{request.code}</span>
                    </div>
                    <p className="mt-1 text-xs text-sub">
                      {request.origin} → {request.destination}
                    </p>
                    <p className="text-xs text-sub">
                      {formatDate(request.departureAt)} · {request.passengers} pax
                    </p>
                  </div>
                ))}
                <Btn
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    void navigate('/operacional/solicitacoes');
                  }}
                >
                  Analisar solicitações
                </Btn>
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ============================================================================
//  AGENDA
// ============================================================================

export function OpAgenda(): JSX.Element {
  const today = new Date();
  const [cursor, setCursor] = useState(today);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [prefill, setPrefill] = useState<TripPrefill | null>(null);

  // Janela de 3 meses ao redor do cursor: cobre a navegação sem refazer a busca
  // a cada clique, e respeita o teto de janela do servidor.
  const from = addMonths(new Date(cursor.getFullYear(), cursor.getMonth(), 1), -1);
  const to = addDays(addMonths(from, 3), -1);

  const events = useQuery({
    queryKey: queryKeys.calendar(from.toISOString(), to.toISOString()),
    queryFn: () =>
      api.get<{ events: CalendarEvent[] }>('/availability/calendar', {
        from: from.toISOString(),
        to: to.toISOString(),
      }),
  });

  return (
    <div className="space-y-6">
      <PageHead title="Agenda" desc="Calendário de voos, manutenções e bloqueios da frota." />

      <div className="flex items-center gap-2 rounded-lg border border-line bg-primary-soft/50 px-3 py-2 text-xs text-primary-dark">
        <Icon name="Info" size={14} /> Clique em um dia do calendário para agendar uma viagem já com
        a data da ida preenchida. O Operacional agenda direto — sem aprovação.
      </div>

      {events.isPending ? (
        <Loading />
      ) : events.isError ? (
        <ErrorState
          message="Não foi possível carregar a agenda."
          onRetry={() => void events.refetch()}
        />
      ) : (
        <Calendar
          events={events.data.events}
          cursor={cursor}
          onCursorChange={setCursor}
          onEventClick={setSelected}
          today={today}
          onDayClick={(day) => {
            setPrefill({ departureDate: toISODate(day) });
            setFormOpen(true);
          }}
        />
      )}

      <TripForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
        }}
        prefill={prefill}
      />

      <Modal
        open={selected !== null}
        onClose={() => {
          setSelected(null);
        }}
        size="max-w-md"
        title={selected?.kind === 'trip' ? 'Detalhe do voo' : (selected?.title ?? '')}
      >
        {selected !== null && (
          <div className="space-y-3 text-sm">
            <DetailRow
              label="Período"
              value={`${formatDateTime(selected.start)} → ${formatDateTime(selected.end)}`}
            />
            {selected.clientName !== null && (
              <DetailRow icon="User" label="Cliente" value={selected.clientName} />
            )}
            {selected.origin !== null && (
              <DetailRow
                icon="MapPin"
                label="Trajeto"
                value={`${selected.origin} → ${selected.destination ?? ''}`}
              />
            )}
            {selected.aircraftPrefix !== null && (
              <DetailRow icon="Plane" label="Aeronave" value={selected.aircraftPrefix} />
            )}
            {selected.subtitle !== null && <DetailRow label="Motivo" value={selected.subtitle} />}
            <div className="flex items-center gap-2 pt-1">
              <span className="text-sub">Status:</span>
              {selected.status !== null ? (
                <TripBadge status={selected.status} />
              ) : (
                <Badge tone="neutral">
                  {selected.kind === 'manutencao' ? 'Manutenção' : 'Bloqueio'}
                </Badge>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ============================================================================
//  SOLICITAÇÕES
// ============================================================================

export function OpSolicitacoes(): JSX.Element {
  const queryClient = useQueryClient();
  const { notify, notifyError, confirm } = useFeedback();
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<FlightRequest | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [prefill, setPrefill] = useState<TripPrefill | null>(null);

  const requests = useQuery({
    queryKey: queryKeys.requestList({ q: search }),
    queryFn: () => api.get<Page<FlightRequest>>('/requests', { q: search, limit: 50 }),
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.requests });
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboardOp });
  };

  const review = useMutation({
    mutationFn: (id: string) => api.post(`/requests/${id}/review`),
    onSuccess: invalidate,
    onError: (e) => {
      notifyError(e);
    },
  });

  const reject = useMutation({
    mutationFn: (id: string) => api.post(`/requests/${id}/reject`, {}),
    onSuccess: () => {
      invalidate();
      notify('success', 'Solicitação recusada');
    },
    onError: (e) => {
      notifyError(e);
    },
  });

  const convert = (request: FlightRequest): void => {
    setPrefill({
      clientId: request.clientId,
      origin: request.origin,
      destination: request.destination,
      departureDate: request.departureAt.slice(0, 10),
      departureTime: new Date(request.departureAt).toTimeString().slice(0, 5),
      returnDate: request.returnAt.slice(0, 10),
      returnTime: new Date(request.returnAt).toTimeString().slice(0, 5),
      requestId: request.id,
      passengers: request.pax.map((p) => ({ name: p.name, documentFileId: p.documentFileId })),
    });
    setFormOpen(true);
  };

  const pending = (requests.data?.items ?? []).filter(
    (r) => r.status === 'aguardando_analise',
  ).length;

  return (
    <div className="space-y-6">
      <PageHead title="Solicitações" desc={`${pending} solicitação(ões) aguardando sua análise.`} />

      <Card>
        <div className="border-b border-line p-4">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Buscar por código, cliente ou destino"
          />
        </div>

        {requests.isPending ? (
          <Loading />
        ) : requests.isError ? (
          <ErrorState
            message="Não foi possível carregar."
            onRetry={() => void requests.refetch()}
          />
        ) : requests.data.items.length === 0 ? (
          <Empty
            icon="Inbox"
            title="Nenhuma solicitação"
            desc="Pedidos dos clientes aparecerão aqui."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  <TH>Código</TH>
                  <TH>Cliente</TH>
                  <TH>Trajeto</TH>
                  <TH>Ida</TH>
                  <TH className="text-center">Pax</TH>
                  <TH>Status</TH>
                  <TH />
                </tr>
              </thead>
              <tbody>
                {requests.data.items.map((request) => {
                  const closed = request.status === 'convertida' || request.status === 'recusada';
                  return (
                    <tr key={request.id} className="border-b border-line last:border-0">
                      <TD className="font-medium">{request.code}</TD>
                      <TD>
                        <div className="flex items-center gap-2">
                          <Avatar name={request.client?.name ?? '?'} size="h-7 w-7 text-[10px]" />
                          <span className="whitespace-nowrap">{request.client?.name ?? '—'}</span>
                        </div>
                      </TD>
                      <TD className="text-sub">
                        {request.origin} → {request.destination}
                      </TD>
                      <TD className="whitespace-nowrap">{formatDateTime(request.departureAt)}</TD>
                      <TD className="text-center">{request.passengers}</TD>
                      <TD>
                        <RequestBadge status={request.status} />
                      </TD>
                      <TD>
                        <Menu
                          items={[
                            {
                              label: 'Ver detalhes',
                              icon: 'Eye',
                              onClick: () => {
                                setDetail(request);
                              },
                            },
                            {
                              label: 'Marcar em análise',
                              icon: 'ClipboardCheck',
                              hidden: request.status !== 'aguardando_analise',
                              onClick: () => {
                                review.mutate(request.id);
                              },
                            },
                            {
                              label: 'Agendar viagem',
                              icon: 'PlaneTakeoff',
                              hidden: closed,
                              onClick: () => {
                                convert(request);
                              },
                            },
                            {
                              label: 'Recusar',
                              icon: 'XCircle',
                              danger: true,
                              separator: true,
                              hidden: closed,
                              onClick: () => {
                                confirm({
                                  title: 'Recusar solicitação?',
                                  desc: `${request.code} será marcada como recusada.`,
                                  danger: true,
                                  confirmLabel: 'Recusar',
                                  onConfirm: () => {
                                    reject.mutate(request.id);
                                  },
                                });
                              },
                            },
                          ]}
                        />
                      </TD>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <TripForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
        }}
        prefill={prefill}
      />

      <Modal
        open={detail !== null}
        onClose={() => {
          setDetail(null);
        }}
        title={detail?.code ?? ''}
        desc="Solicitação de voo do cliente"
        footer={
          detail !== null &&
          detail.status !== 'convertida' &&
          detail.status !== 'recusada' && (
            <>
              <Btn
                variant="outline"
                onClick={() => {
                  setDetail(null);
                }}
              >
                Fechar
              </Btn>
              <Btn
                onClick={() => {
                  convert(detail);
                  setDetail(null);
                }}
              >
                <Icon name="PlaneTakeoff" size={16} /> Agendar viagem
              </Btn>
            </>
          )
        }
      >
        {detail !== null && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <DetailRow icon="User" label="Cliente" value={detail.client?.name ?? '—'} />
              <DetailRow icon="Users" label="Passageiros" value={String(detail.passengers)} />
              <DetailRow icon="PlaneTakeoff" label="Origem" value={detail.origin} />
              <DetailRow icon="PlaneTakeoff" label="Destino" value={detail.destination} />
              <DetailRow
                icon="CalendarClock"
                label="Ida"
                value={formatDateTime(detail.departureAt)}
              />
              <DetailRow
                icon="CalendarClock"
                label="Volta"
                value={formatDateTime(detail.returnAt)}
              />
            </div>
            {detail.notes !== null && (
              <div className="rounded-lg bg-soft p-3 text-sm text-sub">{detail.notes}</div>
            )}
            {detail.pax.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-sub">
                  Passageiros e documentos
                </p>
                <PassengerList pax={detail.pax} />
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

// ============================================================================
//  VIAGENS
// ============================================================================

export function OpViagens(): JSX.Element {
  const queryClient = useQueryClient();
  const { notify, notifyError, confirm } = useFeedback();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | TripStatus>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TripInternal | null>(null);
  const [detail, setDetail] = useState<TripInternal | null>(null);

  const trips = useQuery({
    queryKey: queryKeys.tripList({ q: search, status }),
    queryFn: () =>
      api.get<Page<TripInternal>>('/trips', {
        q: search,
        limit: 50,
        ...(status === 'all' ? {} : { status }),
      }),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/trips/${id}/cancel`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.trips });
      void queryClient.invalidateQueries({ queryKey: ['calendar'] });
      notify('success', 'Viagem cancelada');
    },
    onError: (e) => {
      notifyError(e);
    },
  });

  return (
    <div className="space-y-6">
      <PageHead title="Viagens" desc="Gerencie todas as viagens criadas para os clientes.">
        <Btn
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Icon name="Plus" size={16} /> Nova viagem
        </Btn>
      </PageHead>

      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Buscar por código, cliente ou destino"
          />
          <div className="sm:ml-auto sm:w-52">
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as 'all' | TripStatus);
              }}
            >
              <option value="all">Todos os status</option>
              {TRIP_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TRIP_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {trips.isPending ? (
          <Loading />
        ) : trips.isError ? (
          <ErrorState message="Não foi possível carregar." onRetry={() => void trips.refetch()} />
        ) : trips.data.items.length === 0 ? (
          <Empty
            icon="PlaneTakeoff"
            title="Nenhuma viagem encontrada"
            desc="Ajuste a busca ou crie uma nova viagem."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  <TH>Código</TH>
                  <TH>Cliente</TH>
                  <TH>Trajeto</TH>
                  <TH>Ida</TH>
                  <TH>Aeronave</TH>
                  <TH>Valor</TH>
                  <TH>Status</TH>
                  <TH />
                </tr>
              </thead>
              <tbody>
                {trips.data.items.map((trip) => (
                  <tr key={trip.id} className="border-b border-line last:border-0">
                    <TD className="font-medium">{trip.code}</TD>
                    <TD className="whitespace-nowrap">{trip.client?.name ?? '—'}</TD>
                    <TD className="text-sub">
                      {trip.origin} → {trip.destination}
                    </TD>
                    <TD className="whitespace-nowrap">{formatDateTime(trip.departureAt)}</TD>
                    <TD className="whitespace-nowrap text-sub">
                      {trip.aircraft === null
                        ? '—'
                        : `${trip.aircraft.prefix} · ${trip.aircraft.model}`}
                    </TD>
                    <TD className="whitespace-nowrap font-medium">
                      {trip.commercialValue === null ? '—' : Money.formatBRL(trip.commercialValue)}
                    </TD>
                    <TD>
                      <TripBadge status={trip.status} />
                    </TD>
                    <TD>
                      <Menu
                        items={[
                          {
                            label: 'Visualizar',
                            icon: 'Eye',
                            onClick: () => {
                              setDetail(trip);
                            },
                          },
                          {
                            label: 'Editar',
                            icon: 'Pencil',
                            hidden: LOCKED_TRIP_STATUSES.includes(trip.status),
                            onClick: () => {
                              setEditing(trip);
                              setFormOpen(true);
                            },
                          },
                          {
                            label: 'Cancelar viagem',
                            icon: 'XCircle',
                            danger: true,
                            separator: true,
                            hidden: ['concluida', 'cancelada', 'recusada'].includes(trip.status),
                            onClick: () => {
                              confirm({
                                title: 'Cancelar viagem?',
                                desc: `${trip.code} será marcada como cancelada.`,
                                danger: true,
                                confirmLabel: 'Cancelar viagem',
                                cancelLabel: 'Voltar',
                                onConfirm: () => {
                                  cancel.mutate(trip.id);
                                },
                              });
                            },
                          },
                        ]}
                      />
                    </TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <TripForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
        }}
        editing={editing}
      />

      <Modal
        open={detail !== null}
        onClose={() => {
          setDetail(null);
        }}
        size="max-w-lg"
        title={detail?.code ?? ''}
        desc={detail?.client?.name ?? ''}
      >
        {detail !== null && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <DetailRow label="Origem" value={detail.origin} />
              <DetailRow label="Destino" value={detail.destination} />
              <DetailRow label="Ida" value={formatDateTime(detail.departureAt)} />
              <DetailRow label="Volta" value={formatDateTime(detail.returnAt)} />
              <DetailRow label="Passageiros" value={String(detail.passengers)} />
              <DetailRow
                label="Aeronave"
                value={
                  detail.aircraft === null
                    ? '—'
                    : `${detail.aircraft.prefix} · ${detail.aircraft.model}`
                }
              />
              <DetailRow
                label="Distância (ida)"
                value={detail.distanceKm === null ? '—' : `${detail.distanceKm} km`}
              />
              <DetailRow
                label="Horas de voo"
                value={detail.flightHours === null ? '—' : `${detail.flightHours} h`}
              />
              <DetailRow
                label="Tarifa interna"
                value={
                  detail.internalTariff === null
                    ? '—'
                    : `${Money.formatBRL(detail.internalTariff)}/h`
                }
              />
              <DetailRow
                label="Valor comercial"
                value={
                  detail.commercialValue === null ? '—' : Money.formatBRL(detail.commercialValue)
                }
              />
            </div>
            {detail.notes !== null && (
              <div className="rounded-lg bg-soft p-3 text-sm text-sub">{detail.notes}</div>
            )}
            {detail.pax.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-sub">
                  Passageiros e documentos
                </p>
                <PassengerList pax={detail.pax} />
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-sm text-sub">Status:</span>
              <TripBadge status={detail.status} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ============================================================================
//  AERONAVES
// ============================================================================

export function OpAeronaves(): JSX.Element {
  const queryClient = useQueryClient();
  const { notify, notifyError, confirm } = useFeedback();
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Aircraft | null>(null);

  const aircraft = useQuery({
    queryKey: queryKeys.aircraftList({ q: search }),
    queryFn: () => api.get<Page<Aircraft>>('/aircraft', { q: search, limit: 50 }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/aircraft/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.aircraft });
      notify('success', 'Aeronave removida');
    },
    onError: (e) => {
      notifyError(e);
    },
  });

  return (
    <div className="space-y-6">
      <PageHead
        title="Aeronaves"
        desc="Frota de uso interno. Clientes nunca visualizam estas informações."
      >
        <Btn
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Icon name="Plus" size={16} /> Nova aeronave
        </Btn>
      </PageHead>

      <div className="flex items-center gap-2 rounded-lg border border-line bg-primary-soft/60 px-3 py-2 text-xs text-primary-dark">
        <Icon name="Lock" size={14} /> Área interna — prefixos, modelos e tipos são confidenciais.
      </div>

      <Card>
        <div className="border-b border-line p-4">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Buscar por prefixo ou modelo"
          />
        </div>

        {aircraft.isPending ? (
          <Loading />
        ) : aircraft.isError ? (
          <ErrorState
            message="Não foi possível carregar."
            onRetry={() => void aircraft.refetch()}
          />
        ) : aircraft.data.items.length === 0 ? (
          <Empty icon="Plane" title="Nenhuma aeronave" desc="Cadastre a primeira aeronave." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  <TH>Prefixo</TH>
                  <TH>Tipo</TH>
                  <TH>Modelo</TH>
                  <TH>Fabricante</TH>
                  <TH>Capacidade</TH>
                  <TH>Vel. cruzeiro</TH>
                  <TH>Status</TH>
                  <TH />
                </tr>
              </thead>
              <tbody>
                {aircraft.data.items.map((item) => (
                  <tr key={item.id} className="border-b border-line last:border-0">
                    <TD className="font-medium">{item.prefix}</TD>
                    <TD>
                      <span className="inline-flex items-center gap-1.5">
                        <Icon name="Plane" size={14} className="text-sub" />
                        {KIND_LABELS[item.kind]}
                      </span>
                    </TD>
                    <TD>{item.model}</TD>
                    <TD className="text-sub">{item.manufacturer}</TD>
                    <TD>{item.capacity} pax</TD>
                    <TD className="text-sub">
                      {item.cruiseSpeed > 0 ? `${item.cruiseSpeed} km/h` : '—'}
                    </TD>
                    <TD>
                      <AircraftBadge status={item.status} />
                    </TD>
                    <TD>
                      <Menu
                        items={[
                          {
                            label: 'Editar',
                            icon: 'Pencil',
                            onClick: () => {
                              setEditing(item);
                              setFormOpen(true);
                            },
                          },
                          {
                            label: 'Remover',
                            icon: 'Trash2',
                            danger: true,
                            separator: true,
                            onClick: () => {
                              confirm({
                                title: 'Remover aeronave?',
                                desc: `${item.prefix} sai das listas. O histórico de viagens é preservado.`,
                                danger: true,
                                confirmLabel: 'Remover',
                                onConfirm: () => {
                                  remove.mutate(item.id);
                                },
                              });
                            },
                          },
                        ]}
                      />
                    </TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <AircraftForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
        }}
        editing={editing}
      />
    </div>
  );
}

function AircraftForm({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: Aircraft | null;
}): JSX.Element {
  const queryClient = useQueryClient();
  const { notify, notifyError } = useFeedback();
  const { setErrors, setServerErrors, clearAll, errorOf } = useFormErrors();

  const [form, setForm] = useState({
    prefix: '',
    kind: 'aviao' as Aircraft['kind'],
    model: '',
    manufacturer: '',
    capacity: '4',
    cruiseSpeed: '',
    status: 'disponivel' as Aircraft['status'],
  });

  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setForm({
        prefix: editing?.prefix ?? '',
        kind: editing?.kind ?? 'aviao',
        model: editing?.model ?? '',
        manufacturer: editing?.manufacturer ?? '',
        capacity: String(editing?.capacity ?? 4),
        cruiseSpeed:
          editing?.cruiseSpeed !== undefined && editing.cruiseSpeed > 0
            ? String(editing.cruiseSpeed)
            : '',
        status: editing?.status ?? 'disponivel',
      });
    }
  }

  const save = useMutation({
    // Corpo já validado pelo contrato — ver `submit` abaixo.
    mutationFn: (body: Record<string, unknown>) =>
      editing
        ? api.patch<Aircraft>(`/aircraft/${editing.id}`, body)
        : api.post<Aircraft>('/aircraft', body),
    onSuccess: (item) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.aircraft });
      notify('success', editing ? 'Aeronave atualizada' : 'Aeronave cadastrada', item.prefix);
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiRequestError) setServerErrors(e.details);
      notifyError(e);
    },
  });

  const valid =
    form.prefix.trim() !== '' && form.model.trim() !== '' && form.manufacturer.trim() !== '';

  /** Valida com o MESMO schema Zod da rota antes de enviar. */
  const submit = (): void => {
    const raw = {
      prefix: form.prefix.trim().toUpperCase(),
      kind: form.kind,
      model: form.model.trim(),
      manufacturer: form.manufacturer.trim(),
      capacity: Number(form.capacity) || 1,
      cruiseSpeed: Number(form.cruiseSpeed) || 0,
      status: form.status,
    };

    const result = validateBody(editing ? updateAircraftBodySchema : createAircraftBodySchema, raw);
    if (!result.ok) {
      setErrors(result.errors);
      notify('error', 'Verifique os campos destacados', Object.values(result.errors)[0]);
      return;
    }

    clearAll();
    save.mutate(raw);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Editar aeronave' : 'Nova aeronave'}
      desc="Informação interna. Clientes nunca visualizam a frota."
      footer={
        <>
          <Btn variant="outline" onClick={onClose}>
            Cancelar
          </Btn>
          <Btn onClick={submit} disabled={!valid || save.isPending}>
            {editing ? 'Salvar' : 'Cadastrar'}
          </Btn>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Prefixo" required help="Matrícula (ex: PR-HLX)." error={errorOf('prefix')}>
          <Input
            value={form.prefix}
            onChange={(e) => {
              setForm((s) => ({ ...s, prefix: e.target.value }));
            }}
            placeholder="PR-HLX"
            className="uppercase"
          />
        </Field>
        <Field label="Tipo" required help="Avião ou helicóptero.">
          <Select
            value={form.kind}
            onChange={(e) => {
              setForm((s) => ({ ...s, kind: e.target.value as Aircraft['kind'] }));
            }}
          >
            {AIRCRAFT_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Modelo" required help="Modelo da aeronave." error={errorOf('model')}>
          <Input
            value={form.model}
            onChange={(e) => {
              setForm((s) => ({ ...s, model: e.target.value }));
            }}
            placeholder="Phenom 300E"
          />
        </Field>
        <Field label="Fabricante" required help="Quem fabricou." error={errorOf('manufacturer')}>
          <Input
            value={form.manufacturer}
            onChange={(e) => {
              setForm((s) => ({ ...s, manufacturer: e.target.value }));
            }}
            placeholder="Embraer"
          />
        </Field>
        <Field
          label="Capacidade"
          required
          help="Quantos passageiros cabem."
          error={errorOf('capacity')}
        >
          <Input
            type="number"
            min="1"
            value={form.capacity}
            onChange={(e) => {
              setForm((s) => ({ ...s, capacity: e.target.value }));
            }}
          />
        </Field>
        <Field
          label="Velocidade de cruzeiro (km/h)"
          help="Usada para estimar as horas de voo a partir da distância."
        >
          <Input
            type="number"
            min="0"
            value={form.cruiseSpeed}
            onChange={(e) => {
              setForm((s) => ({ ...s, cruiseSpeed: e.target.value }));
            }}
            placeholder="Ex: 860"
          />
        </Field>
        <Field label="Status" required help="Situação atual.">
          <Select
            value={form.status}
            onChange={(e) => {
              setForm((s) => ({ ...s, status: e.target.value as Aircraft['status'] }));
            }}
          >
            {AIRCRAFT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {AIRCRAFT_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

// ============================================================================
//  CONFIGURAÇÕES
// ============================================================================

const CONFIG_TABS = ['geral', 'tarifas', 'margem', 'permissoes'] as const;
type ConfigTab = (typeof CONFIG_TABS)[number];

const isConfigTab = (value: string | null): value is ConfigTab =>
  value !== null && (CONFIG_TABS as readonly string[]).includes(value);

export function OpConfiguracoes(): JSX.Element {
  const { can } = useAuth();

  /**
   * A aba escolhida mora na URL (`?aba=permissoes`), não em `useState`.
   *
   * É o que permite ao clique no sino cair direto na fila de liberação — um
   * `useState` só é alcançável por clique, e o aviso teria de mandar a pessoa
   * para Configurações e pedir que ela achasse a aba sozinha. De brinde: o botão
   * voltar funciona e dá para mandar o link para alguém.
   */
  const [params, setParams] = useSearchParams();
  const tab: ConfigTab = isConfigTab(params.get('aba'))
    ? (params.get('aba') as ConfigTab)
    : 'geral';

  const setTab = (next: ConfigTab): void => {
    // `replace`: trocar de aba não empilha uma entrada nova no histórico, senão
    // o voltar passeia pelas abas antes de sair da tela.
    setParams(next === 'geral' ? {} : { aba: next }, { replace: true });
  };

  /**
   * A aba Permissões só existe para quem tem `user:read` — na matriz de papéis,
   * só o administrador. O operacional entra em Configurações (tem
   * `settings:read`) e não pode liberar acesso de ninguém.
   *
   * Esconder a aba é UX: as rotas `/users/*` recusam de qualquer forma. Mas
   * mostrar um botão que sempre dá 403 é pior que não mostrar.
   */
  const canManageUsers = can('user:read');
  const pendingCount = usePendingUserCount(canManageUsers);

  // Sem permissão — inclusive quem digitou `?aba=permissoes` na mão ou guardou o
  // link e depois foi rebaixado — cai em Geral, em vez de renderizar uma tela que
  // o servidor vai negar de qualquer forma.
  const active: ConfigTab = tab === 'permissoes' && !canManageUsers ? 'geral' : tab;

  return (
    <div className="space-y-6">
      <PageHead
        title="Configurações"
        desc={
          canManageUsers
            ? 'Ajustes gerais, tarifas, margem entre voos e liberação de acessos.'
            : 'Ajustes gerais, tarifas e margem entre voos.'
        }
      />
      <Tabs
        value={active}
        onChange={setTab}
        tabs={[
          { key: 'geral', label: 'Geral', icon: 'Building2' },
          { key: 'tarifas', label: 'Tarifas', icon: 'Settings2' },
          { key: 'margem', label: 'Margem entre voos', icon: 'Clock' },
          ...(canManageUsers
            ? ([
                {
                  key: 'permissoes',
                  label: pendingCount > 0 ? `Permissões (${String(pendingCount)})` : 'Permissões',
                  icon: 'ShieldCheck',
                },
              ] as const)
            : []),
        ]}
      />
      {active === 'geral' && <SettingsGeneral />}
      {active === 'tarifas' && <TariffsTab />}
      {active === 'margem' && <SettingsMargin />}
      {active === 'permissoes' && <SettingsPermissions />}
    </div>
  );
}

function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => api.get<Settings>('/settings'),
  });
}

function SettingsGeneral(): JSX.Element {
  const queryClient = useQueryClient();
  const { notify, notifyError } = useFeedback();
  const settings = useSettings();

  const [form, setForm] = useState({ companyName: '', contactEmail: '', timezone: '' });
  const [loaded, setLoaded] = useState(false);

  if (!loaded && settings.data !== undefined) {
    setLoaded(true);
    setForm({
      companyName: settings.data.companyName,
      contactEmail: settings.data.contactEmail,
      timezone: settings.data.timezone,
    });
  }

  const save = useMutation({
    mutationFn: () => api.patch<Settings>('/settings', form),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
      notify('success', 'Configurações salvas');
    },
    onError: (e) => {
      notifyError(e);
    },
  });

  if (settings.isPending) return <Loading />;

  return (
    <Card className="p-5">
      <h3 className="font-semibold">Informações da empresa</h3>
      <p className="text-sm text-sub">Dados exibidos no sistema e nos e-mails enviados.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Nome da empresa" help="Nome que aparece no sistema.">
          <Input
            value={form.companyName}
            onChange={(e) => {
              setForm((s) => ({ ...s, companyName: e.target.value }));
            }}
          />
        </Field>
        <Field label="E-mail de contato" help="Também recebe o aviso de nova solicitação de voo.">
          <Input
            value={form.contactEmail}
            onChange={(e) => {
              setForm((s) => ({ ...s, contactEmail: e.target.value }));
            }}
          />
        </Field>
        <Field label="Fuso horário" help="Usado nas agendas.">
          <Input
            value={form.timezone}
            onChange={(e) => {
              setForm((s) => ({ ...s, timezone: e.target.value }));
            }}
          />
        </Field>
      </div>
      <Btn
        className="mt-4"
        onClick={() => {
          save.mutate();
        }}
        disabled={save.isPending}
      >
        <Icon name="Save" size={16} /> Salvar
      </Btn>
    </Card>
  );
}

function SettingsMargin(): JSX.Element {
  const queryClient = useQueryClient();
  const { notify, notifyError } = useFeedback();
  const settings = useSettings();
  const [margin, setMargin] = useState('');
  const [loaded, setLoaded] = useState(false);

  if (!loaded && settings.data !== undefined) {
    setLoaded(true);
    setMargin(String(settings.data.marginMinutes));
  }

  const save = useMutation({
    mutationFn: () => api.patch<Settings>('/settings', { marginMinutes: Number(margin) || 0 }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
      notify('success', 'Margem atualizada', `${margin} minutos`);
    },
    onError: (e) => {
      notifyError(e);
    },
  });

  if (settings.isPending) return <Loading />;

  return (
    <Card className="p-5">
      <h3 className="font-semibold">Margem entre voos</h3>
      <p className="text-sm text-sub">
        Tempo mínimo de intervalo entre dois voos da mesma aeronave (preparação, reabastecimento,
        tripulação).
      </p>
      <div className="mt-4 max-w-xs">
        <Field label="Intervalo mínimo (minutos)" help="Ex: 45 minutos entre um voo e outro.">
          <Input
            type="number"
            min="0"
            value={margin}
            onChange={(e) => {
              setMargin(e.target.value);
            }}
          />
        </Field>
      </div>
      <div className="mt-4 rounded-lg bg-primary-soft/60 p-3 text-sm text-primary-dark">
        Valor atual: <strong>{settings.data?.marginMinutes} minutos</strong>. É aplicado na
        verificação de disponibilidade, no servidor.
      </div>
      <Btn
        className="mt-4"
        onClick={() => {
          save.mutate();
        }}
        disabled={save.isPending}
      >
        <Icon name="Save" size={16} /> Salvar
      </Btn>
    </Card>
  );
}

// ----------------------------------------------------------------- permissões

interface UserPage extends Page<User> {
  total?: number;
}

/**
 * Quantos cadastros esperam liberação — para o número na aba.
 *
 * `limit: 1` porque só o `total` interessa: contar no servidor custa um
 * `SELECT COUNT`, trazer as linhas para contar no navegador custa a lista
 * inteira. O cache é o mesmo da aba, então abrir Permissões não refaz a busca.
 */
function usePendingUserCount(enabled: boolean): number {
  const query = useQuery({
    queryKey: queryKeys.userList({ status: 'pendente', limit: 1 }),
    queryFn: () => api.get<UserPage>('/users', { status: 'pendente', limit: 1 }),
    enabled,
  });
  return query.data?.total ?? 0;
}

/**
 * Configurações → Permissões: a fila de quem se cadastrou e a lista de acessos.
 *
 * É o outro lado do formulário da tela de login. Quem se cadastra fica
 * `pendente`, sem entrar em lugar nenhum; aqui o administrador escolhe o papel e
 * libera — ou recusa, e o cadastro é apagado, liberando o e-mail para uma nova
 * tentativa.
 */
function SettingsPermissions(): JSX.Element {
  const queryClient = useQueryClient();
  const { notify, notifyError, confirm } = useFeedback();

  const pending = useQuery({
    queryKey: queryKeys.userList({ status: 'pendente' }),
    queryFn: () => api.get<UserPage>('/users', { status: 'pendente', limit: 100 }),
  });

  const everyone = useQuery({
    queryKey: queryKeys.userList({ all: true }),
    queryFn: () => api.get<UserPage>('/users', { limit: 100 }),
  });

  /** Papel escolhido por linha, antes de liberar. Sem escolha = `cliente`. */
  const [roles, setRoles] = useState<Record<string, RoleKey>>({});
  /** Cliente escolhido por linha. `''` = criar um cadastro novo. */
  const [links, setLinks] = useState<Record<string, string>>({});
  /** Papel escolhido na tabela de quem já tem acesso, antes de salvar. */
  const [newRoles, setNewRoles] = useState<Record<string, RoleKey>>({});

  const chosenRole = (id: string): RoleKey => roles[id] ?? 'cliente';

  // A lista de clientes só é buscada quando alguma linha está sendo liberada
  // como `cliente` — é o único caso em que o vínculo aparece na tela.
  const needsClients = (pending.data?.items ?? []).some(
    (item) => chosenRole(item.id) === 'cliente',
  );
  const clients = useQuery({
    queryKey: queryKeys.clientList({ forApproval: true }),
    queryFn: () => api.get<Page<Client>>('/clients', { limit: 100 }),
    enabled: needsClients,
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.users });
    void queryClient.invalidateQueries({ queryKey: queryKeys.clients });
  };

  const approve = useMutation({
    mutationFn: ({ user, role, clientId }: { user: User; role: RoleKey; clientId?: string }) =>
      api.post<User>(`/users/${user.id}/approve`, {
        role,
        ...(clientId === undefined || clientId === '' ? {} : { clientId }),
      }),
    onSuccess: (updated) => {
      invalidate();
      notify(
        'success',
        'Acesso liberado',
        `${updated.name} · ${ROLE_LABELS[updated.role]}${
          updated.clientName === null ? '' : ` · ${updated.clientName}`
        }`,
      );
    },
    onError: (e) => {
      notifyError(e);
    },
  });

  const reject = useMutation({
    mutationFn: (user: User) => api.post<{ ok: true }>(`/users/${user.id}/reject`),
    onSuccess: () => {
      invalidate();
      notify('success', 'Cadastro recusado', 'O e-mail volta a ficar livre para novo cadastro.');
    },
    onError: (e) => {
      notifyError(e);
    },
  });

  /**
   * Troca o papel de quem JÁ tem acesso.
   *
   * O autocadastro entra como Cliente; é por aqui que alguém vira Operacional,
   * Financeiro ou Administrador. Antes disto, a própria tela avisava que a troca
   * "é feita direto no banco" — o que na prática queria dizer que não era feita.
   *
   * O servidor recusa dois casos que a tela também esconde, e a recusa dele é que
   * vale: trocar o próprio papel, e rebaixar o último administrador ativo.
   */
  const changeRole = useMutation({
    mutationFn: ({ user, role }: { user: User; role: RoleKey }) =>
      api.patch<User>(`/users/${user.id}/role`, { role }),
    onSuccess: (updated) => {
      invalidate();
      setNewRoles((current) => {
        const { [updated.id]: _, ...rest } = current;
        return rest;
      });
      notify(
        'success',
        'Perfil alterado',
        `${updated.name} agora é ${ROLE_LABELS[updated.role]}.`,
      );
    },
    onError: (e) => {
      notifyError(e);
    },
  });

  if (pending.isError) {
    return (
      <ErrorState
        message="Não foi possível carregar os cadastros."
        onRetry={() => {
          void pending.refetch();
        }}
      />
    );
  }

  const queue = pending.data?.items ?? [];
  const active = (everyone.data?.items ?? []).filter((item) => item.status !== 'pendente');

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex items-center justify-between p-5 pb-3">
          <div>
            <h3 className="font-semibold">Cadastros aguardando liberação</h3>
            <p className="text-sm text-sub">
              Quem se cadastrou na tela de login. Escolha o perfil e libere o acesso.
            </p>
          </div>
          {queue.length > 0 && <Badge tone="warning">{queue.length} na fila</Badge>}
        </div>

        {pending.isPending ? (
          <Loading />
        ) : queue.length === 0 ? (
          <Empty
            icon="ShieldCheck"
            title="Nenhum cadastro na fila"
            desc="Quando alguém se cadastrar na tela de login, o pedido aparece aqui."
          />
        ) : (
          <div className="divide-y divide-line border-t border-line">
            {queue.map((item) => {
              const role = chosenRole(item.id);
              const busy = approve.isPending || reject.isPending;

              return (
                <div key={item.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={item.name} />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{item.name}</p>
                        <p className="truncate text-sm text-sub">{item.email}</p>
                      </div>
                    </div>
                    <p className="text-xs text-sub">
                      Solicitado em {formatDateTime(item.createdAt)}
                    </p>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <Field label="Perfil de acesso" help="Define o que a pessoa pode ver e fazer.">
                      <Select
                        value={role}
                        onChange={(e) => {
                          setRoles((current) => ({
                            ...current,
                            [item.id]: e.target.value as RoleKey,
                          }));
                        }}
                      >
                        {ROLE_KEYS.map((key) => (
                          <option key={key} value={key}>
                            {ROLE_LABELS[key]}
                          </option>
                        ))}
                      </Select>
                    </Field>

                    {/*
                      Papel Cliente exige um cadastro de cliente do outro lado —
                      é ele que dá o escopo por linha. Sem vínculo, a pessoa
                      entra e não vê nada, o que na tela parece defeito.
                    */}
                    {role === 'cliente' && (
                      <Field
                        label="Vincular ao cliente"
                        help="Deixe em branco para criar um cadastro novo com estes dados."
                      >
                        <Select
                          value={links[item.id] ?? ''}
                          disabled={clients.isPending}
                          onChange={(e) => {
                            setLinks((current) => ({ ...current, [item.id]: e.target.value }));
                          }}
                        >
                          <option value="">Criar novo cadastro de cliente</option>
                          {(clients.data?.items ?? []).map((client) => (
                            <option key={client.id} value={client.id}>
                              {client.name}
                              {client.company === null ? '' : ` · ${client.company}`}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Btn
                      disabled={busy}
                      onClick={() => {
                        const clientId = role === 'cliente' ? (links[item.id] ?? '') : '';
                        confirm({
                          title: 'Liberar acesso?',
                          desc: `${item.name} entra como ${ROLE_LABELS[role]} e passa a acessar o sistema com a senha que cadastrou.`,
                          confirmLabel: 'Liberar',
                          onConfirm: () => {
                            approve.mutate({ user: item, role, clientId });
                          },
                        });
                      }}
                    >
                      <Icon name="Check" size={16} /> Liberar acesso
                    </Btn>
                    <Btn
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        confirm({
                          title: 'Recusar cadastro?',
                          desc: `O pedido de ${item.name} é apagado. O e-mail ${item.email} volta a ficar livre para um novo cadastro.`,
                          danger: true,
                          confirmLabel: 'Recusar',
                          onConfirm: () => {
                            reject.mutate(item);
                          },
                        });
                      }}
                    >
                      <Icon name="X" size={16} /> Recusar
                    </Btn>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card>
        <div className="p-5 pb-3">
          <h3 className="font-semibold">Usuários com acesso</h3>
          <p className="text-sm text-sub">
            Quem já pode entrar. Quem se cadastra na tela de login entra como Cliente — troque o
            perfil aqui para dar mais alcance.
          </p>
        </div>

        {everyone.isPending ? (
          <Loading />
        ) : active.length === 0 ? (
          <Empty icon="Users" title="Nenhum usuário liberado" />
        ) : (
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full text-sm">
              <thead className="bg-soft">
                <tr>
                  <TH>Nome</TH>
                  <TH>E-mail</TH>
                  <TH>Perfil</TH>
                  <TH>Cliente</TH>
                  <TH>Situação</TH>
                  <TH>Último acesso</TH>
                  <TH>Ações</TH>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {active.map((item) => (
                  <tr key={item.id}>
                    <TD className="font-medium">{item.name}</TD>
                    <TD className="text-sub">{item.email}</TD>
                    <TD>
                      <Select
                        value={newRoles[item.id] ?? item.role}
                        disabled={changeRole.isPending}
                        onChange={(e) => {
                          setNewRoles((current) => ({
                            ...current,
                            [item.id]: e.target.value as RoleKey,
                          }));
                        }}
                      >
                        {ROLE_KEYS.map((key) => (
                          <option key={key} value={key}>
                            {ROLE_LABELS[key]}
                          </option>
                        ))}
                      </Select>
                    </TD>
                    <TD className="text-sub">{item.clientName ?? '—'}</TD>
                    <TD>
                      <UserBadge status={item.status} />
                    </TD>
                    <TD className="text-sub">
                      {item.lastLoginAt === null
                        ? 'nunca entrou'
                        : formatDateTime(item.lastLoginAt)}
                    </TD>
                    <TD>
                      {/*
                        O botão só aparece quando o seletor difere do papel
                        gravado. Um "Salvar" sempre visível em toda linha convida
                        ao clique distraído numa tabela cuja unidade é acesso de
                        gente.
                      */}
                      {(newRoles[item.id] ?? item.role) !== item.role && (
                        <Btn
                          disabled={changeRole.isPending}
                          onClick={() => {
                            const role = newRoles[item.id] ?? item.role;
                            confirm({
                              title: 'Trocar o perfil?',
                              desc: `${item.name} passa de ${ROLE_LABELS[item.role]} para ${ROLE_LABELS[role]}. O alcance muda no próximo carregamento de tela dele.`,
                              confirmLabel: 'Trocar perfil',
                              onConfirm: () => {
                                changeRole.mutate({ user: item, role });
                              },
                            });
                          }}
                        >
                          <Icon name="Check" size={16} /> Salvar
                        </Btn>
                      )}
                    </TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function TariffsTab(): JSX.Element {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Tariff | null>(null);

  const tariffs = useQuery({
    queryKey: queryKeys.tariffList({}),
    queryFn: () => api.get<Page<Tariff>>('/tariffs', { limit: 100 }),
  });

  return (
    <>
      <Card>
        <div className="flex items-center justify-between p-5 pb-3">
          <div>
            <h3 className="font-semibold">Tarifas</h3>
            <p className="text-sm text-sub">Valores por aeronave usados no cálculo das viagens.</p>
          </div>
          <Btn
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Icon name="Plus" size={16} /> Nova tarifa
          </Btn>
        </div>

        {tariffs.isPending ? (
          <Loading />
        ) : (tariffs.data?.items ?? []).length === 0 ? (
          <Empty icon="Settings2" title="Nenhuma tarifa" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  <TH>Aeronave</TH>
                  <TH>Tipo</TH>
                  <TH>Tarifa</TH>
                  <TH>Unidade</TH>
                  <TH>Vigência</TH>
                  <TH>Status</TH>
                  <TH />
                </tr>
              </thead>
              <tbody>
                {(tariffs.data?.items ?? []).map((tariff) => (
                  <tr key={tariff.id} className="border-b border-line last:border-0">
                    <TD className="font-medium">{tariff.aircraft?.prefix ?? '—'}</TD>
                    <TD className="text-sub">
                      {tariff.aircraft === null ? '—' : KIND_LABELS[tariff.aircraft.kind]}
                    </TD>
                    <TD>
                      <div className="font-medium">{Money.formatBRL(tariff.value)}</div>
                      <div className="mt-0.5 whitespace-nowrap text-[11px] text-sub">
                        Comb {Money.formatBRLShort(tariff.costFuel)} · Voo{' '}
                        {Money.formatBRLShort(tariff.costFlightHour)} · Taxas{' '}
                        {Money.formatBRLShort(tariff.costFees)} · Piloto{' '}
                        {Money.formatBRLShort(tariff.costPilot)}
                      </div>
                    </TD>
                    <TD className="text-sub">{TARIFF_UNIT_LABELS[tariff.unit]}</TD>
                    <TD className="whitespace-nowrap text-sub">
                      {formatDate(tariff.startDate)}
                      {tariff.endDate !== null ? ` – ${formatDate(tariff.endDate)}` : ''}
                    </TD>
                    <TD>
                      <Badge tone={tariff.active ? 'success' : 'neutral'}>
                        {tariff.active ? 'Ativa' : 'Inativa'}
                      </Badge>
                    </TD>
                    <TD>
                      <Menu
                        items={[
                          {
                            label: 'Editar',
                            icon: 'Pencil',
                            onClick: () => {
                              setEditing(tariff);
                              setFormOpen(true);
                            },
                          },
                        ]}
                      />
                    </TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <TariffForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
        }}
        editing={editing}
      />
    </>
  );
}

function TariffForm({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: Tariff | null;
}): JSX.Element {
  const queryClient = useQueryClient();
  const { notify, notifyError } = useFeedback();
  const { setErrors, setServerErrors, clearAll, errorOf } = useFormErrors();

  const aircraft = useQuery({
    queryKey: queryKeys.aircraftList({ limit: 100 }),
    queryFn: () => api.get<Page<Aircraft>>('/aircraft', { limit: 100 }),
    enabled: open,
  });

  const [form, setForm] = useState({
    aircraftId: '',
    costFuel: '',
    costFlightHour: '',
    costFees: '',
    costPilot: '',
    unit: 'por_hora' as Tariff['unit'],
    startDate: '',
    endDate: '',
    active: true,
  });

  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setForm({
        aircraftId: editing?.aircraftId ?? '',
        costFuel: editing?.costFuel ?? '',
        costFlightHour: editing?.costFlightHour ?? '',
        costFees: editing?.costFees ?? '',
        costPilot: editing?.costPilot ?? '',
        unit: editing?.unit ?? 'por_hora',
        startDate: editing?.startDate ?? '',
        endDate: editing?.endDate ?? '',
        active: editing?.active ?? true,
      });
    }
  }

  // O total é derivado, exatamente como no servidor.
  const total = Money.add(
    form.costFuel === '' ? '0' : form.costFuel,
    form.costFlightHour === '' ? '0' : form.costFlightHour,
    form.costFees === '' ? '0' : form.costFees,
    form.costPilot === '' ? '0' : form.costPilot,
  );

  const save = useMutation({
    // Corpo já validado pelo contrato — ver `submit` abaixo.
    mutationFn: (body: Record<string, unknown>) =>
      editing
        ? api.patch<Tariff>(`/tariffs/${editing.id}`, body)
        : api.post<Tariff>('/tariffs', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tariffs });
      notify('success', editing ? 'Tarifa atualizada' : 'Tarifa criada');
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiRequestError) setServerErrors(e.details);
      notifyError(e);
    },
  });

  const valid = form.aircraftId !== '' && Money.isPositive(total) && form.startDate !== '';

  /** Valida com o MESMO schema Zod da rota antes de enviar. */
  const submit = (): void => {
    const raw = {
      costFuel: form.costFuel === '' ? '0' : form.costFuel,
      costFlightHour: form.costFlightHour === '' ? '0' : form.costFlightHour,
      costFees: form.costFees === '' ? '0' : form.costFees,
      costPilot: form.costPilot === '' ? '0' : form.costPilot,
      unit: form.unit,
      startDate: form.startDate,
      endDate: form.endDate === '' ? null : form.endDate,
      active: form.active,
      ...(editing ? {} : { aircraftId: form.aircraftId }),
    };

    const result = validateBody(editing ? updateTariffBodySchema : createTariffBodySchema, raw);
    if (!result.ok) {
      setErrors(result.errors);
      notify('error', 'Verifique os campos destacados', Object.values(result.errors)[0]);
      return;
    }

    clearAll();
    save.mutate(raw);
  };

  const costField = (
    key: 'costFuel' | 'costFlightHour' | 'costFees' | 'costPilot',
    label: string,
    help: string,
  ): JSX.Element => (
    <Field key={key} label={label} help={help}>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-sub">
          R$
        </span>
        <Input
          type="number"
          min="0"
          step="0.01"
          value={form[key]}
          onChange={(e) => {
            setForm((s) => ({ ...s, [key]: e.target.value }));
          }}
          className="pl-9"
          placeholder="0"
        />
      </div>
    </Field>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Editar tarifa' : 'Nova tarifa'}
      desc="Monte o valor da tarifa somando os custos. Uso interno."
      footer={
        <>
          <Btn variant="outline" onClick={onClose}>
            Cancelar
          </Btn>
          <Btn onClick={submit} disabled={!valid || save.isPending}>
            {editing ? 'Salvar' : 'Criar tarifa'}
          </Btn>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field
            label="Aeronave"
            required
            help="Aeronave a que a tarifa se aplica."
            error={errorOf('aircraftId')}
          >
            <Select
              value={form.aircraftId}
              disabled={editing !== null}
              onChange={(e) => {
                setForm((s) => ({ ...s, aircraftId: e.target.value }));
              }}
            >
              <option value="">Selecione</option>
              {(aircraft.data?.items ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.prefix} · {KIND_LABELS[item.kind]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="sm:col-span-2">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-sub">
            Composição do custo
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {COST_FIELDS.map((field) => costField(field.key, field.label, field.help))}
          </div>
        </div>

        <div className="sm:col-span-2 flex items-center justify-between rounded-lg border border-primary/20 bg-primary-soft/50 p-3">
          <div>
            <p className="text-sm font-medium text-primary-dark">Valor total da tarifa</p>
            <p className="text-xs text-sub">
              Combustível + hora de voo + taxas e tarifas + despesa do piloto.
            </p>
          </div>
          <p className="text-lg font-semibold text-primary">
            {Money.formatBRL(total)}
            {form.unit === 'por_hora' ? '/h' : ''}
          </p>
        </div>

        <Field label="Tipo de cobrança" required help="Como é cobrado.">
          <Select
            value={form.unit}
            onChange={(e) => {
              setForm((s) => ({ ...s, unit: e.target.value as Tariff['unit'] }));
            }}
          >
            {TARIFF_UNITS.map((u) => (
              <option key={u} value={u}>
                {TARIFF_UNIT_LABELS[u]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Data inicial"
          required
          help="A partir de quando vale."
          error={errorOf('startDate')}
        >
          <Input
            type="date"
            value={form.startDate}
            onChange={(e) => {
              setForm((s) => ({ ...s, startDate: e.target.value }));
            }}
          />
        </Field>

        <Field label="Data final" help="Até quando vale (opcional)." error={errorOf('endDate')}>
          <Input
            type="date"
            value={form.endDate}
            onChange={(e) => {
              setForm((s) => ({ ...s, endDate: e.target.value }));
            }}
          />
        </Field>

        <div className="flex items-center justify-between rounded-lg border border-line p-3">
          <div>
            <p className="text-sm font-medium">Tarifa ativa</p>
            <p className="text-xs text-sub">Só tarifas ativas entram no cálculo.</p>
          </div>
          <Toggle
            checked={form.active}
            onChange={(v) => {
              setForm((s) => ({ ...s, active: v }));
            }}
          />
        </div>
      </div>
    </Modal>
  );
}
