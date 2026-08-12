/**
 * Telas do Cliente — protótipo: `CliInicio`, `CliSolicitar`, `CliDisp`,
 * `CliViagens`, `CliFinanceiro`, `CliPerfil`.
 *
 * Nenhuma delas recebe aeronave, prefixo, modelo, tipo ou tarifa interna: o
 * servidor devolve um DTO reduzido (`tripClientSchema`) e a disponibilidade vem
 * mascarada por dia. Não é o front que esconde — o dado nunca sai do servidor.
 *
 * O texto sobre "aceite da viagem" que existia no protótipo foi removido: a
 * viagem nasce confirmada quando a operação agenda (decisão do Rodrigo,
 * 12/08/2026 — docs/PLANO.md §12).
 */

import {
  DAY_AVAILABILITY_LABELS,
  Money,
  createFlightRequestBodySchema,
  MONTH_LABELS,
  PAYMENT_METHOD_LABELS,
  addDays,
  addMonths,
  combineDateTime,
  formatDate,
  formatDateTime,
  monthGrid,
  sameLocalDay,
  startOfLocalDay,
  toISODate,
  type AvailabilityDay,
  type Charge,
  type ClientFinancialStatus,
  type ClientSelf,
  type DayAvailability,
  type TripClient,
} from '@acm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { JSX } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  newPassenger,
  PassengersEditor,
  toPassengerBody,
  type PassengerDraft,
} from '../components/PassengersEditor';
import {
  Badge,
  Banner,
  Btn,
  Card,
  ChargeBadge,
  Empty,
  ErrorState,
  Field,
  FinancialBadge,
  Icon,
  Input,
  Loading,
  Modal,
  PageHead,
  Spinner,
  Stat,
  Tabs,
  Textarea,
  TripBadge,
} from '../components/ui';
import { api, ApiRequestError } from '../lib/api';
import { optionalText, toIsoDateTime, useFormErrors, validateBody } from '../lib/form';
import { useFeedback } from '../lib/feedback';
import { queryKeys } from '../lib/query-keys';

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

interface ClientDashboardData {
  clientName: string;
  upcomingTrips: number;
  pendingRequests: number;
  openBalance: string;
  financialStatus: ClientFinancialStatus;
  nextTrips: TripClient[];
}

// ============================================================================
//  INÍCIO
// ============================================================================

