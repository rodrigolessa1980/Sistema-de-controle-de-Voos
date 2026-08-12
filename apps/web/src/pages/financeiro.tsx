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
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  formatDate,
  toISODate,
  type Charge,
  type ChargeStatus,
  type Client,
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

interface FinancialDashboardData {
  totalReceivable: string;
  receivedThisMonth: string;
  overdueAmount: string;
  dueSoonCount: number;
  dueSoonDays: number;
  openCharges: {
    id: string;
    code: string;
    clientName: string;
    balance: string;
    dueDate: string;
    status: ChargeStatus;
  }[];
  dueSoon: { id: string; code: string; clientName: string; balance: string; dueDate: string }[];
}

export function FinDashboard(): JSX.Element {
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: queryKeys.dashboardFin,
    queryFn: () => api.get<FinancialDashboardData>('/dashboard/financeiro'),
  });

  if (query.isPending) return <Loading />;
  if (query.isError) {
    return <ErrorState message="Não foi possível carregar." onRetry={() => void query.refetch()} />;
  }

  const d = query.data;

  return (
    <div className="space-y-6">
      <PageHead
        title="Dashboard financeiro"
        desc="Resumo de recebíveis e situação das cobranças."
      />

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
        />
        <Stat
          label="Em atraso"
          value={Money.formatBRL(d.overdueAmount)}
          icon="AlertTriangle"
          tone="danger"
          hint="Vencido e não pago"
        />
        <Stat
          label="Próx. vencimentos"
          value={d.dueSoonCount}
          icon="CalendarClock"
          tone="warning"
          hint={`Próximos ${d.dueSoonDays} dias`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between p-5 pb-3">
            <div>
              <h3 className="font-semibold">Cobranças em aberto</h3>
              <p className="text-sm text-sub">Ordenadas por vencimento</p>
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
            <Empty icon="Banknote" title="Nada em aberto" />
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
            <p className="text-sm text-sub">Nos próximos {d.dueSoonDays} dias</p>
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
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | ChargeStatus>('all');
  const [payFor, setPayFor] = useState<Charge | null>(null);

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
        <Btn
          onClick={() => {
            setPayFor(null);
          }}
        >
          <Icon name="Banknote" size={16} /> Registrar pagamento
        </Btn>
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
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
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

function ChargeForm({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const queryClient = useQueryClient();
  const { notify, notifyError } = useFeedback();
  const { setErrors, setServerErrors, clearAll, errorOf } = useFormErrors();
  const [form, setForm] = useState({ clientId: '', tripId: '', total: '', dueDate: '' });

  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setForm({ clientId: '', tripId: '', total: '', dueDate: '' });
  }

  const clients = useQuery({
    queryKey: queryKeys.clientList({ limit: 100 }),
    queryFn: () => api.get<Page<Client>>('/clients', { limit: 100 }),
    enabled: open,
  });

  const trips = useQuery({
    queryKey: queryKeys.tripList({ clientId: form.clientId }),
    queryFn: () => api.get<Page<TripInternal>>('/trips', { clientId: form.clientId, limit: 50 }),
    enabled: open && form.clientId !== '',
  });

  const save = useMutation({
    // Corpo já validado pelo contrato — ver `submit` abaixo.
    mutationFn: (body: Record<string, unknown>) => api.post<Charge>('/charges', body),
    onSuccess: (charge) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.charges });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboardFin });
      notify('success', 'Cobrança criada', charge.code);
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiRequestError) setServerErrors(e.details);
      notifyError(e);
    },
  });

  const valid = form.clientId !== '' && form.total !== '' && form.dueDate !== '';

  /** Valida com o MESMO schema Zod da rota antes de enviar. */
  const submit = (): void => {
    const raw = {
      clientId: form.clientId,
      tripId: form.tripId === '' ? null : form.tripId,
      total: form.total,
      dueDate: form.dueDate,
    };

    const result = validateBody(createChargeBodySchema, raw);
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
      title="Nova cobrança"
      desc="Crie uma cobrança para um cliente, ligada ou não a uma viagem."
      footer={
        <>
          <Btn variant="outline" onClick={onClose}>
            Cancelar
          </Btn>
          <Btn onClick={submit} disabled={!valid || save.isPending}>
            Criar cobrança
          </Btn>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Cliente" required help="Para quem é a cobrança." error={errorOf('clientId')}>
          <Select
            value={form.clientId}
            onChange={(e) => {
              setForm((s) => ({ ...s, clientId: e.target.value, tripId: '' }));
            }}
          >
            <option value="">Selecione</option>
            {(clients.data?.items ?? []).map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Viagem" help="Viagem relacionada (opcional).">
          <Select
            value={form.tripId}
            disabled={form.clientId === ''}
            onChange={(e) => {
              setForm((s) => ({ ...s, tripId: e.target.value }));
            }}
          >
            <option value="">
              {form.clientId === '' ? 'Escolha o cliente primeiro' : 'Sem viagem específica'}
            </option>
            {(trips.data?.items ?? []).map((trip) => (
              <option key={trip.id} value={trip.id}>
                {trip.code} · {trip.origin} → {trip.destination}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Valor total"
            required
            help="Valor da cobrança (R$)."
            error={errorOf('total')}
          >
            <Input
              type="number"
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
            required
            help="Data limite para pagamento."
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
    const raw = { amount, paidAt, method, note: optionalText(note) };

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
          <Field label="Data" required help="Data do recebimento." error={errorOf('paidAt')}>
            <Input
              type="date"
              value={paidAt}
              onChange={(e) => {
                setPaidAt(e.target.value);
              }}
            />
          </Field>
        </div>

        <Field
          label="Forma de pagamento"
          required
          help="Como o cliente pagou."
          error={errorOf('method')}
        >
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

// ============================================================================
//  PAGAMENTOS
// ============================================================================

export function FinPagamentos(): JSX.Element {
  const queryClient = useQueryClient();
  const { confirm, notify, notifyError } = useFeedback();
  const [payFor, setPayFor] = useState<Charge | null>(null);

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
