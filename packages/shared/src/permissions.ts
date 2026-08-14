/**
 * Catálogo de permissões e matriz por papel.
 *
 * Este arquivo é a fonte de verdade da autorização (docs/PLANO.md §4). O seed
 * popula `Permission` / `RolePermission` a partir daqui, o backend valida rota
 * por rota, e o front usa a lista que vem de `/auth/me` para esconder botões —
 * lembrando que esconder botão é UX, não segurança: a decisão é sempre do
 * servidor.
 *
 * Sufixo `_own` = escopo por linha. O usuário só alcança as próprias linhas, e
 * isso é aplicado injetando o filtro no `where` da query, nunca conferindo
 * depois de já ter lido.
 */

import type { RoleKey } from './enums';

export const PERMISSIONS = {
  // ---- frota (nunca exposta ao cliente) ----
  'aircraft:read': 'Ver a frota',
  'aircraft:create': 'Cadastrar aeronave',
  'aircraft:update': 'Editar aeronave',
  'aircraft:delete': 'Remover aeronave',

  // ---- tarifas (valor interno) ----
  'tariff:read': 'Ver tarifas',
  'tariff:create': 'Criar tarifa',
  'tariff:update': 'Editar tarifa',

  // ---- clientes ----
  'client:read': 'Ver todos os clientes',
  'client:read_own': 'Ver o próprio cadastro',
  'client:create': 'Cadastrar cliente',
  'client:update': 'Editar qualquer cliente',
  'client:update_own': 'Editar o próprio cadastro',

  // ---- viagens ----
  'trip:read': 'Ver todas as viagens',
  'trip:read_own': 'Ver as próprias viagens',
  'trip:create': 'Agendar viagem',
  'trip:update': 'Editar viagem',
  'trip:cancel': 'Cancelar viagem',
  'trip:complete': 'Concluir viagem',

  // ---- solicitações ----
  'request:read': 'Ver todas as solicitações',
  'request:read_own': 'Ver as próprias solicitações',
  'request:create_own': 'Solicitar voo',
  'request:review': 'Marcar solicitação em análise',
  'request:convert': 'Converter solicitação em viagem',
  'request:reject': 'Recusar solicitação',

  // ---- cobranças ----
  'charge:read': 'Ver todas as cobranças',
  'charge:read_own': 'Ver as próprias cobranças',
  'charge:create': 'Criar cobrança',

  // ---- pagamentos (o operacional NÃO tem nenhuma destas) ----
  'payment:read': 'Ver pagamentos',
  'payment:create': 'Registrar pagamento',
  'payment:settle': 'Dar baixa em cobrança',
  'payment:reverse': 'Estornar pagamento',

  // ---- bloqueios e agenda ----
  'block:read': 'Ver bloqueios e manutenções',
  'block:create': 'Criar bloqueio ou manutenção',
  'block:delete': 'Remover bloqueio',
  'availability:read_full': 'Ver a agenda completa',
  'availability:read_masked': 'Ver disponibilidade sem detalhes da frota',

  // ---- documentos de passageiro (dado sensível / LGPD) ----
  'document:read': 'Ver documentos de passageiros',
  'document:read_own': 'Ver os documentos dos próprios passageiros',
  'document:create_own': 'Enviar documento de passageiro',

  // ---- painéis ----
  'dashboard:operacional': 'Ver o painel operacional',
  'dashboard:financeiro': 'Ver o painel financeiro',
  'dashboard:cliente': 'Ver o painel do cliente',
  'report:financial': 'Ver relatórios financeiros',

  // ---- configuração e administração ----
  'settings:read': 'Ver configurações',
  'settings:update': 'Alterar configurações',
  'user:read': 'Ver usuários',
  'user:create': 'Criar usuário',
  'user:update': 'Editar usuário',
  'user:delete': 'Remover usuário',
  'role:read': 'Ver papéis e permissões',
  'role:update': 'Alterar permissões de um papel',
  'audit:read': 'Ver a trilha de auditoria',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function permissionParts(key: Permission): { resource: string; action: string } {
  const idx = key.indexOf(':');
  return { resource: key.slice(0, idx), action: key.slice(idx + 1) };
}

/**
 * Matriz papel → permissões (docs/PLANO.md §4.1).
 *
 * Os três limites que vêm do HANDOFF.md original:
 *   1. Operacional NÃO dá baixa      → nenhuma `payment:*` em `operacional`.
 *   2. Financeiro NÃO altera viagens → só `trip:read` em `financeiro`.
 *   3. Cliente só vê o próprio e nunca vê a frota → só sufixos `_own`, e
 *      nenhuma `aircraft:*` / `tariff:*`.
 */
export const ROLE_PERMISSIONS: Record<RoleKey, readonly Permission[]> = {
  operacional: [
    'aircraft:read',
    'aircraft:create',
    'aircraft:update',
    'aircraft:delete',
    'tariff:read',
    'tariff:create',
    'tariff:update',
    'client:read',
    'client:create',
    'client:update',
    'trip:read',
    'trip:create',
    'trip:update',
    'trip:cancel',
    'trip:complete',
    'request:read',
    'request:review',
    'request:convert',
    'request:reject',
    // Leitura de cobrança para ver a pendência do cliente antes de agendar.
    // Criar cobrança e dar baixa são do financeiro.
    'charge:read',
    'block:read',
    'block:create',
    'block:delete',
    'availability:read_full',
    'document:read',
    'dashboard:operacional',
    'settings:read',
    'settings:update',
  ],

  financeiro: [
    'client:read',
    'trip:read',
    'charge:read',
    'charge:create',
    'payment:read',
    'payment:create',
    'payment:settle',
    'payment:reverse',
    'dashboard:financeiro',
    'report:financial',
    'settings:read',
  ],

  cliente: [
    'client:read_own',
    'client:update_own',
    'trip:read_own',
    'request:read_own',
    'request:create_own',
    'charge:read_own',
    'availability:read_masked',
    'document:read_own',
    'document:create_own',
    'dashboard:cliente',
  ],

  admin: ALL_PERMISSIONS,
};

/**
 * Resolve as permissões efetivas: as do papel, mais overrides por usuário.
 *
 * `deny` sempre vence — inclusive sobre um `allow` explícito. Suspender um
 * acesso pontual não pode depender de a ordem dos registros estar certa.
 */
export function resolvePermissions(
  roleKey: RoleKey,
  overrides: readonly { permission: Permission; effect: 'allow' | 'deny' }[] = [],
): Set<Permission> {
  const effective = new Set<Permission>(ROLE_PERMISSIONS[roleKey]);
  for (const o of overrides) if (o.effect === 'allow') effective.add(o.permission);
  for (const o of overrides) if (o.effect === 'deny') effective.delete(o.permission);
  return effective;
}

/** Item de navegação — porte do `NAV` de `src/index.html`, agora com permissão. */
export interface NavItem {
  readonly label: string;
  readonly path: string;
  readonly icon: string;
  readonly hint: string;
  readonly permission: Permission;
}

export const NAV: Record<RoleKey, readonly NavItem[]> = {
  operacional: [
    {
      label: 'Dashboard',
      path: '/operacional',
      icon: 'LayoutDashboard',
      hint: 'Visão geral do dia',
      permission: 'dashboard:operacional',
    },
    {
      label: 'Agenda',
      path: '/operacional/agenda',
      icon: 'CalendarDays',
      hint: 'Calendário de voos',
      permission: 'availability:read_full',
    },
    {
      label: 'Solicitações',
      path: '/operacional/solicitacoes',
      icon: 'Inbox',
      hint: 'Pedidos dos clientes',
      permission: 'request:read',
    },
    {
      label: 'Viagens',
      path: '/operacional/viagens',
      icon: 'PlaneTakeoff',
      hint: 'Todas as viagens',
      permission: 'trip:read',
    },
    {
      label: 'Clientes',
      path: '/operacional/clientes',
      icon: 'Users',
      hint: 'Lista de clientes',
      permission: 'client:read',
    },
    {
      label: 'Aeronaves',
      path: '/operacional/aeronaves',
      icon: 'Plane',
      hint: 'Frota (uso interno)',
      permission: 'aircraft:read',
    },
    {
      label: 'Configurações',
      path: '/operacional/configuracoes',
      icon: 'Settings',
      hint: 'Tarifas e ajustes',
      permission: 'settings:read',
    },
  ],

  financeiro: [
    {
      label: 'Dashboard',
      path: '/financeiro',
      icon: 'LayoutDashboard',
      hint: 'Resumo financeiro',
      permission: 'dashboard:financeiro',
    },
    {
      label: 'Financeiro',
      path: '/financeiro/recebiveis',
      icon: 'Wallet',
      hint: 'Valores a receber',
      permission: 'charge:read',
    },
    {
      label: 'Cobranças',
      path: '/financeiro/cobrancas',
      icon: 'ReceiptText',
      hint: 'Criar e ver cobranças',
      permission: 'charge:read',
    },
    {
      label: 'Pagamentos',
      path: '/financeiro/pagamentos',
      icon: 'Banknote',
      hint: 'Registrar e dar baixa',
      permission: 'payment:read',
    },
    {
      label: 'Clientes',
      path: '/financeiro/clientes',
      icon: 'Users',
      hint: 'Situação de cada cliente',
      permission: 'client:read',
    },
    {
      label: 'Relatórios',
      path: '/financeiro/relatorios',
      icon: 'BarChart3',
      hint: 'Gráficos e números',
      permission: 'report:financial',
    },
  ],

  cliente: [
    {
      label: 'Início',
      path: '/cliente',
      icon: 'Home',
      hint: 'Sua página inicial',
      permission: 'dashboard:cliente',
    },
    {
      label: 'Solicitar Voo',
      path: '/cliente/solicitar',
      icon: 'Send',
      hint: 'Pedir um novo voo',
      permission: 'request:create_own',
    },
    {
      label: 'Disponibilidade',
      path: '/cliente/disponibilidade',
      icon: 'CalendarCheck',
      hint: 'Ver dias livres',
      permission: 'availability:read_masked',
    },
    {
      label: 'Minhas Viagens',
      path: '/cliente/viagens',
      icon: 'PlaneTakeoff',
      hint: 'Seus voos',
      permission: 'trip:read_own',
    },
    {
      label: 'Financeiro',
      path: '/cliente/financeiro',
      icon: 'Wallet',
      hint: 'Seus pagamentos',
      permission: 'charge:read_own',
    },
    {
      label: 'Meu Perfil',
      path: '/cliente/perfil',
      icon: 'User',
      hint: 'Seus dados',
      permission: 'client:read_own',
    },
  ],

  admin: [
    {
      label: 'Dashboard',
      path: '/operacional',
      icon: 'LayoutDashboard',
      hint: 'Visão geral do dia',
      permission: 'dashboard:operacional',
    },
    {
      label: 'Agenda',
      path: '/operacional/agenda',
      icon: 'CalendarDays',
      hint: 'Calendário de voos',
      permission: 'availability:read_full',
    },
    {
      label: 'Solicitações',
      path: '/operacional/solicitacoes',
      icon: 'Inbox',
      hint: 'Pedidos dos clientes',
      permission: 'request:read',
    },
    {
      label: 'Viagens',
      path: '/operacional/viagens',
      icon: 'PlaneTakeoff',
      hint: 'Todas as viagens',
      permission: 'trip:read',
    },
    {
      label: 'Clientes',
      path: '/operacional/clientes',
      icon: 'Users',
      hint: 'Lista de clientes',
      permission: 'client:read',
    },
    {
      label: 'Aeronaves',
      path: '/operacional/aeronaves',
      icon: 'Plane',
      hint: 'Frota (uso interno)',
      permission: 'aircraft:read',
    },
    {
      label: 'Financeiro',
      path: '/financeiro/recebiveis',
      icon: 'Wallet',
      hint: 'Valores a receber',
      permission: 'charge:read',
    },
    {
      label: 'Relatórios',
      path: '/financeiro/relatorios',
      icon: 'BarChart3',
      hint: 'Gráficos e números',
      permission: 'report:financial',
    },
    {
      label: 'Configurações',
      path: '/operacional/configuracoes',
      icon: 'Settings',
      hint: 'Tarifas e ajustes',
      permission: 'settings:read',
    },
  ],
};

/** Rota inicial por papel — protótipo: `HOME`. */
export const HOME_PATH: Record<RoleKey, string> = {
  operacional: '/operacional',
  financeiro: '/financeiro',
  cliente: '/cliente',
  admin: '/operacional',
};

/** Endereço da aba de liberação de acessos, com a aba já selecionada. */
export const PERMISSIONS_PATH = '/operacional/configuracoes?aba=permissoes';

/**
 * Para onde o clique numa notificação leva.
 *
 * `Notification.entity` + `entityId` existem no schema desde o começo com este
 * propósito ("destino do clique"), e até agora nada os usava — o sino mostrava
 * texto morto. O aviso que não leva a lugar nenhum obriga a pessoa a lembrar
 * onde a coisa mora, e é o tipo de detalhe que faz um recurso parecer
 * inacabado.
 *
 * Por PAPEL, e não "interno vs. cliente": a mesma cobrança fica em
 * `/financeiro/cobrancas` para o financeiro, em `/financeiro/recebiveis` para o
 * admin (é o que o menu dele tem) e em `/cliente/financeiro` para o cliente. O
 * operacional não tem tela de cobrança nenhuma — ele LÊ cobrança pela API, para
 * ver pendência antes de agendar, mas não tem a página; então não ganha link.
 *
 * A primeira versão disto tratava só "cliente ou não" e mandava o operacional
 * para `/financeiro/cobrancas`, que exige `charge:create` — permissão que ele não
 * tem. O clique cairia em "Acesso não permitido". O teste
 * `todo destino interno é uma rota que o papel alcança` existe por causa desse
 * erro: todo destino aqui tem de ser um item do MENU daquele papel, o que garante
 * de uma vez a permissão e a chance de a pessoa reencontrar a tela depois.
 *
 * Papel ausente no mapa = sem tela correspondente; o item aparece no sino, mas
 * não clicável. Melhor que um link que dá 403.
 */
const NOTIFICATION_TARGETS: Record<string, Partial<Record<RoleKey, string>>> = {
  // Só quem tem `user:read` recebe este aviso, o que na matriz é só o admin.
  user: { admin: PERMISSIONS_PATH },

  request: {
    operacional: '/operacional/solicitacoes',
    admin: '/operacional/solicitacoes',
    // O cliente não tem lista de solicitações; a página inicial mostra as
    // últimas.
    cliente: '/cliente',
  },

  trip: {
    operacional: '/operacional/viagens',
    admin: '/operacional/viagens',
    cliente: '/cliente/viagens',
  },

  charge: {
    financeiro: '/financeiro/cobrancas',
    admin: '/financeiro/recebiveis',
    cliente: '/cliente/financeiro',
  },

  payment: {
    financeiro: '/financeiro/pagamentos',
    admin: '/financeiro/recebiveis',
    cliente: '/cliente/financeiro',
  },

  client: {
    operacional: '/operacional/clientes',
    financeiro: '/financeiro/clientes',
    admin: '/operacional/clientes',
    cliente: '/cliente/perfil',
  },
};

/** Destino do clique, ou `null` quando o papel não tem tela para a entidade. */
export function notificationPath(entity: string | null, role: RoleKey): string | null {
  if (entity === null) return null;
  return NOTIFICATION_TARGETS[entity]?.[role] ?? null;
}
