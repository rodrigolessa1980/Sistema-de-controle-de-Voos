/**
 * Rótulos em PT-BR — porte direto do objeto `L` de `src/index.html`.
 *
 * Cada mapa é `Record<Union, string>`, então adicionar um valor no enum sem
 * adicionar o rótulo aqui é erro de compilação. No protótipo isso rendia
 * `undefined` silencioso na tela.
 */

import type {
  AircraftKind,
  AircraftStatus,
  BlockKind,
  ChargeStatus,
  ClientFinancialStatus,
  DayAvailability,
  FlightRequestStatus,
  NotificationType,
  PaymentMethod,
  RoleKey,
  TariffUnit,
  TripStatus,
  UserStatus,
} from './enums';

export const KIND_LABELS: Record<AircraftKind, string> = {
  aviao: 'Avião',
  helicoptero: 'Helicóptero',
};

export const AIRCRAFT_STATUS_LABELS: Record<AircraftStatus, string> = {
  disponivel: 'Disponível',
  em_voo: 'Em voo',
  manutencao: 'Manutenção',
  indisponivel: 'Indisponível',
};

export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  confirmada: 'Confirmada',
  recusada: 'Recusada',
  em_andamento: 'Em andamento',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
};

export const REQUEST_STATUS_LABELS: Record<FlightRequestStatus, string> = {
  aguardando_analise: 'Aguardando análise',
  em_analise: 'Em análise',
  convertida: 'Convertida em viagem',
  recusada: 'Recusada',
};

export const CHARGE_STATUS_LABELS: Record<ChargeStatus, string> = {
  pendente: 'Pendente',
  parcial: 'Parcial',
  pago: 'Pago',
  vencido: 'Vencido',
};

export const FINANCIAL_STATUS_LABELS: Record<ClientFinancialStatus, string> = {
  em_dia: 'Em dia',
  pendente: 'Pendente',
  vencido: 'Vencido',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  pix: 'PIX',
  transferencia: 'Transferência',
  boleto: 'Boleto',
  cartao: 'Cartão',
  dinheiro: 'Dinheiro',
};

export const TARIFF_UNIT_LABELS: Record<TariffUnit, string> = {
  por_hora: 'Por hora',
  por_trecho: 'Por trecho',
  diaria: 'Diária',
};

export const ROLE_LABELS: Record<RoleKey, string> = {
  operacional: 'Operacional',
  financeiro: 'Financeiro',
  cliente: 'Cliente',
  admin: 'Administrador',
};

export const BLOCK_KIND_LABELS: Record<BlockKind, string> = {
  manutencao: 'Manutenção',
  bloqueio: 'Bloqueio',
};

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  ativo: 'Ativo',
  inativo: 'Inativo',
  bloqueado: 'Bloqueado',
};

export const DAY_AVAILABILITY_LABELS: Record<DayAvailability, string> = {
  disponivel: 'Disponível',
  ocupado: 'Ocupado',
  indisponivel: 'Indisponível',
};

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  solicitacao_nova: 'Nova solicitação de voo',
  solicitacao_convertida: 'Solicitação convertida em viagem',
  solicitacao_recusada: 'Solicitação recusada',
  viagem_agendada: 'Viagem agendada',
  viagem_alterada: 'Viagem alterada',
  viagem_cancelada: 'Viagem cancelada',
  cobranca_criada: 'Cobrança criada',
  cobranca_vencida: 'Cobrança vencida',
  pagamento_recebido: 'Pagamento recebido',
};

/** Composição do custo da tarifa — protótipo: `COST_FIELDS`. */
export const COST_FIELDS = [
  {
    key: 'costFuel',
    label: 'Combustível',
    help: 'Custo de combustível.',
  },
  {
    key: 'costFlightHour',
    label: 'Hora de voo',
    help: 'Custo da hora de voo (operação/manutenção).',
  },
  {
    key: 'costFees',
    label: 'Taxas e tarifas',
    help: 'Taxas aeroportuárias e demais tarifas.',
  },
  {
    key: 'costPilot',
    label: 'Despesa do piloto',
    help: 'Diária / remuneração do piloto.',
  },
] as const;

export type CostFieldKey = (typeof COST_FIELDS)[number]['key'];
