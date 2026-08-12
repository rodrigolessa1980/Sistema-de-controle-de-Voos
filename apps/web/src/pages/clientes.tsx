/**
 * Clientes — protótipo: `ClientsView`, `ClientForm`, `ClientDetail`.
 *
 * Tela compartilhada entre Operacional e Financeiro. A diferença é só de
 * permissão: o financeiro não cria nem edita, e não vê aeronave no histórico.
 *
 * Saldo, situação e contagem de viagens vêm PRONTOS do servidor, como colunas.
 * No protótipo, cada linha da tabela varria todas as cobranças para calcular
 * esses três valores.
 */

import {
  Money,
  createClientBodySchema,
  updateClientBodySchema,
  formatDate,
  formatDateTime,
  type Charge,
  type Client,
  type TripInternal,
} from '@acm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { JSX } from 'react';

import {
  Avatar,
  Btn,
  Card,
  ChargeBadge,
  DetailRow,
  Empty,
  ErrorState,
  Field,
  FinancialBadge,
  Icon,
  Input,
  Loading,
  Menu,
  Modal,
  PageHead,
  SearchBox,
  Tabs,
  TD,
  TH,
  Textarea,
  Toggle,
  TripBadge,
} from '../components/ui';
import { api, ApiRequestError } from '../lib/api';
import { optionalText, useFormErrors, validateBody } from '../lib/form';
import { useAuth } from '../lib/auth';
import { useFeedback } from '../lib/feedback';
import { queryKeys } from '../lib/query-keys';

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export function ClientesPage({ desc }: { desc: string }): JSX.Element {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [detail, setDetail] = useState<Client | null>(null);

  const canCreate = can('client:create');
  const canUpdate = can('client:update');
  const showAircraft = can('aircraft:read');

  const clients = useQuery({
    queryKey: queryKeys.clientList({ q: search }),
    queryFn: () => api.get<Page<Client>>('/clients', { q: search, limit: 50 }),
  });

  return (
    <div className="space-y-6">
      <PageHead title="Clientes" desc={desc}>
        {canCreate && (
          <Btn
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Icon name="Plus" size={16} /> Novo cliente
          </Btn>
        )}
      </PageHead>

      <Card>
        <div className="border-b border-line p-4">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Buscar por nome, empresa ou e-mail"
          />
        </div>

        {clients.isPending ? (
          <Loading />
        ) : clients.isError ? (
          <ErrorState
            message="Não foi possível carregar os clientes."
            onRetry={() => void clients.refetch()}
          />
        ) : clients.data.items.length === 0 ? (
          <Empty icon="Users" title="Nenhum cliente encontrado" desc="Ajuste a busca." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  <TH>Cliente</TH>
                  <TH>Telefone</TH>
                  <TH>E-mail</TH>
                  <TH className="text-center">Viagens</TH>
                  <TH>Valor pendente</TH>
                  <TH>Status</TH>
                  <TH />
                </tr>
              </thead>
              <tbody>
                {clients.data.items.map((client) => (
                  <tr
                    key={client.id}
                    className="cursor-pointer border-b border-line last:border-0 hover:bg-soft/50"
                    onClick={() => {
                      setDetail(client);
                    }}
                  >
                    <TD>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={client.name} />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{client.name}</p>
                          {client.company !== null && (
                            <p className="truncate text-xs text-sub">{client.company}</p>
                          )}
                        </div>
                      </div>
                    </TD>
                    <TD className="whitespace-nowrap text-sub">{client.phone ?? '—'}</TD>
                    <TD className="text-sub">{client.email}</TD>
                    <TD className="text-center">{client.tripCount}</TD>
                    <TD className="whitespace-nowrap font-medium">
                      {Money.toCents(client.openBalance) > 0
                        ? Money.formatBRL(client.openBalance)
                        : '—'}
                    </TD>
                    <TD>
                      <FinancialBadge status={client.financialStatus} />
                    </TD>
                    <TD
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                    >
                      <Menu
                        items={[
                          {
                            label: 'Ver detalhes',
                            icon: 'Eye',
                            onClick: () => {
                              setDetail(client);
                            },
                          },
                          {
                            label: 'Editar',
                            icon: 'Pencil',
                            hidden: !canUpdate,
                            onClick: () => {
                              setEditing(client);
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

      <ClientForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
        }}
        editing={editing}
      />
      <ClientDetail
        client={detail}
        onClose={() => {
          setDetail(null);
        }}
        showAircraft={showAircraft}
      />
    </div>
  );
}

function ClientForm({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: Client | null;
}): JSX.Element {
  const queryClient = useQueryClient();
  const { notify, notifyError } = useFeedback();
  const { setErrors, setServerErrors, clearAll, errorOf } = useFormErrors();

  const [form, setForm] = useState({
    name: '',
    company: '',
    document: '',
    email: '',
    phone: '',
    notes: '',
    createPortalUser: false,
  });

  const set = (key: keyof typeof form, value: string | boolean): void => {
    setForm((s) => ({ ...s, [key]: value }));
  };

  useState(() => undefined);

  // Sincroniza ao abrir (equivalente ao `useEffect([open])` do protótipo).
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setForm({
        name: editing?.name ?? '',
        company: editing?.company ?? '',
        document: editing?.document ?? '',
        email: editing?.email ?? '',
        phone: editing?.phone ?? '',
        notes: editing?.notes ?? '',
        createPortalUser: false,
      });
    }
  }

  const save = useMutation({
    // Recebe o corpo já validado pelo contrato do backend.
    mutationFn: (body: Record<string, unknown>) =>
      editing
        ? api.patch<Client>(`/clients/${editing.id}`, body)
        : api.post<Client>('/clients', body),
    onSuccess: (client) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.clients });
      notify(
        'success',
        editing ? 'Cliente atualizado' : 'Cliente cadastrado',
        form.createPortalUser && !editing
          ? `${client.name} · senha provisória enviada por e-mail.`
          : client.name,
      );
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiRequestError) setServerErrors(error.details);
      notifyError(error);
    },
  });

  const valid = form.name.trim().length >= 2 && form.email.trim().includes('@');

  /** Valida com o MESMO schema Zod da rota antes de enviar. */
  const submit = (): void => {
    const raw = {
      name: form.name.trim(),
      company: optionalText(form.company),
      document: optionalText(form.document),
      email: form.email.trim(),
      phone: optionalText(form.phone),
      notes: optionalText(form.notes),
      ...(editing ? {} : { createPortalUser: form.createPortalUser }),
    };

    const result = validateBody(editing ? updateClientBodySchema : createClientBodySchema, raw);
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
      title={editing ? 'Editar cliente' : 'Novo cliente'}
      desc="Dados de contato do cliente."
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
        <div className="sm:col-span-2">
          <Field label="Nome" required help="Nome completo." error={errorOf('name')}>
            <Input
              value={form.name}
              onChange={(e) => {
                set('name', e.target.value);
              }}
              placeholder="Ex: Ricardo Menezes"
            />
          </Field>
        </div>
        <Field label="Empresa" help="Empresa (opcional).">
          <Input
            value={form.company}
            onChange={(e) => {
              set('company', e.target.value);
            }}
          />
        </Field>
        <Field label="Documento" help="CPF ou CNPJ." error={errorOf('document')}>
          <Input
            value={form.document}
            onChange={(e) => {
              set('document', e.target.value);
            }}
          />
        </Field>
        <Field label="Telefone" help="Com DDD." error={errorOf('phone')}>
          <Input
            value={form.phone}
            onChange={(e) => {
              set('phone', e.target.value);
            }}
          />
        </Field>
        <Field
          label="E-mail"
          required
          help="E-mail de contato e login do portal."
          error={errorOf('email')}
        >
          <Input
            type="email"
            value={form.email}
            onChange={(e) => {
              set('email', e.target.value);
            }}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Observações" help="Anotações internas sobre o cliente.">
            <Textarea
              value={form.notes}
              onChange={(e) => {
                set('notes', e.target.value);
              }}
            />
          </Field>
        </div>

        {!editing && (
          <div className="sm:col-span-2 flex items-center justify-between rounded-lg border border-line p-3">
            <div>
              <p className="text-sm font-medium">Criar acesso ao portal</p>
              <p className="text-xs text-sub">
                Envia uma senha provisória por e-mail. O cliente troca no primeiro acesso.
              </p>
            </div>
            <Toggle
              checked={form.createPortalUser}
              onChange={(v) => {
                set('createPortalUser', v);
              }}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}

function ClientDetail({
  client,
  onClose,
  showAircraft,
}: {
  client: Client | null;
  onClose: () => void;
  showAircraft: boolean;
}): JSX.Element | null {
  const [tab, setTab] = useState<'dados' | 'prox' | 'hist' | 'fin'>('dados');

  const trips = useQuery({
    queryKey: queryKeys.tripList({ clientId: client?.id }),
    queryFn: () => api.get<Page<TripInternal>>('/trips', { clientId: client?.id, limit: 50 }),
    enabled: client !== null,
  });

  const charges = useQuery({
    queryKey: queryKeys.chargeList({ clientId: client?.id }),
    queryFn: () => api.get<Page<Charge>>('/charges', { clientId: client?.id, limit: 50 }),
    enabled: client !== null,
  });

  if (client === null) return null;

  const now = Date.now();
  const all = trips.data?.items ?? [];
  const upcoming = all.filter(
    (t) => new Date(t.departureAt).getTime() >= now && t.status !== 'recusada',
  );
  const history = all.filter(
    (t) => new Date(t.departureAt).getTime() < now || t.status === 'concluida',
  );

  return (
    <Modal open onClose={onClose} size="max-w-2xl">
      <div className="-mt-2 flex items-center gap-3">
        <Avatar name={client.name} size="h-12 w-12 text-sm" />
        <div>
          <h3 className="text-lg font-semibold">{client.name}</h3>
          <p className="text-sm text-sub">{client.company ?? 'Cliente pessoa física'}</p>
        </div>
        <div className="ml-auto">
          <FinancialBadge status={client.financialStatus} />
        </div>
      </div>

      <Tabs
        className="mt-4 w-full"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'dados', label: 'Dados' },
          { key: 'prox', label: 'Próximos' },
          { key: 'hist', label: 'Histórico' },
          { key: 'fin', label: 'Financeiro' },
        ]}
      />

      <div className="mt-4">
        {tab === 'dados' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <DetailRow icon="Mail" label="E-mail" value={client.email} />
            <DetailRow icon="Phone" label="Telefone" value={client.phone ?? '—'} />
            <DetailRow icon="CreditCard" label="Documento" value={client.document ?? '—'} />
            <DetailRow
              icon="PlaneTakeoff"
              label="Total de viagens"
              value={String(client.tripCount)}
            />
          </div>
        )}

        {tab === 'prox' &&
          (upcoming.length === 0 ? (
            <Empty icon="PlaneTakeoff" title="Sem voos futuros" />
          ) : (
            <div className="space-y-2">
              {upcoming.map((trip) => (
                <TripRow key={trip.id} trip={trip} showAircraft={showAircraft} withTime />
              ))}
            </div>
          ))}

        {tab === 'hist' &&
          (history.length === 0 ? (
            <Empty icon="Plane" title="Sem histórico" />
          ) : (
            <div className="space-y-2">
              {history.map((trip) => (
                <TripRow key={trip.id} trip={trip} showAircraft={showAircraft} withTime={false} />
              ))}
            </div>
          ))}

        {tab === 'fin' && (
          <div>
            <div className="mb-3 flex items-center justify-between rounded-lg bg-soft p-3">
              <span className="flex items-center gap-2 text-sm text-sub">
                <Icon name="Wallet" size={16} /> Saldo em aberto
              </span>
              <span className="text-lg font-semibold">{Money.formatBRL(client.openBalance)}</span>
            </div>
            {(charges.data?.items ?? []).length === 0 ? (
              <Empty icon="Wallet" title="Sem cobranças" />
            ) : (
              <div className="space-y-2">
                {(charges.data?.items ?? []).map((charge) => (
                  <div
                    key={charge.id}
                    className="flex items-center justify-between rounded-lg border border-line p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{charge.code}</p>
                      <p className="text-xs text-sub">Vence {formatDate(charge.dueDate)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">{Money.formatBRL(charge.balance)}</p>
                      <ChargeBadge status={charge.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function TripRow({
  trip,
  showAircraft,
  withTime,
}: {
  trip: TripInternal;
  showAircraft: boolean;
  withTime: boolean;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between rounded-lg border border-line p-3">
      <div>
        <p className="text-sm font-medium">
          {trip.origin} → {trip.destination}
        </p>
        <p className="text-xs text-sub">
          {withTime ? formatDateTime(trip.departureAt) : formatDate(trip.departureAt)}
          {showAircraft && trip.aircraft !== null ? ` · ${trip.aircraft.prefix}` : ''}
        </p>
      </div>
      <TripBadge status={trip.status} />
    </div>
  );
}
