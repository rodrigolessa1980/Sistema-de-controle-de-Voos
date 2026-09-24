/**
 * Telas do Financeiro — protótipo: `FinDashboard`, `FinFinanceiro`,
 * `FinCobrancas`, `FinPagamentos`, `FinRelatorios`.
 *
 * Todos os números vêm agregados do servidor. O protótipo somava em JavaScript
 * o array inteiro de cobranças e pagamentos a cada renderização.
 */

import {
  CHARGE_STATUS_LABELS,
  CHARGE_STATUSES,
  Money,
  createChargeBodySchema,
  createPaymentBodySchema,
  MONTH_ABBR,
  MONTH_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  formatDate,
  toISODate,
  TRIP_EXPENSE_FIELDS,
  updateChargeBodySchema,
  updatePaymentBodySchema,
  type Charge,
  type ChargeStatus,
  type Client,
  type FinancialDashboard,
  type FinancialReport,
  type PaymentHistoryItem,
  type TripInternal,
} from '@acm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { JSX } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  Badge,
  Btn,
  Card,
  ChargeBadge,
  Empty,
  ErrorState,
  Field,
  Icon,
  Input,
  Loading,
  Menu,
  Modal,
  PageHead,
  SearchBox,
  Select,
  Stat,
  TD,
  TH,
  Textarea,
} from '../components/ui';
import { api, ApiRequestError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { optionalText, useFormErrors, validateBody } from '../lib/form';
import { useFeedback } from '../lib/feedback';
import { queryKeys } from '../lib/query-keys';

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

// ============================================================================
//  DASHBOARD
// ============================================================================

type FinancialDashboardData = FinancialDashboard;

/** "AAAA-MM" do mês corrente, no fuso local. */
function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** "AAAA-MM" → [ano, mês 1–12]. */
function parseMonthKey(key: string): [number, number] {
  const [year = '', month = ''] = key.split('-');
  return [Number(year), Number(month)];
}

/** Desloca um "AAAA-MM" em `delta` meses. */
function shiftMonthKey(key: string, delta: number): string {
  const [year, month] = parseMonthKey(key);
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** "setembro de 2026". */
function monthKeyLabel(key: string): string {
  const [year, month] = parseMonthKey(key);
  return `${MONTH_LABELS[month - 1] ?? ''} de ${String(year)}`;
}

/** Filtro de mês: anterior / seletor / próximo / volta ao mês atual. */
function MonthFilter({
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

export function FinDashboard(): JSX.Element {
  const navigate = useNavigate();
  const [month, setMonth] = useState(currentMonthKey);
  const query = useQuery({
    queryKey: [...queryKeys.dashboardFin, month],
    queryFn: () => api.get<FinancialDashboardData>('/dashboard/financeiro', { month }),
    // Mantém o mês anterior na tela enquanto o novo carrega, sem piscar o loading.
    placeholderData: (previous) => previous,
  });

  const head = (
    <PageHead
      title="Dashboard financeiro"
      desc={`Resumo de recebíveis e situação das cobranças · ${monthKeyLabel(month)}.`}
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
        <ErrorState message="Não foi possível carregar." onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const d = query.data;
  const isCurrentMonth = month === currentMonthKey();

  return (
    <div className={`space-y-6 transition-opacity ${query.isPlaceholderData ? 'opacity-60' : ''}`}>
      {head}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Total a receber"
          value={Money.formatBRL(d.totalReceivable)}
          icon="Wallet"
          hint="Saldo em aberto"
        />
        <Stat
          label="Recebido no mês"
          value={Money.formatBRL(d.receivedThisMonth)}
          icon="TrendingUp"
          tone="success"
          hint="Pagamentos do mês selecionado"
        />
        <Stat
          label="A receber no mês"
          value={Money.formatBRL(d.receivableInMonth)}
          icon="CalendarClock"
          tone="warning"
          hint="Saldo com vencimento no mês"
        />
        <Stat
          label="Em atraso"
          value={Money.formatBRL(d.overdueAmount)}
          icon="AlertTriangle"
          tone="danger"
          hint="Vencido e não pago (hoje)"
        />
      </div>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-2 p-5 pb-3">
          <div>
            <h3 className="font-semibold">Custos das viagens</h3>
            <p className="text-sm text-sub">
              Lançados no cadastro de cada viagem ·{' '}
              {isCurrentMonth ? 'mês atual' : monthKeyLabel(month)} (pela data de ida)
            </p>
          </div>
          <div className="text-right">
            <p className="text-xl font-semibold">{Money.formatBRL(d.tripExpenses.month.total)}</p>
            <p className="text-xs text-sub">
              {d.tripExpenses.month.tripCount} viage
              {d.tripExpenses.month.tripCount === 1 ? 'm' : 'ns'} no mês · total geral{' '}
              {Money.formatBRL(d.tripExpenses.allTime.total)}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 px-5 pb-4 sm:grid-cols-3 lg:grid-cols-5">
          {TRIP_EXPENSE_FIELDS.map(({ key, label }) => (
            <div key={key} className="rounded-lg border border-line p-3">
              <p className="text-xs text-sub">{label}</p>
              <p className="mt-0.5 text-sm font-semibold">
                {Money.formatBRL(d.tripExpenses.month.byField[key])}
              </p>
            </div>
          ))}
        </div>
        {d.tripExpenses.recent.length > 0 && (
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  <TH>Viagem</TH>
                  <TH>Cliente</TH>
                  <TH>Data da ida</TH>
                  <TH>Custo total</TH>
                </tr>
              </thead>
              <tbody>
                {d.tripExpenses.recent.map((trip) => (
                  <tr key={trip.id} className="border-b border-line last:border-0">
                    <TD className="text-sub">{trip.code}</TD>
                    <TD className="whitespace-nowrap font-medium">{trip.clientName}</TD>
                    <TD className="whitespace-nowrap">{formatDate(trip.departureAt)}</TD>
                    <TD className="font-medium">{Money.formatBRL(trip.total)}</TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between p-5 pb-3">
            <div>
              <h3 className="font-semibold">Cobranças em aberto</h3>
              <p className="text-sm text-sub">Com vencimento no mês · ordenadas por vencimento</p>
            </div>
            <Btn
              variant="ghost"
              size="sm"
              onClick={() => {
                void navigate('/financeiro/recebiveis');
              }}
            >
              Ver tudo <Icon name="ArrowRight" size={16} />
            </Btn>
          </div>
          {d.openCharges.length === 0 ? (
            <Empty icon="Banknote" title="Nada em aberto neste mês" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <TH>Cliente</TH>
                    <TH>Cobrança</TH>
                    <TH>Saldo</TH>
                    <TH>Vencimento</TH>
                    <TH>Status</TH>
                  </tr>
                </thead>
                <tbody>
                  {d.openCharges.map((charge) => (
                    <tr key={charge.id} className="border-b border-line last:border-0">
                      <TD className="whitespace-nowrap font-medium">{charge.clientName}</TD>
                      <TD className="text-sub">{charge.code}</TD>
                      <TD className="font-medium">{Money.formatBRL(charge.balance)}</TD>
                      <TD className="whitespace-nowrap">{formatDate(charge.dueDate)}</TD>
                      <TD>
                        <ChargeBadge status={charge.status} />
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
            <h3 className="font-semibold">Próximos vencimentos</h3>
            <p className="text-sm text-sub">
              {d.dueSoonCount} nos próximos {d.dueSoonDays} dias (a partir de hoje)
            </p>
          </div>
          <div className="space-y-2 px-5 pb-5">
            {d.dueSoon.length === 0 ? (
              <Empty icon="CalendarClock" title="Sem vencimentos" />
            ) : (
              d.dueSoon.map((charge) => (
                <div
                  key={charge.id}
                  className="flex items-center justify-between rounded-lg border border-line p-3"
                >
                  <div>
                    <p className="text-sm font-medium">{charge.clientName}</p>
                    <p className="text-xs text-sub">Vence {formatDate(charge.dueDate)}</p>
                  </div>
                  <p className="text-sm font-semibold">{Money.formatBRL(charge.balance)}</p>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ============================================================================
//  RECEBÍVEIS
// ============================================================================

export function FinRecebiveis(): JSX.Element {
  const { confirm, notify, notifyError } = useFeedback();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | ChargeStatus>('all');
  const [payFor, setPayFor] = useState<Charge | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Charge | null>(null);

  const charges = useQuery({
    queryKey: queryKeys.chargeList({ q: search, status }),
    queryFn: () =>
      api.get<Page<Charge>>('/charges', {
        q: search,
        limit: 50,
        ...(status === 'all' ? {} : { status }),
      }),
  });

  const dashboard = useQuery({
    queryKey: queryKeys.dashboardFin,
    queryFn: () => api.get<FinancialDashboardData>('/dashboard/financeiro'),
  });

  const settle = useMutation({
    mutationFn: (charge: Charge) =>
      api.post(`/charges/${charge.id}/settle`, {
        paidAt: toISODate(new Date()),
        method: 'transferencia',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.charges });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboardFin });
      notify('success', 'Baixa registrada', 'Cobrança quitada.');
    },
    onError: (e) => {
      notifyError(e);
    },
  });

  return (
    <div className="space-y-6">
      <PageHead title="Financeiro" desc="Recebíveis, saldos e status de cada cobrança.">
        {can('charge:create') && (
          <Btn
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Icon name="Plus" size={16} /> Nova cobrança
          </Btn>
        )}
      </PageHead>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Total a receber"
          value={Money.formatBRL(dashboard.data?.totalReceivable ?? '0')}
          icon="Wallet"
        />
        <Stat
          label="Recebido no mês"
          value={Money.formatBRL(dashboard.data?.receivedThisMonth ?? '0')}
          icon="CheckCircle2"
          tone="success"
        />
        <Stat
          label="Em atraso"
          value={Money.formatBRL(dashboard.data?.overdueAmount ?? '0')}
          icon="ReceiptText"
          tone="danger"
        />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Buscar por cliente ou código"
          />
          <div className="sm:ml-auto sm:w-48">
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as 'all' | ChargeStatus);
              }}
            >
              <option value="all">Todos os status</option>
              {CHARGE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {CHARGE_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {charges.isPending ? (
          <Loading />
        ) : charges.isError ? (
          <ErrorState message="Não foi possível carregar." onRetry={() => void charges.refetch()} />
        ) : charges.data.items.length === 0 ? (
          <Empty icon="Wallet" title="Nenhuma cobrança" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  <TH>Cliente</TH>
                  <TH>Viagem</TH>
                  <TH>Valor</TH>
                  <TH>Pago</TH>
                  <TH>Saldo</TH>
                  <TH>Vencimento</TH>
                  <TH>Status</TH>
                  <TH />
                </tr>
              </thead>
              <tbody>
                {charges.data.items.map((charge) => {
                  const open = Money.isPositive(charge.balance);
                  return (
                    <tr key={charge.id} className="border-b border-line last:border-0">
                      <TD className="whitespace-nowrap font-medium">
                        {charge.client?.name ?? '—'}
                      </TD>
                      <TD className="text-sub">{charge.trip?.code ?? '—'}</TD>
                      <TD>{Money.formatBRL(charge.total)}</TD>
                      <TD className="text-success">{Money.formatBRL(charge.paidAmount)}</TD>
                      <TD className="font-medium">{Money.formatBRL(charge.balance)}</TD>
                      <TD className="whitespace-nowrap">{formatDate(charge.dueDate)}</TD>
                      <TD>
                        <ChargeBadge status={charge.status} />
                      </TD>
                      <TD>
                        <Menu
                          items={[
                            {
                              label: 'Editar cobrança',
                              icon: 'Pencil',
                              hidden: !can('charge:update'),
                              onClick: () => {
                                setEditing(charge);
                                setFormOpen(true);
                              },
                            },
                            {
                              label: 'Registrar pagamento',
                              icon: 'Banknote',
                              hidden: !open,
                              onClick: () => {
                                setPayFor(charge);
                              },
                            },
                            {
                              label: 'Dar baixa (quitar)',
                              icon: 'CheckCircle2',
                              hidden: !open,
                              onClick: () => {
                                confirm({
                                  title: 'Dar baixa na cobrança?',
                                  desc: `${charge.code} será quitada por completo (${Money.formatBRL(charge.balance)}).`,
                                  confirmLabel: 'Confirmar baixa',
                                  onConfirm: () => {
                                    settle.mutate(charge);
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

      <ChargeForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
        }}
        editing={editing}
      />
      <PaymentForm
        charge={payFor}
        onClose={() => {
          setPayFor(null);
        }}
      />
    </div>
  );
}

// ============================================================================
//  COBRANÇAS
// ============================================================================

export function FinCobrancas(): JSX.Element {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Charge | null>(null);
  const [payFor, setPayFor] = useState<Charge | null>(null);

  const charges = useQuery({
    queryKey: queryKeys.chargeList({ q: search, view: 'cobrancas' }),
    queryFn: () => api.get<Page<Charge>>('/charges', { q: search, limit: 50 }),
  });

  return (
    <div className="space-y-6">
      <PageHead title="Cobranças" desc="Crie e acompanhe as cobranças emitidas.">
        <Btn
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Icon name="Plus" size={16} /> Nova cobrança
        </Btn>
      </PageHead>

      <Card>
        <div className="border-b border-line p-4">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Buscar por cliente ou código"
          />
        </div>

        {charges.isPending ? (
          <Loading />
        ) : (charges.data?.items ?? []).length === 0 ? (
          <Empty icon="ReceiptText" title="Nenhuma cobrança" desc="Crie a primeira cobrança." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  <TH>Código</TH>
                  <TH>Cliente</TH>
                  <TH>Viagem</TH>
                  <TH>Valor</TH>
                  <TH>Saldo</TH>
                  <TH>Vencimento</TH>
                  <TH>Status</TH>
                  <TH />
                </tr>
              </thead>
              <tbody>
                {(charges.data?.items ?? []).map((charge) => (
                  <tr key={charge.id} className="border-b border-line last:border-0">
                    <TD className="font-medium">{charge.code}</TD>
                    <TD className="whitespace-nowrap">{charge.client?.name ?? '—'}</TD>
                    <TD className="text-sub">{charge.trip?.code ?? '—'}</TD>
                    <TD>{Money.formatBRL(charge.total)}</TD>
                    <TD className="font-medium">{Money.formatBRL(charge.balance)}</TD>
                    <TD className="whitespace-nowrap">{formatDate(charge.dueDate)}</TD>
                    <TD>
                      <ChargeBadge status={charge.status} />
                    </TD>
                    <TD>
                      <Menu
                        items={[
                          {
                            label: 'Editar cobrança',
                            icon: 'Pencil',
                            hidden: !can('charge:update'),
                            onClick: () => {
                              setEditing(charge);
                              setFormOpen(true);
                            },
                          },
                          {
                            label: 'Registrar pagamento',
                            icon: 'Banknote',
                            hidden: !Money.isPositive(charge.balance),
                            onClick: () => {
                              setPayFor(charge);
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

      <ChargeForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
        }}
        editing={editing}
      />
      <PaymentForm
        charge={payFor}
        onClose={() => {
          setPayFor(null);
        }}
      />
    </div>
  );
}

/**
 * Criar ou editar cobrança. Nenhum campo é obrigatório: sem cliente, vale o da
 * viagem (ou "Cliente a definir"); sem valor, R$ 0; sem vencimento, hoje.
 */
function ChargeForm({
  open,
  onClose,
  editing = null,
}: {
  open: boolean;
  onClose: () => void;
  editing?: Charge | null;
}): JSX.Element {
  const queryClient = useQueryClient();
  const { notify, notifyError } = useFeedback();
  const { setErrors, setServerErrors, clearAll, errorOf } = useFormErrors();
  const empty = { clientId: '', tripId: '', total: '', dueDate: '', description: '' };
  const [form, setForm] = useState(empty);

  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setForm(
        editing
          ? {
              clientId: editing.clientId,
              tripId: editing.tripId ?? '',
              total: editing.total,
              dueDate: editing.dueDate,
              description: editing.description ?? '',
            }
          : empty,
      );
    }
  }

  const clients = useQuery({
    queryKey: queryKeys.clientList({ limit: 100 }),
    queryFn: () => api.get<Page<Client>>('/clients', { limit: 100 }),
    enabled: open,
  });

  // Sem cliente escolhido, lista as viagens de todos: escolher a viagem já
  // define o cliente da cobrança.
  const trips = useQuery({
    queryKey: queryKeys.tripList({ clientId: form.clientId, forCharge: true }),
    queryFn: () =>
      api.get<Page<TripInternal>>('/trips', {
        limit: 50,
        ...(form.clientId === '' ? {} : { clientId: form.clientId }),
      }),
    enabled: open,
  });

  const save = useMutation({
    // Corpo já validado pelo contrato — ver `submit` abaixo.
    mutationFn: (body: Record<string, unknown>) =>
      editing
        ? api.patch<Charge>(`/charges/${editing.id}`, body)
        : api.post<Charge>('/charges', body),
    onSuccess: (charge) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.charges });
      void queryClient.invalidateQueries({ queryKey: queryKeys.payments });
      void queryClient.invalidateQueries({ queryKey: queryKeys.clients });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboardFin });
      notify('success', editing ? 'Cobrança atualizada' : 'Cobrança criada', charge.code);
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
      clientId: optionalText(form.clientId),
      tripId: form.tripId === '' ? null : form.tripId,
      total: form.total.trim() === '' ? (editing ? undefined : '0') : form.total,
      dueDate: optionalText(form.dueDate),
      description: editing ? form.description.trim() || null : optionalText(form.description),
    };

    const result = validateBody(editing ? updateChargeBodySchema : createChargeBodySchema, raw);
    if (!result.ok) {
      setErrors(result.errors);
      notify('error', 'Verifique os campos destacados', Object.values(result.errors)[0]);
      return;
    }

    clearAll();
    save.mutate(raw);
  };

  // Já pago na cobrança em edição: o total não pode ficar abaixo disso.
  const paidAmount =
    editing !== null && Money.isPositive(editing.paidAmount) ? editing.paidAmount : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Editar cobrança ${editing.code}` : 'Nova cobrança'}
      desc="Nenhum campo é obrigatório — salve o que tiver e complete depois pelo Editar."
      footer={
        <>
          <Btn variant="outline" onClick={onClose}>
            Cancelar
          </Btn>
          <Btn onClick={submit} disabled={save.isPending}>
            {editing ? 'Salvar alterações' : 'Criar cobrança'}
          </Btn>
        </>
      }
    >
      <div className="grid gap-4">
        <Field
          label="Cliente"
          help="Para quem é a cobrança. Em branco, usa o cliente da viagem (ou 'Cliente a definir')."
          error={errorOf('clientId')}
        >
          <Select
            value={form.clientId}
            onChange={(e) => {
              setForm((s) => ({ ...s, clientId: e.target.value, tripId: '' }));
            }}
          >
            <option value="">A definir (escolher depois)</option>
            {(clients.data?.items ?? []).map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Viagem" help="Viagem relacionada (opcional)." error={errorOf('tripId')}>
          <Select
            value={form.tripId}
            onChange={(e) => {
              setForm((s) => ({ ...s, tripId: e.target.value }));
            }}
          >
            <option value="">Sem viagem específica</option>
            {(trips.data?.items ?? []).map((trip) => (
              <option key={trip.id} value={trip.id}>
                {trip.code} · {trip.origin} → {trip.destination}
                {form.clientId === '' && trip.client !== null ? ` · ${trip.client.name}` : ''}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Valor total"
            help={
              paidAmount !== null
                ? `Não pode ficar abaixo do já pago (${Money.formatBRL(paidAmount)}).`
                : 'Valor da cobrança (R$). Em branco, R$ 0.'
            }
            error={errorOf('total')}
          >
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.total}
              onChange={(e) => {
                setForm((s) => ({ ...s, total: e.target.value }));
              }}
              placeholder="30000"
            />
          </Field>
          <Field
            label="Vencimento"
            help="Data limite para pagamento. Em branco, hoje."
            error={errorOf('dueDate')}
          >
            <Input
              type="date"
              value={form.dueDate}
              onChange={(e) => {
                setForm((s) => ({ ...s, dueDate: e.target.value }));
              }}
            />
          </Field>
        </div>

        <Field label="Descrição" help="Anotação opcional." error={errorOf('description')}>
          <Textarea
            value={form.description}
            onChange={(e) => {
              setForm((s) => ({ ...s, description: e.target.value }));
            }}
            placeholder="Ex: fretamento SP–RJ, ida e volta."
          />
        </Field>
      </div>
    </Modal>
  );
}

function PaymentForm({
  charge,
  onClose,
}: {
  charge: Charge | null;
  onClose: () => void;
}): JSX.Element | null {
  const queryClient = useQueryClient();
  const { notify, notifyError } = useFeedback();
  const { setErrors, setServerErrors, clearAll, errorOf } = useFormErrors();

  const [amount, setAmount] = useState('');
  const [paidAt, setPaidAt] = useState(toISODate(new Date()));
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>('pix');
  const [note, setNote] = useState('');

  const [lastId, setLastId] = useState<string | null>(null);
  if (charge !== null && charge.id !== lastId) {
    setLastId(charge.id);
    setAmount(charge.balance);
    setPaidAt(toISODate(new Date()));
    setMethod('pix');
    setNote('');
  }

  const save = useMutation({
    // Corpo já validado pelo contrato — ver `submit` abaixo.
    mutationFn: (body: Record<string, unknown>) =>
      api.post<Charge>(`/charges/${charge?.id ?? ''}/payments`, body),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.charges });
      void queryClient.invalidateQueries({ queryKey: queryKeys.payments });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboardFin });
      void queryClient.invalidateQueries({ queryKey: queryKeys.clients });
      notify(
        'success',
        Money.isZero(updated.balance) ? 'Pagamento registrado' : 'Pagamento parcial registrado',
        Money.isZero(updated.balance)
          ? 'Cobrança quitada por completo.'
          : `Saldo restante: ${Money.formatBRL(updated.balance)}`,
      );
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiRequestError) setServerErrors(e.details);
      notifyError(e);
    },
  });

  /** Valida com o MESMO schema Zod da rota antes de enviar. */
  const submit = (): void => {
    const raw = { amount, paidAt: optionalText(paidAt), method, note: optionalText(note) };

    const result = validateBody(createPaymentBodySchema, raw);
    if (!result.ok) {
      setErrors(result.errors);
      notify('error', 'Verifique os campos destacados', Object.values(result.errors)[0]);
      return;
    }

    clearAll();
    save.mutate(raw);
  };

  if (charge === null) return null;

  const exceeds = Money.toCents(amount || '0') > Money.toCents(charge.balance);
  const valid = Money.isPositive(amount || '0') && !exceeds;

  return (
    <Modal
      open
      onClose={onClose}
      title="Registrar pagamento"
      desc={`Cobrança ${charge.code} · ${charge.client?.name ?? ''}`}
      footer={
        <>
          <Btn variant="outline" onClick={onClose}>
            Cancelar
          </Btn>
          <Btn onClick={submit} disabled={!valid || save.isPending}>
            Registrar pagamento
          </Btn>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid grid-cols-3 gap-2 rounded-lg bg-soft p-3 text-center text-sm">
          <div>
            <p className="text-xs text-sub">Total</p>
            <p className="font-semibold">{Money.formatBRL(charge.total)}</p>
          </div>
          <div>
            <p className="text-xs text-sub">Já pago</p>
            <p className="font-semibold">{Money.formatBRL(charge.paidAmount)}</p>
          </div>
          <div>
            <p className="text-xs text-sub">Saldo</p>
            <p className="font-semibold text-primary">{Money.formatBRL(charge.balance)}</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Valor recebido"
            required
            help="Quanto foi recebido agora."
            error={exceeds ? `Não pode exceder ${Money.formatBRL(charge.balance)}.` : undefined}
          >
            <Input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
              }}
            />
          </Field>
          <Field
            label="Data"
            help="Data do recebimento. Em branco, usa a data de hoje."
            error={errorOf('paidAt')}
          >
            <Input
              type="date"
              value={paidAt}
              onChange={(e) => {
                setPaidAt(e.target.value);
              }}
            />
          </Field>
        </div>

        <Field label="Forma de pagamento" help="Como o cliente pagou." error={errorOf('method')}>
          <Select
            value={method}
            onChange={(e) => {
              setMethod(e.target.value as (typeof PAYMENT_METHODS)[number]);
            }}
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Observação" help="Anotação opcional.">
          <Textarea
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
            placeholder="Ex: primeira parcela."
          />
        </Field>
      </div>
    </Modal>
  );
}

/**
 * Editar um pagamento já lançado. O saldo e o status da cobrança são
 * recontados no servidor; o limite do valor é o total da cobrança menos os
 * OUTROS pagamentos.
 */
function EditPaymentForm({
  payment,
  onClose,
}: {
  payment: PaymentHistoryItem | null;
  onClose: () => void;
}): JSX.Element | null {
  const queryClient = useQueryClient();
  const { notify, notifyError } = useFeedback();
  const { setErrors, setServerErrors, clearAll, errorOf } = useFormErrors();

  const [amount, setAmount] = useState('');
  const [paidAt, setPaidAt] = useState('');
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>('pix');
  const [note, setNote] = useState('');

  const [lastId, setLastId] = useState<string | null>(null);
  if (payment !== null && payment.id !== lastId) {
    setLastId(payment.id);
    setAmount(payment.amount);
    setPaidAt(payment.paidAt);
    setMethod(payment.method);
    setNote(payment.note ?? '');
  }
  if (payment === null && lastId !== null) setLastId(null);

  const charge = useQuery({
    queryKey: [...queryKeys.charges, 'detail', payment?.chargeId ?? ''],
    queryFn: () => api.get<Charge>(`/charges/${payment?.chargeId ?? ''}`),
    enabled: payment !== null,
  });

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch<Charge>(`/payments/${payment?.id ?? ''}`, body),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.charges });
      void queryClient.invalidateQueries({ queryKey: queryKeys.payments });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboardFin });
      void queryClient.invalidateQueries({ queryKey: queryKeys.clients });
      notify(
        'success',
        'Pagamento atualizado',
        `Saldo da ${updated.code}: ${Money.formatBRL(updated.balance)}`,
      );
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiRequestError) setServerErrors(e.details);
      notifyError(e);
    },
  });

  if (payment === null) return null;

  // Espaço para este pagamento: saldo atual + o valor que ele já ocupa.
  const room = charge.data === undefined ? null : Money.add(charge.data.balance, payment.amount);
  const exceeds = room !== null && Money.toCents(amount || '0') > Money.toCents(room);

  const submit = (): void => {
    const raw = {
      amount: amount.trim() === '' ? undefined : amount,
      paidAt: optionalText(paidAt),
      method,
      note: note.trim() === '' ? null : note.trim(),
    };

    const result = validateBody(updatePaymentBodySchema, raw);
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
      open
      onClose={onClose}
      title="Editar pagamento"
      desc={`Cobrança ${payment.chargeCode} · ${payment.clientName}`}
      footer={
        <>
          <Btn variant="outline" onClick={onClose}>
            Cancelar
          </Btn>
          <Btn onClick={submit} disabled={exceeds || save.isPending}>
            Salvar alterações
          </Btn>
        </>
      }
    >
      <div className="grid gap-4">
        {charge.data !== undefined && (
          <div className="grid grid-cols-3 gap-2 rounded-lg bg-soft p-3 text-center text-sm">
            <div>
              <p className="text-xs text-sub">Total</p>
              <p className="font-semibold">{Money.formatBRL(charge.data.total)}</p>
            </div>
            <div>
              <p className="text-xs text-sub">Já pago</p>
              <p className="font-semibold">{Money.formatBRL(charge.data.paidAmount)}</p>
            </div>
            <div>
              <p className="text-xs text-sub">Máximo para este</p>
              <p className="font-semibold text-primary">{Money.formatBRL(room)}</p>
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Valor recebido"
            help="Em branco, mantém o valor atual."
            error={exceeds ? `Não pode passar de ${Money.formatBRL(room)}.` : errorOf('amount')}
          >
            <Input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
              }}
            />
          </Field>
          <Field label="Data" help="Data do recebimento." error={errorOf('paidAt')}>
            <Input
              type="date"
              value={paidAt}
              onChange={(e) => {
                setPaidAt(e.target.value);
              }}
            />
          </Field>
        </div>

        <Field label="Forma de pagamento" error={errorOf('method')}>
          <Select
            value={method}
            onChange={(e) => {
              setMethod(e.target.value as (typeof PAYMENT_METHODS)[number]);
            }}
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Observação" help="Anotação opcional." error={errorOf('note')}>
          <Textarea
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
          />
        </Field>
      </div>
    </Modal>
  );
}

// ============================================================================
//  PAGAMENTOS
// ============================================================================

export function FinPagamentos(): JSX.Element {
  const queryClient = useQueryClient();
  const { confirm, notify, notifyError } = useFeedback();
  const { can } = useAuth();
  const [payFor, setPayFor] = useState<Charge | null>(null);
  const [editingPayment, setEditingPayment] = useState<PaymentHistoryItem | null>(null);

  const reverse = useMutation({
    mutationFn: (payment: PaymentHistoryItem) => api.post(`/payments/${payment.id}/reverse`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.charges });
      void queryClient.invalidateQueries({ queryKey: queryKeys.payments });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboardFin });
      void queryClient.invalidateQueries({ queryKey: queryKeys.clients });
      notify('success', 'Pagamento estornado', 'O valor voltou para o saldo da cobrança.');
    },
    onError: (e) => {
      notifyError(e);
    },
  });

  const payments = useQuery({
    queryKey: queryKeys.paymentList({}),
    queryFn: () => api.get<Page<PaymentHistoryItem>>('/payments', { limit: 50 }),
  });

  const open = useQuery({
    queryKey: queryKeys.chargeList({ openOnly: true }),
    queryFn: () => api.get<Page<Charge>>('/charges', { openOnly: true, limit: 50 }),
  });

  const settle = useMutation({
    mutationFn: (charge: Charge) =>
      api.post(`/charges/${charge.id}/settle`, {
        paidAt: toISODate(new Date()),
        method: 'transferencia',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.charges });
      void queryClient.invalidateQueries({ queryKey: queryKeys.payments });
      notify('success', 'Baixa registrada');
    },
    onError: (e) => {
      notifyError(e);
    },
  });

  return (
    <div className="space-y-6">
      <PageHead title="Pagamentos" desc="Registre pagamentos e dê baixa em cobranças em aberto." />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="p-5 pb-3">
            <h3 className="flex items-center gap-2 font-semibold">
              <Icon name="History" size={16} className="text-sub" /> Histórico de pagamentos
            </h3>
            <p className="text-sm text-sub">Recebimentos já registrados</p>
          </div>

          {payments.isPending ? (
            <Loading />
          ) : (payments.data?.items ?? []).length === 0 ? (
            <Empty icon="Banknote" title="Nenhum pagamento" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <TH>Data</TH>
                    <TH>Cliente</TH>
                    <TH>Cobrança</TH>
                    <TH>Forma</TH>
                    <TH>Valor</TH>
                    <TH />
                  </tr>
                </thead>
                <tbody>
                  {(payments.data?.items ?? []).map((payment) => (
                    <tr key={payment.id} className="border-b border-line last:border-0">
                      <TD className="whitespace-nowrap">{formatDate(payment.paidAt)}</TD>
                      <TD className="whitespace-nowrap font-medium">{payment.clientName}</TD>
                      <TD className="text-sub">{payment.chargeCode}</TD>
                      <TD>
                        <Badge tone="neutral">{PAYMENT_METHOD_LABELS[payment.method]}</Badge>
                      </TD>
                      <TD className="font-medium text-success">
                        {Money.formatBRL(payment.amount)}
                      </TD>
                      <TD>
                        <Menu
                          items={[
                            {
                              label: 'Editar',
                              icon: 'Pencil',
                              hidden: !can('payment:update'),
                              onClick: () => {
                                setEditingPayment(payment);
                              },
                            },
                            {
                              label: 'Estornar',
                              icon: 'RefreshCw',
                              danger: true,
                              separator: true,
                              hidden: !can('payment:reverse'),
                              onClick: () => {
                                confirm({
                                  title: 'Estornar pagamento?',
                                  desc: `${Money.formatBRL(payment.amount)} de ${payment.clientName} (${payment.chargeCode}) volta para o saldo da cobrança.`,
                                  danger: true,
                                  confirmLabel: 'Estornar',
                                  onConfirm: () => {
                                    reverse.mutate(payment);
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

        <Card>
          <div className="p-5 pb-3">
            <h3 className="font-semibold">Cobranças em aberto</h3>
            <p className="text-sm text-sub">Dê baixa com um clique</p>
          </div>
          <div className="space-y-2 px-5 pb-5">
            {(open.data?.items ?? []).length === 0 ? (
              <Empty icon="CheckCircle2" title="Tudo quitado" />
            ) : (
              (open.data?.items ?? []).map((charge) => (
                <div key={charge.id} className="rounded-lg border border-line p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{charge.client?.name ?? '—'}</span>
                    <ChargeBadge status={charge.status} />
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-xs text-sub">
                      {charge.code} · vence {formatDate(charge.dueDate)}
                    </span>
                    <span className="text-sm font-semibold">{Money.formatBRL(charge.balance)}</span>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Btn
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        setPayFor(charge);
                      }}
                    >
                      Parcial
                    </Btn>
                    <Btn
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        confirm({
                          title: 'Dar baixa na cobrança?',
                          desc: `${charge.code} será quitada por completo (${Money.formatBRL(charge.balance)}).`,
                          confirmLabel: 'Confirmar baixa',
                          onConfirm: () => {
                            settle.mutate(charge);
                          },
                        });
                      }}
                    >
                      <Icon name="CheckCircle2" size={16} /> Baixa
                    </Btn>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <PaymentForm
        charge={payFor}
        onClose={() => {
          setPayFor(null);
        }}
      />
      <EditPaymentForm
        payment={editingPayment}
        onClose={() => {
          setEditingPayment(null);
        }}
      />
    </div>
  );
}

// ============================================================================
//  RELATÓRIOS
// ============================================================================

export function FinRelatorios(): JSX.Element {
  const report = useQuery({
    queryKey: queryKeys.reportFinancial,
    queryFn: () => api.get<FinancialReport>('/reports/financial'),
  });

  if (report.isPending) return <Loading />;
  if (report.isError) {
    return (
      <ErrorState message="Não foi possível carregar." onRetry={() => void report.refetch()} />
    );
  }

  const d = report.data;
  const maxMonthly = Math.max(1, ...d.monthlyReceipts.map((m) => Money.toCents(m.amount)));
  const maxDebtor = Math.max(1, ...d.topDebtors.map((t) => Money.toCents(t.balance)));
  const totalByStatus = d.byStatus.reduce((sum, s) => sum + s.count, 0);

  const statusColor: Record<ChargeStatus, string> = {
    pago: 'bg-success',
    parcial: 'bg-primary',
    pendente: 'bg-warning',
    vencido: 'bg-danger',
  };

  return (
    <div className="space-y-6">
      <PageHead title="Relatórios" desc="Indicadores e gráficos da operação financeira." />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Total faturado" value={Money.formatBRL(d.totalInvoiced)} icon="BarChart3" />
        <Stat
          label="Total recebido"
          value={Money.formatBRL(d.totalReceived)}
          icon="TrendingUp"
          tone="success"
        />
        <Stat
          label="Clientes inadimplentes"
          value={d.delinquentClients}
          icon="Users"
          tone="danger"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="font-semibold">Recebimentos por mês</h3>
          <p className="text-sm text-sub">Valores efetivamente recebidos</p>
          {d.monthlyReceipts.length === 0 ? (
            <Empty icon="BarChart3" title="Sem recebimentos" />
          ) : (
            <div className="mt-6 flex h-52 items-end gap-6 border-b border-line pb-0">
              {d.monthlyReceipts.map((month) => (
                <div
                  key={`${month.year}-${month.month}`}
                  className="flex flex-1 flex-col items-center gap-2"
                >
                  <span className="text-xs font-medium text-sub">
                    {Money.formatBRLShort(month.amount)}
                  </span>
                  <div
                    className="w-full max-w-[64px] rounded-t-lg bg-primary"
                    style={{
                      height: `${Math.max(6, (Money.toCents(month.amount) / maxMonthly) * 160)}px`,
                    }}
                  />
                  <span className="text-xs text-sub">{MONTH_ABBR[month.month - 1]}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="flex items-center gap-2 font-semibold">
            <Icon name="PieChart" size={16} className="text-sub" /> Cobranças por status
          </h3>
          <p className="text-sm text-sub">Distribuição atual</p>
          <div className="mt-4 space-y-3">
            {d.byStatus.map((entry) => (
              <div key={entry.status}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span>{CHARGE_STATUS_LABELS[entry.status]}</span>
                  <span className="font-medium">{entry.count}</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-soft">
                  <div
                    className={`h-full rounded-full ${statusColor[entry.status]}`}
                    style={{ width: `${(entry.count / Math.max(1, totalByStatus)) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h3 className="font-semibold">Maiores saldos em aberto</h3>
          <p className="text-sm text-sub">Top 5 clientes por valor pendente</p>
          <div className="mt-4 space-y-3">
            {d.topDebtors.length === 0 ? (
              <Empty icon="CheckCircle2" title="Nenhum saldo em aberto" />
            ) : (
              d.topDebtors.map((debtor) => (
                <div key={debtor.clientId} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 truncate text-sm">{debtor.name}</span>
                  <div className="h-6 flex-1 overflow-hidden rounded-md bg-soft">
                    <div
                      className="flex h-full items-center justify-end rounded-md bg-primary px-2 text-[11px] font-medium text-white"
                      style={{
                        width: `${Math.max(12, (Money.toCents(debtor.balance) / maxDebtor) * 100)}%`,
                      }}
                    >
                      {Money.formatBRLShort(debtor.balance)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
