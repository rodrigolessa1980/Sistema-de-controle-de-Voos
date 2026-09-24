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
  REQUEST_STATUS_LABELS,
  ROLE_KEYS,
  ROLE_LABELS,
  TARIFF_UNIT_LABELS,
  createAircraftBodySchema,
  createTariffBodySchema,
  updateAircraftBodySchema,
  updateTariffBodySchema,
  TARIFF_UNITS,
  TRIP_EXPENSE_FIELDS,
  TRIP_STATUS_LABELS,
  TRIP_STATUSES,
  addDays,
  combineDateTime,
  addMonths,
  formatDate,
  formatDateTime,
  LOCKED_TRIP_STATUSES,
  toISODate,
  updateFlightRequestBodySchema,
  type Aircraft,
  type CalendarEvent,
  type Client,
  type FlightRequest,
  type FlightRequestStatus,
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
import { currentMonthKey, MonthFilter, monthKeyLabel } from '../components/MonthFilter';
import {
  newPassenger,
  PassengerList,
  PassengersEditor,
  toPassengerBody,
  type PassengerDraft,
} from '../components/PassengersEditor';
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
  Spinner,
  Stat,
  Tabs,
  TD,
  TH,
  Textarea,
  Toggle,
  TripBadge,
  UserBadge,
} from '../components/ui';
import { api, ApiRequestError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { optionalText, toIsoDateTime, useFormErrors, validateBody } from '../lib/form';
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
  month: string;
  tripsInMonth: number;
  confirmedInMonth: number;
  requestsInMonth: number;
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
  const [month, setMonth] = useState(currentMonthKey);
  const query = useQuery({
    queryKey: [...queryKeys.dashboardOp, month],
    queryFn: () => api.get<OperationalDashboardData>('/dashboard/operacional', { month }),
    // Mantém o mês anterior na tela enquanto o novo carrega, sem piscar o loading.
    placeholderData: (previous) => previous,
  });

  const isCurrentMonth = month === currentMonthKey();
  const head = (
    <PageHead
      title="Dashboard"
      desc={`Visão geral da operação · ${monthKeyLabel(month)} · hoje é ${formatDate(new Date())}.`}
    >
      <MonthFilter value={month} onChange={setMonth} />
    </PageHead>
  );

  if (query.isPending) {
    return (
      <div className="space-y-6">
        {head}
        <Loading />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="space-y-6">
        {head}
        <ErrorState
          message="Não foi possível carregar o painel."
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  const d = query.data;

  return (
    <div className={`space-y-6 transition-opacity ${query.isPlaceholderData ? 'opacity-60' : ''}`}>
      {head}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Stat
          label="Voos no mês"
          value={d.tripsInMonth}
          icon="PlaneTakeoff"
          hint="Pela data de ida"
        />
        <Stat
          label="Confirmados"
          value={d.confirmedInMonth}
          icon="CheckCircle2"
          tone="success"
          hint="Voos confirmados no mês"
        />
        <Stat
          label="Solicitações"
          value={d.requestsInMonth}
          icon="Inbox"
          tone="warning"
          hint="Aguardando análise no mês"
        />
        <Stat label="Voos hoje" value={d.tripsToday} icon="Clock3" hint="Embarques de hoje" />
        <Stat
          label="Aeronaves livres"
          value={`${d.availableAircraft}/${d.totalAircraft}`}
          icon="Plane"
          tone="success"
          hint="Disponíveis agora"
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
              <h3 className="font-semibold">{isCurrentMonth ? 'Próximos voos' : 'Voos do mês'}</h3>
              <p className="text-sm text-sub">
                {isCurrentMonth
                  ? 'Embarques de hoje até o fim do mês'
                  : `Embarques de ${monthKeyLabel(month)}`}
              </p>
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
            <Empty icon="PlaneTakeoff" title="Nenhum voo neste mês" />
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
            <p className="text-sm text-sub">Aguardando análise · voo pedido no mês</p>
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
  const { role, can } = useAuth();
  const { notifyError } = useFeedback();
  const today = new Date();
  const [cursor, setCursor] = useState(today);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [prefill, setPrefill] = useState<TripPrefill | null>(null);
  const [editing, setEditing] = useState<TripInternal | null>(null);

  // O evento da agenda é um resumo; para editar, busca a viagem inteira.
  const openTrip = useMutation({
    mutationFn: (id: string) => api.get<TripInternal>(`/trips/${id}`),
    onSuccess: (trip) => {
      setSelected(null);
      setPrefill(null);
      setEditing(trip);
      setFormOpen(true);
    },
    onError: (e) => {
      notifyError(e);
    },
  });

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
          allowPastPick={role === 'admin'}
          onDayClick={(day) => {
            setEditing(null);
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
        editing={editing}
      />

      <Modal
        open={selected !== null}
        onClose={() => {
          setSelected(null);
        }}
        size="max-w-md"
        title={selected?.kind === 'trip' ? 'Detalhe do voo' : (selected?.title ?? '')}
        footer={
          selected?.kind === 'trip' &&
          can('trip:update') &&
          (role === 'admin' ||
            selected.status === null ||
            !LOCKED_TRIP_STATUSES.includes(selected.status)) && (
            <Btn
              disabled={openTrip.isPending}
              onClick={() => {
                openTrip.mutate(selected.id);
              }}
            >
              {openTrip.isPending ? <Spinner /> : <Icon name="Pencil" size={16} />} Editar viagem
            </Btn>
          )
        }
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
  const [editingRequest, setEditingRequest] = useState<FlightRequest | null>(null);

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
                              label: 'Editar',
                              icon: 'Pencil',
                              onClick: () => {
                                setEditingRequest(request);
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

      <RequestForm
        request={editingRequest}
        onClose={() => {
          setEditingRequest(null);
        }}
      />

      <Modal
        open={detail !== null}
        onClose={() => {
          setDetail(null);
        }}
        title={detail?.code ?? ''}
        desc="Solicitação de voo do cliente"
        footer={
          detail !== null && (
            <>
              <Btn
                variant="outline"
                onClick={() => {
                  setEditingRequest(detail);
                  setDetail(null);
                }}
              >
                <Icon name="Pencil" size={16} /> Editar
              </Btn>
              {detail.status !== 'convertida' && detail.status !== 'recusada' && (
                <Btn
                  onClick={() => {
                    convert(detail);
                    setDetail(null);
                  }}
                >
                  <Icon name="PlaneTakeoff" size={16} /> Agendar viagem
                </Btn>
              )}
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

/**
 * Edição de uma solicitação do cliente — trajeto, datas, passageiros e
 * observações. O status só aparece para o administrador, e `convertida` não é
 * opção: essa mudança acontece agendando a viagem.
 */
function RequestForm({
  request,
  onClose,
}: {
  request: FlightRequest | null;
  onClose: () => void;
}): JSX.Element | null {
  const queryClient = useQueryClient();
  const { notify, notifyError } = useFeedback();
  const { role } = useAuth();
  const { setErrors, setServerErrors, clearAll, errorOf } = useFormErrors();

  const [form, setForm] = useState({
    origin: '',
    destination: '',
    departureDate: '',
    departureTime: '',
    returnDate: '',
    returnTime: '',
    notes: '',
    status: 'aguardando_analise' as FlightRequestStatus,
  });
  const [pax, setPax] = useState<PassengerDraft[]>([newPassenger()]);

  const [lastId, setLastId] = useState<string | null>(null);
  if (request !== null && request.id !== lastId) {
    setLastId(request.id);
    setForm({
      origin: request.origin,
      destination: request.destination,
      departureDate: toISODate(request.departureAt),
      departureTime: new Date(request.departureAt).toTimeString().slice(0, 5),
      returnDate: toISODate(request.returnAt),
      returnTime: new Date(request.returnAt).toTimeString().slice(0, 5),
      notes: request.notes ?? '',
      status: request.status,
    });
    setPax(
      request.pax.length > 0
        ? request.pax.map((p) => ({
            key: p.id,
            name: p.name,
            documentFileId: p.documentFileId,
            uploading: false,
          }))
        : [newPassenger()],
    );
  }
  if (request === null && lastId !== null) setLastId(null);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch<FlightRequest>(`/requests/${request?.id ?? ''}`, body),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.requests });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboardOp });
      notify('success', 'Solicitação atualizada', updated.code);
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiRequestError) setServerErrors(e.details);
      notifyError(e);
    },
  });

  if (request === null) return null;

  const isAdmin = role === 'admin';
  const converted = request.status === 'convertida';

  // Mesmas regras do formulário de viagem: hora em branco = dia inteiro, data
  // da volta em branco = mesmo dia da ida.
  const departureDate = form.departureDate || form.returnDate || toISODate(new Date());
  const returnDate = form.returnDate || departureDate;
  const departureTime = form.departureTime === '' ? '00:00' : form.departureTime;
  const returnTime = form.returnTime === '' ? '23:59' : form.returnTime;
  const scheduleValid =
    new Date(combineDateTime(returnDate, returnTime)).getTime() >
    new Date(combineDateTime(departureDate, departureTime)).getTime();

  const submit = (): void => {
    const raw = {
      // String vazia vira "A definir" no contrato.
      origin: form.origin.trim(),
      destination: form.destination.trim(),
      departureAt: toIsoDateTime(departureDate, departureTime) ?? undefined,
      returnAt: toIsoDateTime(returnDate, returnTime) ?? undefined,
      notes: form.notes,
      pax: toPassengerBody(pax),
      ...(isAdmin && !converted && form.status !== 'convertida' ? { status: form.status } : {}),
    };

    const result = validateBody(updateFlightRequestBodySchema, raw);
    if (!result.ok) {
      setErrors(result.errors);
      notify('error', 'Verifique os campos destacados', Object.values(result.errors)[0]);
      return;
    }

    clearAll();
    save.mutate(raw);
  };

  const field = (key: keyof typeof form, value: string): void => {
    setForm((s) => ({ ...s, [key]: value }));
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="max-w-2xl"
      title={`Editar ${request.code}`}
      desc={`Solicitação de ${request.client?.name ?? 'cliente'}. Nenhum campo é obrigatório.`}
      footer={
        <>
          <Btn variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancelar
          </Btn>
          <Btn
            onClick={submit}
            disabled={!scheduleValid || save.isPending || pax.some((p) => p.uploading)}
          >
            {save.isPending ? <Spinner /> : <Icon name="Save" size={16} />} Salvar alterações
          </Btn>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Origem" help="Em branco, fica 'A definir'." error={errorOf('origin')}>
          <Input
            value={form.origin}
            onChange={(e) => {
              field('origin', e.target.value);
            }}
          />
        </Field>
        <Field label="Destino" help="Em branco, fica 'A definir'." error={errorOf('destination')}>
          <Input
            value={form.destination}
            onChange={(e) => {
              field('destination', e.target.value);
            }}
          />
        </Field>
        <Field label="Data da ida" help="Dia do embarque." error={errorOf('departureAt')}>
          <Input
            type="date"
            value={form.departureDate}
            onChange={(e) => {
              field('departureDate', e.target.value);
            }}
          />
        </Field>
        <Field label="Hora de ida" help="Em branco, considera o dia todo.">
          <Input
            type="time"
            value={form.departureTime}
            onChange={(e) => {
              field('departureTime', e.target.value);
            }}
          />
        </Field>
        <Field
          label="Data da volta"
          help="Em branco, o mesmo dia da ida."
          error={
            errorOf('returnAt') ??
            (scheduleValid ? undefined : 'A volta precisa ser depois da ida.')
          }
        >
          <Input
            type="date"
            value={form.returnDate}
            onChange={(e) => {
              field('returnDate', e.target.value);
            }}
          />
        </Field>
        <Field label="Hora de volta" help="Em branco, considera o dia todo.">
          <Input
            type="time"
            value={form.returnTime}
            onChange={(e) => {
              field('returnTime', e.target.value);
            }}
          />
        </Field>

        {isAdmin && (
          <Field
            label="Status"
            help={
              converted
                ? 'Já virou viagem — para mudar, edite a viagem.'
                : 'Só o administrador troca direto.'
            }
            error={errorOf('status')}
          >
            <Select
              value={form.status}
              disabled={converted}
              onChange={(e) => {
                field('status', e.target.value);
              }}
            >
              {(['aguardando_analise', 'em_analise', 'recusada'] as const).map((s) => (
                <option key={s} value={s}>
                  {REQUEST_STATUS_LABELS[s]}
                </option>
              ))}
              {converted && <option value="convertida">{REQUEST_STATUS_LABELS.convertida}</option>}
            </Select>
          </Field>
        )}

        <div className="sm:col-span-2">
          <p className="mb-1 text-sm font-semibold">Passageiros</p>
          {errorOf('pax') !== undefined && (
            <p className="mb-2 text-xs text-danger">{errorOf('pax')}</p>
          )}
          <PassengersEditor value={pax} onChange={setPax} />
        </div>

        <div className="sm:col-span-2">
          <Field label="Observações" help="Informações extras." error={errorOf('notes')}>
            <Textarea
              value={form.notes}
              onChange={(e) => {
                field('notes', e.target.value);
              }}
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
//  VIAGENS
// ============================================================================

export function OpViagens(): JSX.Element {
  const queryClient = useQueryClient();
  const { notify, notifyError, confirm } = useFeedback();
  const { role } = useAuth();
  // O administrador edita qualquer viagem; os demais, só as que não fecharam.
  const canEdit = (trip: TripInternal): boolean =>
    role === 'admin' || !LOCKED_TRIP_STATUSES.includes(trip.status);
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
                            hidden: !canEdit(trip),
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
        footer={
          detail !== null &&
          canEdit(detail) && (
            <Btn
              onClick={() => {
                setEditing(detail);
                setDetail(null);
                setFormOpen(true);
              }}
            >
              <Icon name="Pencil" size={16} /> Editar viagem
            </Btn>
          )
        }
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
              {TRIP_EXPENSE_FIELDS.map(({ key, label }) => (
                <DetailRow
                  key={key}
                  label={label}
                  value={detail[key] === null ? '—' : Money.formatBRL(detail[key])}
                />
              ))}
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
                    <TD>{item.model === '' ? '—' : item.model}</TD>
                    <TD className="text-sub">
                      {item.manufacturer === '' ? '—' : item.manufacturer}
                    </TD>
                    <TD>{item.capacity > 0 ? `${item.capacity} pax` : '—'}</TD>
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

  /** Valida com o MESMO schema Zod da rota antes de enviar. */
  const submit = (): void => {
    const raw = {
      prefix: optionalText(form.prefix)?.toUpperCase(),
      kind: form.kind,
      model: optionalText(form.model),
      manufacturer: optionalText(form.manufacturer),
      capacity: form.capacity.trim() === '' ? undefined : Number(form.capacity) || 0,
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
          <Btn onClick={submit} disabled={save.isPending}>
            {editing ? 'Salvar' : 'Cadastrar'}
          </Btn>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Prefixo"
          help="Matrícula (ex: PR-HLX). Em branco, o sistema gera uma identificação provisória."
          error={errorOf('prefix')}
        >
          <Input
            value={form.prefix}
            onChange={(e) => {
              setForm((s) => ({ ...s, prefix: e.target.value }));
            }}
            placeholder="PR-HLX"
            className="uppercase"
          />
        </Field>
        <Field label="Tipo" help="Avião ou helicóptero.">
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
        <Field label="Modelo" help="Modelo da aeronave." error={errorOf('model')}>
          <Input
            value={form.model}
            onChange={(e) => {
              setForm((s) => ({ ...s, model: e.target.value }));
            }}
            placeholder="Phenom 300E"
          />
        </Field>
        <Field label="Fabricante" help="Quem fabricou." error={errorOf('manufacturer')}>
          <Input
            value={form.manufacturer}
            onChange={(e) => {
              setForm((s) => ({ ...s, manufacturer: e.target.value }));
            }}
            placeholder="Embraer"
          />
        </Field>
        <Field label="Capacidade" help="Quantos passageiros cabem." error={errorOf('capacity')}>
          <Input
            type="number"
            min="0"
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
        <Field label="Status" help="Situação atual.">
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

  const [form, setForm] = useState({
    companyName: '',
    contactEmail: '',
    timezone: '',
    dueSoonDays: '',
    documentRetentionDays: '',
    notifyOnNewRequest: true,
    notifyExtraEmails: '',
  });
  const [loaded, setLoaded] = useState(false);

  if (!loaded && settings.data !== undefined) {
    setLoaded(true);
    setForm({
      companyName: settings.data.companyName,
      contactEmail: settings.data.contactEmail,
      timezone: settings.data.timezone,
      dueSoonDays: String(settings.data.dueSoonDays),
      documentRetentionDays: String(settings.data.documentRetentionDays),
      notifyOnNewRequest: settings.data.notifyOnNewRequest,
      notifyExtraEmails: settings.data.notifyExtraEmails ?? '',
    });
  }

  const save = useMutation({
    // Campo numérico em branco não é enviado: mantém o valor gravado.
    mutationFn: () =>
      api.patch<Settings>('/settings', {
        companyName: optionalText(form.companyName),
        contactEmail: optionalText(form.contactEmail),
        timezone: optionalText(form.timezone),
        dueSoonDays: form.dueSoonDays.trim() === '' ? undefined : Number(form.dueSoonDays),
        documentRetentionDays:
          form.documentRetentionDays.trim() === '' ? undefined : Number(form.documentRetentionDays),
        notifyOnNewRequest: form.notifyOnNewRequest,
        notifyExtraEmails: optionalText(form.notifyExtraEmails) ?? null,
      }),
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
        <Field
          label="Janela de próximos vencimentos (dias)"
          help="Quantos dias à frente o painel financeiro mostra em 'Próx. vencimentos'."
        >
          <Input
            type="number"
            min="1"
            value={form.dueSoonDays}
            onChange={(e) => {
              setForm((s) => ({ ...s, dueSoonDays: e.target.value }));
            }}
          />
        </Field>
        <Field
          label="Guardar documentos por (dias)"
          help="Depois disso a foto do documento do passageiro é apagada (LGPD)."
        >
          <Input
            type="number"
            min="1"
            value={form.documentRetentionDays}
            onChange={(e) => {
              setForm((s) => ({ ...s, documentRetentionDays: e.target.value }));
            }}
          />
        </Field>
        <Field
          label="E-mails extras para avisos"
          help="Separados por vírgula. Recebem o aviso de nova solicitação, além da equipe."
        >
          <Input
            value={form.notifyExtraEmails}
            onChange={(e) => {
              setForm((s) => ({ ...s, notifyExtraEmails: e.target.value }));
            }}
            placeholder="operacoes@empresa.com.br"
          />
        </Field>
        <div className="flex items-center justify-between rounded-lg border border-line p-3">
          <div>
            <p className="text-sm font-medium">Avisar nova solicitação por e-mail</p>
            <p className="text-xs text-sub">Quando um cliente pede um voo.</p>
          </div>
          <Toggle
            checked={form.notifyOnNewRequest}
            onChange={(v) => {
              setForm((s) => ({ ...s, notifyOnNewRequest: v }));
            }}
          />
        </div>
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
      notify('success', 'Perfil alterado', `${updated.name} agora é ${ROLE_LABELS[updated.role]}.`);
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

  // Só a aeronave é exigida: tarifa sem aeronave não tem a quem se aplicar.
  const valid = form.aircraftId !== '';

  /** Valida com o MESMO schema Zod da rota antes de enviar. */
  const submit = (): void => {
    const raw = {
      costFuel: form.costFuel === '' ? '0' : form.costFuel,
      costFlightHour: form.costFlightHour === '' ? '0' : form.costFlightHour,
      costFees: form.costFees === '' ? '0' : form.costFees,
      costPilot: form.costPilot === '' ? '0' : form.costPilot,
      unit: form.unit,
      startDate: optionalText(form.startDate),
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

        <Field label="Tipo de cobrança" help="Como é cobrado.">
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
          help="A partir de quando vale. Em branco, vale a partir de hoje."
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
