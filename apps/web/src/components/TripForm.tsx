/**
 * Formulário de viagem — protótipo: `TripForm`.
 *
 * Mantém tudo o que a tela original fazia: aviso de pendência financeira do
 * cliente, verificação de disponibilidade em tempo real, painel de cálculo de
 * tarifa e editor de passageiros.
 *
 * A diferença é de onde vem a verdade: conflito de agenda e cálculo de tarifa
 * agora são consultados ao SERVIDOR (com debounce), que é a autoridade. O
 * feedback continua imediato, mas ninguém consegue burlar mandando outro valor
 * no POST.
 */

import {
  COST_FIELDS,
  KIND_LABELS,
  Money,
  combineDateTime,
  createTripBodySchema,
  toISODate,
  updateTripBodySchema,
  type Aircraft,
  type AvailabilityResult,
  type Client,
  type PricingPreview,
  type TripInternal,
} from '@acm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';

import { api, ApiRequestError } from '../lib/api';
import { optionalText, toIsoDateTime, useFormErrors, validateBody } from '../lib/form';
import { useFeedback } from '../lib/feedback';
import { queryKeys } from '../lib/query-keys';
import {
  newPassenger,
  PassengersEditor,
  toPassengerBody,
  type PassengerDraft,
} from './PassengersEditor';
import {
  Banner,
  Btn,
  Field,
  FinancialBadge,
  Icon,
  Input,
  Modal,
  Select,
  Spinner,
  Textarea,
} from './ui';

export interface TripPrefill {
  readonly clientId?: string;
  readonly origin?: string;
  readonly destination?: string;
  readonly departureDate?: string;
  readonly departureTime?: string;
  readonly returnDate?: string;
  readonly returnTime?: string;
  readonly requestId?: string;
  readonly passengers?: readonly { name: string; documentFileId: string | null }[];
}

interface FormState {
  clientId: string;
  aircraftId: string;
  origin: string;
  destination: string;
  departureDate: string;
  departureTime: string;
  returnDate: string;
  returnTime: string;
  distanceKm: string;
  commercialValue: string;
  notes: string;
}

const blank = (): FormState => ({
  clientId: '',
  aircraftId: '',
  origin: '',
  destination: '',
  departureDate: '',
  departureTime: '',
  returnDate: '',
  returnTime: '',
  distanceKm: '',
  commercialValue: '',
  notes: '',
});

/** Espera o usuário parar de digitar antes de consultar o servidor. */
function useDebounced<T>(value: T, delay = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delay);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);
  return debounced;
}