export function CliInicio(): JSX.Element {
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: queryKeys.dashboardCli,
    queryFn: () => api.get<ClientDashboardData>('/dashboard/cliente'),
  });

  if (query.isPending) return <Loading />;
  if (query.isError) {
    return <ErrorState message="Não foi possível carregar." onRetry={() => void query.refetch()} />;
  }

  const d = query.data;
  const firstName = d.clientName.split(' ')[0] ?? 'cliente';
  const hasDebt = d.financialStatus !== 'em_dia';

  return (
    <div className="space-y-6">
      <PageHead title={`Olá, ${firstName} 👋`} desc="Bem-vindo ao seu painel de voos executivos.">
        <Btn
          onClick={() => {
            void navigate('/cliente/solicitar');
          }}
        >
          <Icon name="Send" size={16} /> Solicitar voo
        </Btn>
      </PageHead>

      {hasDebt && (
        <Banner
          tone="warning"
          icon="AlertTriangle"
          title="Você possui pagamentos pendentes"
          action={
            <Btn
              variant="outline"
              size="sm"
              onClick={() => {
                void navigate('/cliente/financeiro');
              }}
            >
              Ver financeiro
            </Btn>
          }
        >
          Regularize sua situação para agilizar novas solicitações.
        </Banner>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Próximos voos" value={d.upcomingTrips} icon="PlaneTakeoff" />
        <Stat
          label="Solicitações em análise"
          value={d.pendingRequests}
          icon="Inbox"
          tone="warning"
          hint="Aguardando a operação"
        />
        <Stat
          label="Saldo em aberto"
          value={Money.formatBRL(d.openBalance)}
          icon="Wallet"
          tone={Money.isPositive(d.openBalance) ? 'danger' : 'success'}
        />
      </div>

      <Card>
        <div className="flex items-center justify-between p-5 pb-3">
          <div>
            <h3 className="font-semibold">Seus próximos voos</h3>
            <p className="text-sm text-sub">Suas viagens agendadas</p>
          </div>
          <Btn
            variant="ghost"
            size="sm"
            onClick={() => {
              void navigate('/cliente/viagens');
            }}
          >
            Ver todas <Icon name="ArrowRight" size={16} />
          </Btn>
        </div>
        <div className="space-y-3 px-5 pb-5">
          {d.nextTrips.length === 0 ? (
            <Empty
              icon="CalendarClock"
              title="Nenhum voo agendado"
              desc="Que tal solicitar um novo voo?"
              action={
                <Btn
                  onClick={() => {
                    void navigate('/cliente/solicitar');
                  }}
                >
                  <Icon name="Send" size={16} /> Solicitar voo
                </Btn>
              }
            />
          ) : (
            d.nextTrips.map((trip) => (
              <div
                key={trip.id}
                className="flex flex-col gap-2 rounded-lg border border-line p-4 sm:flex-row sm:items-center"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon name="PlaneTakeoff" size={20} />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">
                    {trip.origin} → {trip.destination}
                  </p>
                  <p className="text-xs text-sub">
                    {formatDateTime(trip.departureAt)} · {trip.passengers} passageiro
                    {trip.passengers > 1 ? 's' : ''}
                  </p>
                </div>
                <TripBadge status={trip.status} />
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}

// ============================================================================
//  SOLICITAR VOO
// ============================================================================

export function CliSolicitar(): JSX.Element {
  const queryClient = useQueryClient();
  const { notify, notifyError } = useFeedback();
  const { setErrors, setServerErrors, clearAll, errorOf } = useFormErrors();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    origin: '',
    destination: '',
    departureDate: new URLSearchParams(window.location.search).get('data') ?? '',
    departureTime: '',
    returnDate: '',
    returnTime: '',
    notes: '',
  });
  const [pax, setPax] = useState<PassengerDraft[]>([newPassenger()]);
  const [sent, setSent] = useState(false);
  const [debtWarning, setDebtWarning] = useState(false);
  // Corpo já validado, guardado enquanto o aviso de pendência está aberto.
  const [pendingBody, setPendingBody] = useState<Record<string, unknown> | null>(null);

  const dashboard = useQuery({
    queryKey: queryKeys.dashboardCli,
    queryFn: () => api.get<ClientDashboardData>('/dashboard/cliente'),
  });

  const hasDebt = dashboard.data !== undefined && dashboard.data.financialStatus !== 'em_dia';

  const set = (key: keyof typeof form, value: string): void => {
    setForm((s) => ({ ...s, [key]: value }));
  };

  const departureAt = combineDateTime(form.departureDate, form.departureTime);
  const returnAt = combineDateTime(form.returnDate, form.returnTime);

  const routeOk =
    form.origin.trim() !== '' &&
    form.destination.trim() !== '' &&
    form.departureDate !== '' &&
    form.departureTime !== '' &&
    form.returnDate !== '' &&
    form.returnTime !== '';

  // Documento é OBRIGATÓRIO quando quem solicita é o cliente.
  const paxOk =
    pax.length > 0 &&
    pax.every((p) => p.name.trim().length >= 2 && p.documentFileId !== null && !p.uploading);

  const submit = useMutation({
    // Corpo já validado pelo contrato — ver `attempt` abaixo.
    mutationFn: (body: Record<string, unknown>) => api.post('/requests', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.requests });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboardCli });
      setDebtWarning(false);
      setSent(true);
    },
    onError: (e) => {
      setDebtWarning(false);
      if (e instanceof ApiRequestError) setServerErrors(e.details);
      notifyError(e);
    },
  });

  /**
   * Monta e valida o corpo com o MESMO schema Zod da rota.
   *
   * `null` significa reprovado — os erros já estão em `errors`, por campo.
   */
  const buildBody = (): Record<string, unknown> | null => {
    const departureIso = toIsoDateTime(form.departureDate, form.departureTime);
    const returnIso = toIsoDateTime(form.returnDate, form.returnTime);

    if (departureIso === null || returnIso === null) {
      setErrors({ departureAt: 'Informe as datas e horários de ida e volta.' });
      return null;
    }

    const raw = {
      origin: form.origin.trim(),
      destination: form.destination.trim(),
      departureAt: departureIso,
      returnAt: returnIso,
      notes: optionalText(form.notes),
      pax: toPassengerBody(pax),
    };

    const result = validateBody(createFlightRequestBodySchema, raw);
    if (!result.ok) {
      setErrors(result.errors);
      notify('error', 'Verifique os campos destacados', Object.values(result.errors)[0]);
      return null;
    }

    clearAll();
    return raw;
  };

  const attempt = (): void => {
    if (!routeOk) {
      notify('error', 'Preencha os campos', 'Informe origem, destino e as datas de ida e volta.');
      return;
    }
    if (form.departureDate < toISODate(new Date())) {
      notify('error', 'Data no passado', 'A data de embarque não pode ser anterior a hoje.');
      return;
    }
    if (new Date(returnAt).getTime() <= new Date(departureAt).getTime()) {
      notify('error', 'Datas inválidas', 'A volta precisa ser depois da ida.');
      return;
    }
    if (!paxOk) {
      notify(
        'error',
        'Complete os passageiros',
        'Informe o nome e envie a foto do documento de cada passageiro.',
      );
      return;
    }
    const body = buildBody();
    if (body === null) return;

    if (hasDebt) {
      setPendingBody(body);
      setDebtWarning(true);
      return;
    }

    submit.mutate(body);
  };

  if (sent) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card className="text-center">
          <div className="flex flex-col items-center py-12">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success-soft text-success">
              <Icon name="CheckCircle2" size={32} />
            </div>
            <h2 className="mt-5 text-xl font-semibold">Solicitação enviada com sucesso</h2>
            <p className="mt-2 max-w-sm text-sm text-sub">
              Recebemos o seu pedido e os documentos dos passageiros. Nossa equipe irá analisar a
              disponibilidade e retornar em breve.
            </p>
            <div className="mt-4">
              <Badge tone="warning" dot>
                Aguardando análise
              </Badge>
            </div>
            <div className="mt-6 flex gap-2">
              <Btn
                variant="outline"
                onClick={() => {
                  setForm({
                    origin: '',
                    destination: '',
                    departureDate: '',
                    departureTime: '',
                    returnDate: '',
                    returnTime: '',
                    notes: '',
                  });
                  setPax([newPassenger()]);
                  setSent(false);
                }}
              >
                Nova solicitação
              </Btn>
              <Btn
                onClick={() => {
                  void navigate('/cliente');
                }}
              >
                Voltar ao início
              </Btn>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const today = toISODate(new Date());

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHead title="Solicitar voo" desc="Preencha os dados da sua viagem. É rápido e simples." />

      <Card className="p-5">
        <h3 className="flex items-center gap-2 font-semibold">
          <Icon name="Plane" size={16} className="text-primary" /> Detalhes da viagem
        </h3>
        <p className="text-sm text-sub">A nossa equipe escolhe a melhor aeronave para você.</p>

        <div className="mt-6 space-y-6">
          <div>
            <p className="mb-3 text-sm font-semibold">Ida</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Origem"
                required
                help="De onde você quer partir."
                error={errorOf('origin')}
              >
                <Input
                  value={form.origin}
                  onChange={(e) => {
                    set('origin', e.target.value);
                  }}
                  placeholder="Ex: São Paulo (CGH)"
                />
              </Field>
              <Field
                label="Destino"
                required
                help="Para onde você quer ir."
                error={errorOf('destination')}
              >
                <Input
                  value={form.destination}
                  onChange={(e) => {
                    set('destination', e.target.value);
                  }}
                  placeholder="Ex: Rio de Janeiro (SDU)"
                />
              </Field>
              <Field
                label="Data do embarque"
                required
                help="Dia da ida."
                error={errorOf('departureAt')}
              >
                <Input
                  type="date"
                  min={today}
                  value={form.departureDate}
                  onChange={(e) => {
                    set('departureDate', e.target.value);
                  }}
                />
              </Field>
              <Field label="Hora do embarque" required help="Horário da ida.">
                <Input
                  type="time"
                  value={form.departureTime}
                  onChange={(e) => {
                    set('departureTime', e.target.value);
                  }}
                />
              </Field>
            </div>
          </div>

          <div>
            <p className="mb-3 text-sm font-semibold">Volta</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Data da volta"
                required
                help="Dia do retorno."
                error={errorOf('returnAt')}
              >
                <Input
                  type="date"
                  min={form.departureDate === '' ? today : form.departureDate}
                  value={form.returnDate}
                  onChange={(e) => {
                    set('returnDate', e.target.value);
                  }}
                />
              </Field>
              <Field label="Hora da volta" required help="Horário do retorno.">
                <Input
                  type="time"
                  value={form.returnTime}
                  onChange={(e) => {
                    set('returnTime', e.target.value);
                  }}
                />
              </Field>
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-sm font-semibold">Passageiros</p>
              <span className="text-xs text-sub">
                {pax.length} passageiro{pax.length > 1 ? 's' : ''}
              </span>
            </div>
            <p className="mb-3 text-xs text-sub">
              Informe o nome completo e a foto do documento com foto de cada passageiro (RG, CNH ou
              passaporte).
            </p>
            <PassengersEditor value={pax} onChange={setPax} requireDocument />
          </div>

          <Field label="Observações" help="Alguma preferência ou informação importante?">
            <Textarea
              value={form.notes}
              onChange={(e) => {
                set('notes', e.target.value);
              }}
              placeholder="Ex: preciso retornar no mesmo dia..."
            />
          </Field>

          <div className="flex items-center gap-2 rounded-lg bg-primary-soft/60 p-3 text-xs text-primary-dark">
            <Icon name="Info" size={16} /> Você não escolhe a aeronave — nossa equipe seleciona a
            melhor opção e confirma a sua viagem.
          </div>

          <Btn size="lg" className="w-full" onClick={attempt} disabled={submit.isPending}>
            {submit.isPending ? <Spinner /> : <Icon name="Send" size={16} />} Solicitar voo
          </Btn>
        </div>
      </Card>

      <Modal
        open={debtWarning}
        onClose={() => {
          setDebtWarning(false);
        }}
        size="max-w-md"
        footer={
          <>
            <Btn
              variant="outline"
              onClick={() => {
                setDebtWarning(false);
              }}
            >
              Voltar
            </Btn>
            <Btn
              onClick={() => {
                if (pendingBody !== null) submit.mutate(pendingBody);
              }}
              disabled={submit.isPending}
            >
              Continuar mesmo assim
            </Btn>
          </>
        }
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning">
            <Icon name="AlertTriangle" size={20} />
          </div>
          <div>
            <h3 className="text-lg font-semibold">Atenção</h3>
            <p className="mt-1.5 text-sm text-sub">
              Existem pagamentos pendentes em sua conta. Sua solicitação poderá depender da
              regularização financeira.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ============================================================================
//  DISPONIBILIDADE (mascarada)
// ============================================================================

export function CliDisponibilidade(): JSX.Element {
  const navigate = useNavigate();
  const today = new Date();
  const [cursor, setCursor] = useState(today);

  const from = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const to = addDays(addMonths(from, 1), 6);

  const days = useQuery({
    queryKey: queryKeys.availabilityDays(from.toISOString(), to.toISOString()),
    queryFn: () =>
      api.get<{ days: AvailabilityDay[] }>('/availability/days', {
        from: from.toISOString(),
        to: to.toISOString(),
      }),
  });

  const byDate = new Map((days.data?.days ?? []).map((d) => [d.date, d.status]));
  const todayStart = startOfLocalDay(today);

  const statusCls: Record<DayAvailability, string> = {
    disponivel: 'bg-success-soft text-success border-success/20',
    ocupado: 'bg-warning-soft text-[#9A6A10] border-warning/25',
    indisponivel: 'bg-slate-100 text-slate-500 border-slate-200',
  };

  return (
    <div className="space-y-6">
      <PageHead title="Disponibilidade" desc="Veja os melhores dias para solicitar o seu voo.">
        <Btn
          onClick={() => {
            void navigate('/cliente/solicitar');
          }}
        >
          Solicitar voo
        </Btn>
      </PageHead>

      <div className="flex items-center gap-2 rounded-lg border border-line bg-primary-soft/60 px-3 py-2 text-xs text-primary-dark">
        <Icon name="Info" size={14} /> Clique em um dia <strong>disponível</strong> para solicitar
        um voo já com a data de embarque preenchida.
      </div>

      <Card>
        <div className="flex items-center gap-2 border-b border-line p-4">
          <Btn
            variant="outline"
            size="icon"
            aria-label="Mês anterior"
            onClick={() => {
              setCursor((c) => addMonths(c, -1));
            }}
          >
            <Icon name="ChevronLeft" size={16} />
          </Btn>
          <Btn
            variant="outline"
            size="icon"
            aria-label="Próximo mês"
            onClick={() => {
              setCursor((c) => addMonths(c, 1));
            }}
          >
            <Icon name="ChevronRight" size={16} />
          </Btn>
          <Btn
            variant="ghost"
            size="sm"
            onClick={() => {
              setCursor(today);
            }}
          >
            Hoje
          </Btn>
          <span className="ml-2 text-sm font-semibold capitalize">
            {MONTH_LABELS[cursor.getMonth()]} de {cursor.getFullYear()}
          </span>
        </div>

        {days.isPending ? (
          <Loading />
        ) : (
          <div className="p-4">
            <div className="grid grid-cols-7 gap-1.5">
              {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((label) => (
                <div
                  key={label}
                  className="py-1 text-center text-xs font-semibold uppercase text-sub"
                >
                  {label}
                </div>
              ))}
              {monthGrid(cursor).map((day) => {
                const iso = toISODate(day);
                const status = byDate.get(iso) ?? 'indisponivel';
                const inMonth = day.getMonth() === cursor.getMonth();
                const isToday = sameLocalDay(day, today);
                const isPast = startOfLocalDay(day).getTime() < todayStart.getTime();
                const clickable = inMonth && !isPast && status === 'disponivel';

                return (
                  <div
                    key={iso}
                    onClick={() => {
                      if (clickable) void navigate(`/cliente/solicitar?data=${iso}`);
                    }}
                    title={clickable ? 'Solicitar voo nesta data' : undefined}
                    className={`group relative flex min-h-[70px] flex-col rounded-lg border p-2 ${
                      inMonth ? statusCls[status] : 'border-transparent bg-soft/20 opacity-40'
                    } ${isPast && inMonth ? 'opacity-45' : ''} ${
                      clickable
                        ? 'cursor-pointer ring-offset-1 transition-shadow hover:ring-2 hover:ring-success/50'
                        : ''
                    }`}
                  >
                    <span
                      className={`text-xs font-semibold ${
                        isToday
                          ? 'flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white'
                          : ''
                      }`}
                    >
                      {day.getDate()}
                    </span>
                    {inMonth && (
                      <span className="mt-auto text-[10px] font-medium">
                        {isPast ? '—' : DAY_AVAILABILITY_LABELS[status]}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4 border-t border-line p-4 text-xs text-sub">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-success" />
            Disponível
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-warning" />
            Ocupado
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
            Indisponível
          </span>
        </div>
      </Card>
    </div>
  );
}

// ============================================================================
//  MINHAS VIAGENS
// ============================================================================

export function CliViagens(): JSX.Element {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'prox' | 'hist'>('prox');

  const trips = useQuery({
    queryKey: queryKeys.tripList({ own: true }),
    queryFn: () => api.get<Page<TripClient>>('/trips', { limit: 100 }),
  });

  if (trips.isPending) return <Loading />;
  if (trips.isError) {
    return <ErrorState message="Não foi possível carregar." onRetry={() => void trips.refetch()} />;
  }

  const now = Date.now();
  const all = trips.data.items;
  const upcoming = all.filter(
    (t) =>
      new Date(t.departureAt).getTime() >= now &&
      t.status !== 'recusada' &&
      t.status !== 'cancelada',
  );
  const past = all.filter(
    (t) => new Date(t.departureAt).getTime() < now || t.status === 'concluida',
  );
  const list = tab === 'prox' ? upcoming : past;

  return (
    <div className="space-y-6">
      <PageHead title="Minhas viagens" desc="Acompanhe as suas viagens agendadas.">
        <Btn
          onClick={() => {
            void navigate('/cliente/solicitar');
          }}
        >
          <Icon name="Send" size={16} /> Solicitar voo
        </Btn>
      </PageHead>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'prox', label: `Próximas (${upcoming.length})` },
          { key: 'hist', label: `Histórico (${past.length})` },
        ]}
      />

      {list.length === 0 ? (
        <Card>
          <Empty
            icon="PlaneTakeoff"
            title={tab === 'prox' ? 'Nenhuma viagem futura' : 'Sem histórico'}
            desc={tab === 'prox' ? 'Solicite um voo para começar.' : undefined}
          />
        </Card>
      ) : (
        <div className="grid gap-3">
          {list.map((trip) => (
            <Card key={trip.id}>
              <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon name="PlaneTakeoff" size={20} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">
                      {trip.origin} → {trip.destination}
                    </p>
                    <span className="text-xs text-sub">{trip.code}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-sub">
                    <span className="inline-flex items-center gap-1">
                      <Icon name="Calendar" size={14} /> Ida {formatDateTime(trip.departureAt)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Icon name="Calendar" size={14} /> Volta {formatDateTime(trip.returnAt)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Icon name="Users" size={14} /> {trip.passengers} pax
                    </span>
                  </div>
                </div>
                <TripBadge status={trip.status} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
//  FINANCEIRO DO CLIENTE
// ============================================================================

export function CliFinanceiro(): JSX.Element {
  const charges = useQuery({
    queryKey: queryKeys.chargeList({ own: true }),
    queryFn: () => api.get<Page<Charge>>('/charges', { limit: 100 }),
  });

  if (charges.isPending) return <Loading />;
  if (charges.isError) {
    return (
      <ErrorState message="Não foi possível carregar." onRetry={() => void charges.refetch()} />
    );
  }

  const items = charges.data.items;
  const balance = items.reduce<string>((sum, c) => Money.add(sum, c.balance), Money.ZERO);
  const totalPaid = items.reduce<string>((sum, c) => Money.add(sum, c.paidAmount), Money.ZERO);
  const overdue = items
    .filter((c) => c.status === 'vencido')
    .reduce<string>((sum, c) => Money.add(sum, c.balance), Money.ZERO);

  return (
    <div className="space-y-6">
      <PageHead title="Financeiro" desc="Acompanhe seus pagamentos e valores em aberto." />

      {Money.isPositive(balance) && (
        <Banner
          tone="warning"
          icon="AlertTriangle"
          title={`Você tem ${Money.formatBRL(balance)} em aberto`}
        >
          Mantenha os pagamentos em dia para agilizar novas viagens.
        </Banner>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Saldo em aberto"
          value={Money.formatBRL(balance)}
          icon="Wallet"
          tone={Money.isPositive(balance) ? 'warning' : 'success'}
        />
        <Stat
          label="Total pago"
          value={Money.formatBRL(totalPaid)}
          icon="CheckCircle2"
          tone="success"
        />
        <Stat
          label="Em atraso"
          value={Money.formatBRL(overdue)}
          icon="ReceiptText"
          tone={Money.isPositive(overdue) ? 'danger' : 'primary'}
        />
      </div>

      <Card>
        <div className="p-5 pb-3">
          <h3 className="font-semibold">Suas cobranças</h3>
          <p className="text-sm text-sub">Detalhes de cada valor e seu status</p>
        </div>
        <div className="space-y-3 px-5 pb-5">
          {items.length === 0 ? (
            <Empty icon="Wallet" title="Nenhuma cobrança" />
          ) : (
            items.map((charge) => (
              <div key={charge.id} className="rounded-lg border border-line p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{charge.code}</p>
                    {charge.trip !== null && (
                      <p className="text-xs text-sub">
                        {charge.trip.origin} → {charge.trip.destination}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-sub">
                      Vencimento {formatDate(charge.dueDate)}
                    </p>
                  </div>
                  <ChargeBadge status={charge.status} />
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-soft/60 p-3 text-center text-sm">
                  <div>
                    <p className="text-xs text-sub">Total</p>
                    <p className="font-semibold">{Money.formatBRL(charge.total)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-sub">Pago</p>
                    <p className="font-semibold text-success">
                      {Money.formatBRL(charge.paidAmount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-sub">Saldo</p>
                    <p className="font-semibold">{Money.formatBRL(charge.balance)}</p>
                  </div>
                </div>

                {charge.payments.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-1.5 text-xs font-medium text-sub">Pagamentos realizados</p>
                    <div className="flex flex-wrap gap-2">
                      {charge.payments.map((payment) => (
                        <Badge key={payment.id} tone="neutral">
                          {formatDate(payment.paidAt)} · {Money.formatBRL(payment.amount)} ·{' '}
                          {PAYMENT_METHOD_LABELS[payment.method]}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}

// ============================================================================
//  MEU PERFIL
// ============================================================================

export function CliPerfil(): JSX.Element {
  const queryClient = useQueryClient();
  const { notify, notifyError } = useFeedback();

  const profile = useQuery({
    queryKey: queryKeys.clientMe,
    queryFn: () => api.get<ClientSelf>('/clients/me'),
  });

  const [form, setForm] = useState({ name: '', company: '', email: '', phone: '', document: '' });
  const [loaded, setLoaded] = useState(false);

  if (!loaded && profile.data !== undefined) {
    setLoaded(true);
    setForm({
      name: profile.data.name,
      company: profile.data.company ?? '',
      email: profile.data.email,
      phone: profile.data.phone ?? '',
      document: profile.data.document ?? '',
    });
  }

  const save = useMutation({
    mutationFn: () =>
      api.patch<ClientSelf>('/clients/me', {
        name: form.name.trim(),
        company: form.company.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        document: form.document.trim(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.clientMe });
      notify('success', 'Perfil atualizado', 'Seus dados foram salvos.');
    },
    onError: (e) => {
      notifyError(e);
    },
  });

  if (profile.isPending) return <Loading />;
  if (profile.isError) {
    return <ErrorState message="Não foi possível carregar o perfil." />;
  }

  const client = profile.data;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHead title="Meu perfil" desc="Seus dados de cadastro e informações da conta." />

      <Card className="flex flex-col items-center gap-4 p-6 sm:flex-row">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">
          {client.name
            .split(' ')
            .filter(Boolean)
            .slice(0, 2)
            .map((p) => p.charAt(0))
            .join('')
            .toUpperCase()}
        </div>
        <div className="text-center sm:text-left">
          <h2 className="text-lg font-semibold">{client.name}</h2>
          <p className="text-sm text-sub">{client.company ?? 'Cliente pessoa física'}</p>
        </div>
        <div className="flex gap-6 sm:ml-auto">
          <div className="text-center">
            <p className="text-2xl font-semibold">{client.tripCount}</p>
            <p className="text-xs text-sub">Viagens</p>
          </div>
          <div className="text-center">
            <p className="mb-1 text-xs text-sub">Situação</p>
            <FinancialBadge status={client.financialStatus} />
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="font-semibold">Dados de contato</h3>
        <p className="text-sm text-sub">Mantenha suas informações atualizadas.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Nome" help="Seu nome completo.">
            <Input
              value={form.name}
              onChange={(e) => {
                setForm((s) => ({ ...s, name: e.target.value }));
              }}
            />
          </Field>
          <Field label="Empresa" help="Sua empresa (opcional).">
            <Input
              value={form.company}
              onChange={(e) => {
                setForm((s) => ({ ...s, company: e.target.value }));
              }}
            />
          </Field>
          <Field label="E-mail" help="Seu e-mail de contato.">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => {
                setForm((s) => ({ ...s, email: e.target.value }));
              }}
            />
          </Field>
          <Field label="Telefone" help="Com DDD.">
            <Input
              value={form.phone}
              onChange={(e) => {
                setForm((s) => ({ ...s, phone: e.target.value }));
              }}
            />
          </Field>
          <Field label="Documento" help="CPF ou CNPJ.">
            <Input
              value={form.document}
              onChange={(e) => {
                setForm((s) => ({ ...s, document: e.target.value }));
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
          <Icon name="Save" size={16} /> Salvar alterações
        </Btn>
      </Card>
    </div>
  );
}
