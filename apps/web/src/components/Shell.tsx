/**
 * Layout autenticado — protótipo: `SidebarInner`, `Header` e o `App`.
 *
 * Diferenças em relação ao protótipo:
 *   - a navegação é filtrada por PERMISSÃO, não pelo papel escolhido num
 *     `<select>`;
 *   - o sino de notificações funciona;
 *   - o seletor "Visualizar como" não existe mais: o perfil vem do login.
 */

import { HOME_PATH, NAV, notificationPath, ROLE_LABELS, type NavItem } from '@acm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { queryKeys } from '../lib/query-keys';
import { useChangeFeed } from '../lib/use-change-feed';
import { Avatar, Btn, Icon, Loading } from './ui';

interface NotificationList {
  items: {
    id: string;
    type: string;
    title: string;
    body: string | null;
    /** Destino do clique, junto com `entityId` — ver `notificationPath`. */
    entity: string | null;
    entityId: string | null;
    readAt: string | null;
    createdAt: string;
  }[];
  unread: number;
}

export function Shell(): JSX.Element {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // O polling de 10s vive aqui: uma instância para o app inteiro.
  useChangeFeed(user !== null);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  if (user === null) return <Loading label="Restaurando sessão…" />;

  const items = NAV[user.role].filter((item) => can(item.permission));

  const handleLogout = (): void => {
    void logout().then(() => {
      void navigate('/login', { replace: true });
    });
  };

  return (
    <div className="flex min-h-screen bg-bg">
      <aside className="hidden w-64 shrink-0 border-r border-line bg-white lg:block">
        <div className="sticky top-0 h-screen">
          <SidebarInner items={items} roleLabel={ROLE_LABELS[user.role]} />
        </div>
      </aside>

      {/* Drawer no mobile */}
      <div className={`fixed inset-0 z-50 lg:hidden ${mobileOpen ? '' : 'pointer-events-none'}`}>
        <div
          className={`absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] transition-opacity ${
            mobileOpen ? 'opacity-100' : 'opacity-0'
          }`}
          onClick={() => {
            setMobileOpen(false);
          }}
        />
        <div
          className={`absolute left-0 top-0 h-full w-72 bg-white shadow-pop transition-transform duration-300 ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => {
              setMobileOpen(false);
            }}
            className="absolute right-3 top-4 rounded-md p-1 text-sub hover:bg-soft"
          >
            <Icon name="X" size={20} />
          </button>
          <SidebarInner items={items} roleLabel={ROLE_LABELS[user.role]} />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          items={items}
          onMenu={() => {
            setMobileOpen(true);
          }}
          onLogout={handleLogout}
        />
        <main className="flex-1 px-4 py-5 sm:px-6 sm:py-6 lg:px-8 xl:px-10">
          <div className="w-full animate-fade" key={location.pathname}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function SidebarInner({
  items,
  roleLabel,
}: {
  items: readonly NavItem[];
  roleLabel: string;
}): JSX.Element {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2.5 px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-white">
          <Icon name="Plane" size={18} />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight">Air Charter</p>
          <p className="text-[11px] text-sub">Manager</p>
        </div>
      </div>

      <div className="px-3">
        <div className="rounded-lg bg-soft/70 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-sub">
          Perfil {roleLabel}
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {items.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path.split('/').length <= 2}
            title={item.hint}
            className={({ isActive }) =>
              `flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium ${
                isActive ? 'bg-primary/10 text-primary' : 'text-sub hover:bg-soft hover:text-ink'
              }`
            }
          >
            <Icon name={item.icon} size={18} />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function Header({
  items,
  onMenu,
  onLogout,
}: {
  items: readonly NavItem[];
  onMenu: () => void;
  onLogout: () => void;
}): JSX.Element {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
    };
  }, []);

  const notifications = useQuery({
    queryKey: queryKeys.notifications,
    queryFn: () => api.get<NotificationList>('/notifications', { limit: 10 }),
    enabled: user !== null,
  });

  const markAllRead = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications }),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications }),
  });

  /**
   * Clique numa notificação: fecha o painel, marca como lida e navega.
   *
   * A navegação NÃO espera o `read` terminar. O destino é o que a pessoa pediu;
   * marcar como lida é contabilidade, e prender a tela a uma requisição de
   * contabilidade faz um clique parecer travado. Se o `read` falhar, o item volta
   * a aparecer não lido no próximo ciclo — que é o comportamento correto para uma
   * falha de escrita.
   */
  const openNotification = (item: NotificationList['items'][number]): void => {
    setBellOpen(false);
    if (item.readAt === null) markRead.mutate(item.id);

    const to = user === null ? null : notificationPath(item.entity, user.role);
    if (to !== null) void navigate(to);
  };

  const current = items.find(
    (item) => location.pathname === item.path || location.pathname.startsWith(`${item.path}/`),
  );
  const unread = notifications.data?.unread ?? 0;

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur-md sm:px-6">
      <button
        type="button"
        aria-label="Abrir menu"
        onClick={onMenu}
        className="rounded-lg p-2 text-sub hover:bg-soft lg:hidden"
      >
        <Icon name="Menu" size={20} />
      </button>

      <p className="hidden truncate text-sm font-semibold sm:block">{current?.label ?? ''}</p>

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <div className="relative" ref={bellRef}>
          <button
            type="button"
            aria-label={`Notificações${unread > 0 ? ` (${unread} não lidas)` : ''}`}
            onClick={() => {
              setBellOpen((o) => !o);
            }}
            className="relative rounded-lg p-2 text-sub hover:bg-soft"
          >
            <Icon name="Bell" size={18} />
            {unread > 0 && (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger ring-2 ring-bg" />
            )}
          </button>

          {bellOpen && (
            <div className="absolute right-0 z-40 mt-1 max-h-96 w-80 overflow-y-auto rounded-lg border border-line bg-white p-1 shadow-pop animate-fade">
              <div className="flex items-center justify-between px-2.5 py-1.5">
                <p className="text-xs font-semibold text-sub">Notificações</p>
                {unread > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      markAllRead.mutate();
                    }}
                    className="text-xs text-primary hover:underline"
                  >
                    Marcar todas como lidas
                  </button>
                )}
              </div>
              <div className="my-1 h-px bg-line" />
              {(notifications.data?.items ?? []).length === 0 ? (
                <p className="px-2.5 py-6 text-center text-sm text-sub">Nada por aqui.</p>
              ) : (
                (notifications.data?.items ?? []).map((n) => {
                  const to = user === null ? null : notificationPath(n.entity, user.role);
                  const unreadItem = n.readAt === null;

                  // Sem destino para este papel, o item vira texto: um link que
                  // cai em "Acesso não permitido" é pior que nenhum link.
                  if (to === null) {
                    return (
                      <div
                        key={n.id}
                        className={`rounded-md px-2.5 py-2 ${unreadItem ? 'bg-primary-soft/40' : ''}`}
                      >
                        <p className="text-sm font-medium">{n.title}</p>
                        {n.body !== null && <p className="text-xs text-sub">{n.body}</p>}
                      </div>
                    );
                  }

                  return (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => {
                        openNotification(n);
                      }}
                      className={`flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left hover:bg-soft ${
                        unreadItem ? 'bg-primary-soft/40' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{n.title}</p>
                        {n.body !== null && <p className="truncate text-xs text-sub">{n.body}</p>}
                      </div>
                      <span className="mt-0.5 shrink-0 text-sub">
                        <Icon name="ChevronRight" size={14} />
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => {
              setMenuOpen((o) => !o);
            }}
            className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-soft"
          >
            <Avatar name={user?.name ?? '?'} />
            <span className="hidden text-sm font-medium sm:inline">{user?.name}</span>
          </button>

          {menuOpen && (
            <div className="absolute right-0 z-40 mt-1 w-56 rounded-lg border border-line bg-white p-1 shadow-pop animate-fade">
              <div className="px-2.5 py-1.5">
                <p className="text-sm font-semibold">{user?.name}</p>
                <p className="text-xs text-sub">{user?.email}</p>
              </div>
              <div className="my-1 h-px bg-line" />
              <NavLink
                to="/trocar-senha"
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-ink hover:bg-soft"
              >
                <Icon name="KeyRound" size={16} /> Trocar senha
              </NavLink>
              <button
                type="button"
                onClick={onLogout}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-danger hover:bg-danger-soft"
              >
                <Icon name="LogOut" size={16} /> Sair
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

/** Rota de destino após o login, conforme o papel. */
export function homePathFor(role: keyof typeof HOME_PATH): string {
  return HOME_PATH[role];
}

export { Btn };