export function TripForm({
  open,
  onClose,
  editing,
  prefill,
}: {
  open: boolean;
  onClose: () => void;
  editing?: TripInternal | null;
  prefill?: TripPrefill | null;
}): JSX.Element {
  const queryClient = useQueryClient();
  const { notify, notifyError, confirm } = useFeedback();

  const [form, setForm] = useState<FormState>(blank);
  const { setErrors, setServerErrors, clearAll, errorOf } = useFormErrors();
  const [pax, setPax] = useState<PassengerDraft[]>([newPassenger()]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((state) => ({ ...state, [key]: value }));
  };

  // Preenche ao abrir: edição, conversão de solicitação, ou em branco.
  useEffect(() => {
    if (!open) return;

    if (editing) {
      setForm({
        clientId: editing.clientId,
        aircraftId: editing.aircraftId ?? '',
        origin: editing.origin,
        destination: editing.destination,
        departureDate: editing.departureAt.slice(0, 10),
        departureTime: new Date(editing.departureAt).toTimeString().slice(0, 5),
        returnDate: editing.returnAt.slice(0, 10),
        returnTime: new Date(editing.returnAt).toTimeString().slice(0, 5),
        distanceKm: editing.distanceKm === null ? '' : String(editing.distanceKm),
        commercialValue: editing.commercialValue ?? '',
        notes: editing.notes ?? '',
      });
      setPax(
        editing.pax.length > 0
          ? editing.pax.map((p) => ({
              key: p.id,
              name: p.name,
              documentFileId: p.documentFileId,
              uploading: false,
            }))
          : [newPassenger()],
      );
      return;
    }

    setForm({ ...blank(), ...prefill });
    setPax(
      prefill?.passengers && prefill.passengers.length > 0
        ? prefill.passengers.map((p, i) => ({
            key: `pf-${i}`,
            name: p.name,
            documentFileId: p.documentFileId,
            uploading: false,
          }))
        : [newPassenger()],
    );
  }, [open, editing, prefill]);

  const clients = useQuery({
    queryKey: queryKeys.clientList({ limit: 100 }),
    queryFn: () => api.get<{ items: Client[] }>('/clients', { limit: 100 }),
    enabled: open,
  });

  const aircraft = useQuery({
    queryKey: queryKeys.aircraftList({ limit: 100 }),
    queryFn: () => api.get<{ items: Aircraft[] }>('/aircraft', { limit: 100 }),
    enabled: open,
  });

  const departureAt = combineDateTime(form.departureDate, form.departureTime);
  const returnAt = combineDateTime(form.returnDate, form.returnTime);
  const scheduleFilled =
    form.departureDate !== '' &&
    form.departureTime !== '' &&
    form.returnDate !== '' &&
    form.returnTime !== '';
  const scheduleValid =
    scheduleFilled && new Date(returnAt).getTime() > new Date(departureAt).getTime();

  const debouncedSchedule = useDebounced({ departureAt, returnAt, aircraftId: form.aircraftId });

  // ---- disponibilidade: o servidor é quem responde ----
  const availability = useQuery({
    queryKey: ['availability-check', debouncedSchedule, editing?.id ?? null],
    enabled:
      open &&
      debouncedSchedule.aircraftId !== '' &&
      scheduleValid &&
      debouncedSchedule.departureAt !== '',
    queryFn: () =>
      api.post<AvailabilityResult>('/trips/check-availability', {
        aircraftId: debouncedSchedule.aircraftId,
        departureAt: new Date(debouncedSchedule.departureAt).toISOString(),
        returnAt: new Date(debouncedSchedule.returnAt).toISOString(),
        ignoreTripId: editing?.id ?? null,
      }),
  });

  // ---- cálculo de tarifa ----
  const debouncedDistance = useDebounced(form.distanceKm);
  const pricing = useQuery({
    queryKey: queryKeys.pricingPreview(form.aircraftId, Number(debouncedDistance) || 0),
    enabled: open && form.aircraftId !== '',
    queryFn: () =>
      api.get<PricingPreview>('/trips/pricing-preview', {
        aircraftId: form.aircraftId,
        distanceKm: Number(debouncedDistance) || 0,
      }),
  });

  const selectedClient = clients.data?.items.find((c) => c.id === form.clientId);
  const hasDebt = selectedClient !== undefined && selectedClient.financialStatus !== 'em_dia';

  const conflict = availability.data !== undefined && !availability.data.available;
  const paxValid = pax.length > 0 && pax.every((p) => p.name.trim().length >= 2);

  const canSubmit =
    form.clientId !== '' &&
    form.aircraftId !== '' &&
    form.origin.trim() !== '' &&
    form.destination.trim() !== '' &&
    scheduleValid &&
    paxValid &&
    !conflict &&
    !pax.some((p) => p.uploading);

  const save = useMutation({
    // Recebe o corpo JÁ validado pelo contrato — o `submit` abaixo garante isso.
    mutationFn: (body: Record<string, unknown>) =>
      editing
        ? api.patch<TripInternal>(`/trips/${editing.id}`, body)
        : api.post<TripInternal>('/trips', body),
    onSuccess: (trip) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.trips });
      void queryClient.invalidateQueries({ queryKey: queryKeys.requests });
      void queryClient.invalidateQueries({ queryKey: queryKeys.clients });
      void queryClient.invalidateQueries({ queryKey: ['calendar'] });
      notify(
        'success',
        editing ? 'Viagem atualizada' : 'Viagem agendada',
        `${trip.code} ${editing ? 'foi alterada' : 'confirmada'}.`,
      );
      onClose();
    },
    onError: (error) => {
      // Regras que só o servidor conhece (conflito de agenda, cliente
      // inexistente) chegam aqui e vão para o campo certo, não só num toast.
      if (error instanceof ApiRequestError) setServerErrors(error.details);
      notifyError(error);
    },
  });

  /**
   * Monta o corpo e valida contra o MESMO schema Zod que a rota do Fastify usa.
   *
   * `null` significa que a validação reprovou — os erros já ficaram em
   * `errors`, campo a campo.
   */
  const buildBody = (acknowledgeDebt: boolean): Record<string, unknown> | null => {
    const departureIso = toIsoDateTime(form.departureDate, form.departureTime);
    const returnIso = toIsoDateTime(form.returnDate, form.returnTime);

    if (departureIso === null || returnIso === null) {
      setErrors({ departureAt: 'Informe as datas e horários de ida e volta.' });
      return null;
    }

    const raw = {
      clientId: form.clientId,
      aircraftId: form.aircraftId,
      origin: form.origin.trim(),
      destination: form.destination.trim(),
      departureAt: departureIso,
      returnAt: returnIso,
      distanceKm: form.distanceKm === '' ? null : Number(form.distanceKm),
      commercialValue: form.commercialValue === '' ? null : form.commercialValue,
      notes: optionalText(form.notes),
      pax: toPassengerBody(pax),
      ...(editing ? {} : { requestId: prefill?.requestId ?? null, acknowledgeDebt }),
    };

    const result = validateBody(editing ? updateTripBodySchema : createTripBodySchema, raw);

    if (!result.ok) {
      setErrors(result.errors);
      notify('error', 'Verifique os campos destacados', Object.values(result.errors)[0]);
      return null;
    }

    clearAll();
    return raw;
  };

  const submit = (): void => {
    if (!scheduleValid) {
      setErrors({ returnAt: 'A volta precisa ser depois da ida.' });
      notify('error', 'Datas inválidas', 'A volta precisa ser depois da ida.');
      return;
    }

    // Pendência financeira: o operacional pode agendar, mas confirma antes — e
    // a decisão fica registrada em `scheduledWithDebt` no banco.
    if (hasDebt && !editing) {
      const body = buildBody(true);
      if (body === null) return;

      confirm({
        title: 'Cliente com pendência financeira',
        desc: `${selectedClient.name} possui ${Money.formatBRL(selectedClient.openBalance)} em aberto (situação: ${selectedClient.financialStatus}). Deseja agendar mesmo assim?`,
        confirmLabel: 'Agendar mesmo assim',
        danger: selectedClient.financialStatus === 'vencido',
        onConfirm: () => save.mutateAsync(body).then(() => undefined),
      });
      return;
    }

    const body = buildBody(false);
    if (body !== null) save.mutate(body);
  };

  const estimated = pricing.data?.estimatedValue ?? '0.00';

  /**
   * `pricing.data` já estreitado para o painel de tarifa.
   *
   * Dentro do JSX, o narrowing por optional chain (`pricing.data?.x != null`)
   * não alcança os usos aninhados no mesmo bloco, então a variável resolve isso
   * uma vez em vez de espalhar `?.` e `??` por dez lugares.
   */
  const tariffData =
    pricing.data !== undefined && pricing.data.tariffValue !== null ? pricing.data : null;
  const today = toISODate(new Date());

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="max-w-2xl"
      title={editing ? 'Editar viagem' : 'Nova viagem'}
      desc="O Operacional agenda direto. A aeronave e a tarifa são visíveis somente para o Operacional."
      footer={
        <>
          <Btn variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancelar
          </Btn>
          <Btn onClick={submit} disabled={!canSubmit || save.isPending}>
            {save.isPending ? <Spinner /> : <Icon name="Plane" size={16} />}
            {editing ? 'Salvar alterações' : 'Agendar viagem'}
          </Btn>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field
            label="Cliente"
            required
            help="Para quem é esta viagem."
            error={errorOf('clientId')}
          >
            <Select
              value={form.clientId}
              onChange={(e) => {
                set('clientId', e.target.value);
              }}
            >
              <option value="">Selecione o cliente</option>
              {(clients.data?.items ?? []).map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                  {client.company !== null ? ` · ${client.company}` : ''}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {selectedClient !== undefined && (
          <div className="sm:col-span-2">
            {hasDebt ? (
              <Banner
                tone={selectedClient.financialStatus === 'vencido' ? 'danger' : 'warning'}
                icon="AlertTriangle"
                title="Cliente com pendência financeira"
                action={<FinancialBadge status={selectedClient.financialStatus} />}
              >
                {selectedClient.name} possui{' '}
                <strong>{Money.formatBRL(selectedClient.openBalance)}</strong> em aberto. Você pode
                agendar mesmo assim (será pedida uma confirmação).
              </Banner>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success-soft px-3 py-2 text-sm text-success">
                <Icon name="CheckCircle2" size={16} /> Cliente em dia com o financeiro.
              </div>
            )}
          </div>
        )}

        <Field label="Origem" required help="De onde o voo parte." error={errorOf('origin')}>
          <Input
            value={form.origin}
            onChange={(e) => {
              set('origin', e.target.value);
            }}
            placeholder="Ex: São Paulo (CGH)"
          />
        </Field>

        <Field label="Destino" required help="Para onde o voo vai." error={errorOf('destination')}>
          <Input
            value={form.destination}
            onChange={(e) => {
              set('destination', e.target.value);
            }}
            placeholder="Ex: Rio de Janeiro (SDU)"
          />
        </Field>

        <Field label="Data da ida" required help="Dia do embarque." error={errorOf('departureAt')}>
          <Input
            type="date"
            min={editing ? undefined : today}
            value={form.departureDate}
            onChange={(e) => {
              set('departureDate', e.target.value);
            }}
          />
        </Field>

        <Field label="Hora da ida" required help="Horário do embarque.">
          <Input
            type="time"
            value={form.departureTime}
            onChange={(e) => {
              set('departureTime', e.target.value);
            }}
          />
        </Field>

        <Field label="Data da volta" required help="Dia do retorno." error={errorOf('returnAt')}>
          <Input
            type="date"
            min={form.departureDate === '' ? (editing ? undefined : today) : form.departureDate}
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

        <Field
          label="Aeronave"
          required
          help="Só o Operacional vê a aeronave."
          error={errorOf('aircraftId')}
        >
          <Select
            value={form.aircraftId}
            onChange={(e) => {
              set('aircraftId', e.target.value);
            }}
          >
            <option value="">Selecione a aeronave</option>
            {(aircraft.data?.items ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.prefix} · {KIND_LABELS[item.kind]} · {item.model}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Distância do trecho (km)"
          help="Distância só de ida. Usada para estimar as horas de voo (ida e volta) e o valor."
          error={errorOf('distanceKm')}
        >
          <Input
            type="number"
            min="0"
            value={form.distanceKm}
            onChange={(e) => {
              set('distanceKm', e.target.value);
            }}
            placeholder="Ex: 360"
          />
        </Field>

        {/* ---- disponibilidade, respondida pelo servidor ---- */}
        {form.aircraftId !== '' && scheduleValid && (
          <div className="sm:col-span-2">
            {availability.isFetching ? (
              <div className="flex items-center gap-2 rounded-lg border border-line bg-soft/50 p-3.5 text-sm text-sub">
                <Spinner /> Verificando disponibilidade…
              </div>
            ) : conflict ? (
              <div className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger-soft p-3.5">
                <span className="text-danger">
                  <Icon name="AlertTriangle" size={20} />
                </span>
                <div>
                  <p className="text-sm font-semibold text-danger">Voo NÃO Disponível</p>
                  <p className="mt-0.5 text-sm text-danger/80">
                    {availability.data.reason === 'margin'
                      ? `Não há intervalo mínimo de ${availability.data.marginMinutes} min entre este voo e outro compromisso da aeronave.`
                      : 'A aeronave selecionada já possui um compromisso neste período.'}
                  </p>
                  <p className="mt-1.5 text-xs text-danger/70">
                    Conflito com: {availability.data.label}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 rounded-lg border border-success/30 bg-success-soft p-3.5">
                <span className="text-success">
                  <Icon name="CheckCircle2" size={20} />
                </span>
                <div>
                  <p className="text-sm font-semibold text-success">Voo Disponível</p>
                  <p className="mt-0.5 text-sm text-success/80">
                    A aeronave está livre neste período.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ---- cálculo de tarifa ---- */}
        {/* `tariffData` é o `pricing.data` já estreitado: dentro de JSX o
            narrowing por optional chain não alcança os usos aninhados. */}
        {tariffData !== null && !conflict && (
          <div className="sm:col-span-2 rounded-lg border border-line bg-soft/60 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Icon name="Calculator" size={16} className="text-primary" />
              Cálculo de tarifa
              <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                <Icon name="Lock" size={12} /> Somente interno
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <div>
                <p className="text-xs text-sub">Tarifa da aeronave</p>
                <p className="text-sm font-semibold">{Money.formatBRL(tariffData.tariffValue)}/h</p>
              </div>
              <div>
                <p className="text-xs text-sub">Distância (ida)</p>
                <p className="text-sm font-semibold">
                  {tariffData.distanceKm > 0 ? `${tariffData.distanceKm} km` : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-sub">Velocidade cruzeiro</p>
                <p className="text-sm font-semibold">
                  {tariffData.cruiseSpeed > 0 ? `${tariffData.cruiseSpeed} km/h` : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-sub">Horas de voo (ida+volta)</p>
                <p className="text-sm font-semibold">
                  {tariffData.hours > 0 ? `${tariffData.hours} h` : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-sub">Valor estimado</p>
                <p className="text-sm font-semibold text-primary">
                  {tariffData.hours > 0 ? Money.formatBRL(estimated) : '—'}
                </p>
              </div>
            </div>

            {tariffData.distanceKm <= 0 && (
              <p className="mt-2 text-xs text-[#9A6A10]">
                Informe a distância do trecho para calcular as horas de voo e o valor estimado.
              </p>
            )}
            {tariffData.cruiseSpeed <= 0 && (
              <p className="mt-2 text-xs text-[#9A6A10]">
                Esta aeronave não tem velocidade de cruzeiro cadastrada (defina em Aeronaves).
              </p>
            )}

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {COST_FIELDS.map((field) => (
                <div key={field.key} className="rounded-md border border-line bg-white p-2">
                  <p className="text-[11px] text-sub">{field.label}</p>
                  <p className="text-xs font-medium">
                    {Money.formatBRL(tariffData[field.key] ?? '0')}/h
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-3">
              <Field
                label="Valor comercial"
                help="Valor final cobrado. Pode ser ajustado."
                error={errorOf('commercialValue')}
              >
                <Input
                  type="number"
                  step="0.01"
                  value={form.commercialValue}
                  onChange={(e) => {
                    set('commercialValue', e.target.value);
                  }}
                  placeholder={estimated}
                />
              </Field>
            </div>
          </div>
        )}

        <div className="sm:col-span-2">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-sm font-semibold">Passageiros</p>
            <span className="text-xs text-sub">
              {pax.length} passageiro{pax.length > 1 ? 's' : ''}
            </span>
          </div>
          <p className="mb-3 text-xs text-sub">
            Adicione os passageiros e, se tiver, anexe a foto do documento de cada um.
          </p>
          {errorOf('pax') !== undefined && (
            <p className="mb-2 text-xs text-danger">{errorOf('pax')}</p>
          )}
          <PassengersEditor value={pax} onChange={setPax} requireDocument={false} />
        </div>

        <div className="sm:col-span-2">
          <Field
            label="Observações"
            help="Informações extras para a operação."
            error={errorOf('notes')}
          >
            <Textarea
              value={form.notes}
              onChange={(e) => {
                set('notes', e.target.value);
              }}
              placeholder="Preferências do cliente, bagagem, etc."
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/** Lista de clientes com saldo — usada em vários pontos como memo compartilhado. */
export function useClientOptions(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.clientList({ limit: 100 }),
    queryFn: () => api.get<{ items: Client[] }>('/clients', { limit: 100 }),
    enabled,
  });
}

export const tripFormHelpers = { useDebounced };

export function usePricingMemo(pricing: PricingPreview | undefined): string {
  return useMemo(() => pricing?.estimatedValue ?? '0.00', [pricing]);
}
