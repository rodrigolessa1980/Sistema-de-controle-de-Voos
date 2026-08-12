/**
 * Sessão e autorização no cliente.
 *
 * Substitui o `RoleSwitcher` ("Visualizar como") do protótipo: o perfil agora
 * vem do login, não de um `<select>` no cabeçalho.
 *
 * `can()` serve para esconder botão — é UX, não segurança. Toda decisão real é
 * do servidor, que recusa com 403 mesmo que a interface deixe clicar.
 */

import type { LoginResponse, Permission, RoleKey, SessionUser } from '@acm/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { JSX, ReactNode } from 'react';

import { api, setAccessToken, setSessionLostHandler } from './api';

interface AuthState {
  readonly user: SessionUser | null;
  readonly loading: boolean;
  readonly login: (email: string, password: string) => Promise<SessionUser>;
  readonly logout: () => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly can: (permission: Permission) => boolean;
  readonly canAny: (...permissions: Permission[]) => boolean;
  readonly role: RoleKey | null;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * Na carga da página tenta restaurar a sessão pelo cookie httpOnly.
   *
   * Falhar aqui é o caso normal de quem não está logado — não é erro.
   */
  useEffect(() => {
    let cancelled = false;

    const restore = async (): Promise<void> => {
      try {
        const session = await api.post<LoginResponse>('/auth/refresh');
        if (cancelled) return;
        setAccessToken(session.accessToken);
        setUser(session.user);
      } catch {
        if (!cancelled) {
          setAccessToken(null);
          setUser(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  // Se o refresh automático do api.ts falhar, a sessão caiu de vez.
  useEffect(() => {
    setSessionLostHandler(() => {
      setUser(null);
    });
    return () => {
      setSessionLostHandler(null);
    };
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<SessionUser> => {
    const session = await api.post<LoginResponse>('/auth/login', { email, password });
    setAccessToken(session.accessToken);
    setUser(session.user);
    return session.user;
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await api.post('/auth/logout');
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    const me = await api.get<SessionUser>('/auth/me');
    setUser(me);
  }, []);

  // Set para consulta O(1): `can()` roda em toda renderização de menu e botão.
  const permissions = useMemo(() => new Set(user?.permissions ?? []), [user]);

  const can = useCallback(
    (permission: Permission): boolean => permissions.has(permission),
    [permissions],
  );

  const canAny = useCallback(
    (...list: Permission[]): boolean => list.some((p) => permissions.has(p)),
    [permissions],
  );

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      login,
      logout,
      refresh,
      can,
      canAny,
      role: user?.role ?? null,
    }),
    [user, loading, login, logout, refresh, can, canAny],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (context === null) throw new Error('useAuth precisa estar dentro de <AuthProvider>');
  return context;
}

/** O usuário autenticado, ou erro. Para telas que só existem logado. */
export function useSessionUser(): SessionUser {
  const { user } = useAuth();
  if (user === null) throw new Error('Sessão não disponível nesta tela');
  return user;
}
