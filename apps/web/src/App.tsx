/**
 * Rotas.
 *
 * Substitui o `switch (page)` de `renderPage` do protótipo por rotas reais —
 * agora cada tela tem URL própria, o botão voltar funciona e dá para mandar um
 * link direto para alguém.
 *
 * `RequirePermission` esconde o que o usuário não pode ver. É UX: o servidor
 * recusa de qualquer forma, e é ele quem decide.
 */

import { HOME_PATH, type Permission } from '@acm/shared';
import type { JSX, ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { Shell } from './components/Shell';
import { Empty, Loading } from './components/ui';
import { useAuth } from './lib/auth';
import { ClientesPage } from './pages/clientes';
import {
  CliDisponibilidade,
  CliFinanceiro,
  CliInicio,
  CliPerfil,
  CliSolicitar,
  CliViagens,
} from './pages/cliente';
import {
  FinCobrancas,
  FinDashboard,
  FinPagamentos,
  FinRecebiveis,
  FinRelatorios,
} from './pages/financeiro';
import { ChangePasswordPage, LoginPage } from './pages/Login';
import {
  OpAeronaves,
  OpAgenda,
  OpConfiguracoes,
  OpDashboard,
  OpSolicitacoes,
  OpViagens,
} from './pages/operacional';

function RequireAuth({ children }: { children: ReactNode }): JSX.Element {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Loading label="Restaurando sessão…" />;
  if (user === null) return <Navigate to="/login" state={{ from: location }} replace />;

  // Senha provisória: nenhuma outra tela abre antes da troca. O backend aplica
  // a mesma regra, então não adianta digitar a URL na mão.
  if (user.mustChangePassword && location.pathname !== '/trocar-senha') {
    return <Navigate to="/trocar-senha" replace />;
  }

  return <>{children}</>;
}

function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}): JSX.Element {
  const { can } = useAuth();

  if (!can(permission)) {
    return (
      <Empty
        icon="ShieldAlert"
        title="Acesso não permitido"
        desc="Seu perfil não tem permissão para esta tela."
      />
    );
  }

  return <>{children}</>;
}

/** Redireciona a raiz para a página inicial do papel. */
function HomeRedirect(): JSX.Element {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (user === null) return <Navigate to="/login" replace />;
  return <Navigate to={HOME_PATH[user.role]} replace />;
}

export function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/trocar-senha"
        element={
          <RequireAuth>
            <ChangePasswordPage />
          </RequireAuth>
        }
      />

      <Route
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<HomeRedirect />} />

        {/* -------------------------------------------------- Operacional */}
        <Route
          path="/operacional"
          element={
            <RequirePermission permission="dashboard:operacional">
              <OpDashboard />
            </RequirePermission>
          }
        />
        <Route
          path="/operacional/agenda"
          element={
            <RequirePermission permission="availability:read_full">
              <OpAgenda />
            </RequirePermission>
          }
        />
        <Route
          path="/operacional/solicitacoes"
          element={
            <RequirePermission permission="request:read">
              <OpSolicitacoes />
            </RequirePermission>
          }
        />
        <Route
          path="/operacional/viagens"
          element={
            <RequirePermission permission="trip:read">
              <OpViagens />
            </RequirePermission>
          }
        />
        <Route
          path="/operacional/clientes"
          element={
            <RequirePermission permission="client:read">
              <ClientesPage desc="Consulte clientes, viagens e pendências financeiras." />
            </RequirePermission>
          }
        />
        <Route
          path="/operacional/aeronaves"
          element={
            <RequirePermission permission="aircraft:read">
              <OpAeronaves />
            </RequirePermission>
          }
        />
        <Route
          path="/operacional/configuracoes"
          element={
            <RequirePermission permission="settings:read">
              <OpConfiguracoes />
            </RequirePermission>
          }
        />

        {/* --------------------------------------------------- Financeiro */}
        <Route
          path="/financeiro"
          element={
            <RequirePermission permission="dashboard:financeiro">
              <FinDashboard />
            </RequirePermission>
          }
        />
        <Route
          path="/financeiro/recebiveis"
          element={
            <RequirePermission permission="charge:read">
              <FinRecebiveis />
            </RequirePermission>
          }
        />
        <Route
          path="/financeiro/cobrancas"
          element={
            <RequirePermission permission="charge:create">
              <FinCobrancas />
            </RequirePermission>
          }
        />
        <Route
          path="/financeiro/pagamentos"
          element={
            <RequirePermission permission="payment:read">
              <FinPagamentos />
            </RequirePermission>
          }
        />
        <Route
          path="/financeiro/clientes"
          element={
            <RequirePermission permission="client:read">
              <ClientesPage desc="Situação financeira e histórico de cada cliente." />
            </RequirePermission>
          }
        />
        <Route
          path="/financeiro/relatorios"
          element={
            <RequirePermission permission="report:financial">
              <FinRelatorios />
            </RequirePermission>
          }
        />

        {/* ------------------------------------------------------ Cliente */}
        <Route
          path="/cliente"
          element={
            <RequirePermission permission="dashboard:cliente">
              <CliInicio />
            </RequirePermission>
          }
        />
        <Route
          path="/cliente/solicitar"
          element={
            <RequirePermission permission="request:create_own">
              <CliSolicitar />
            </RequirePermission>
          }
        />
        <Route
          path="/cliente/disponibilidade"
          element={
            <RequirePermission permission="availability:read_masked">
              <CliDisponibilidade />
            </RequirePermission>
          }
        />
        <Route
          path="/cliente/viagens"
          element={
            <RequirePermission permission="trip:read_own">
              <CliViagens />
            </RequirePermission>
          }
        />
        <Route
          path="/cliente/financeiro"
          element={
            <RequirePermission permission="charge:read_own">
              <CliFinanceiro />
            </RequirePermission>
          }
        />
        <Route
          path="/cliente/perfil"
          element={
            <RequirePermission permission="client:read_own">
              <CliPerfil />
            </RequirePermission>
          }
        />

        <Route
          path="*"
          element={
            <Empty
              icon="MapPinOff"
              title="Página não encontrada"
              desc="O endereço acessado não existe."
            />
          }
        />
      </Route>
    </Routes>
  );
}
