/**
 * Login e troca de senha.
 *
 * Substitui o `Login` de fachada do protótipo, que só chamava
 * `setTimeout(onEnter, 400)` e deixava a escolha de perfil para um `<select>`
 * no cabeçalho. Agora o perfil vem do banco.
 */

import { HOME_PATH } from '@acm/shared';
import { useState } from 'react';
import type { JSX } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import { Btn, Field, Icon, Input, Spinner } from '../components/ui';
import { api, ApiRequestError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFeedback } from '../lib/feedback';

export function LoginPage(): JSX.Element {
  const { login, user, loading } = useAuth();
  const navigate = useNavigate();
  const { notifyError } = useFeedback();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="text-primary" />
      </div>
    );
  }

  if (user !== null) {
    return (
      <Navigate to={user.mustChangePassword ? '/trocar-senha' : HOME_PATH[user.role]} replace />
    );
  }

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const session = await login(email.trim(), password);
      void navigate(session.mustChangePassword ? '/trocar-senha' : HOME_PATH[session.role], {
        replace: true,
      });
    } catch (error) {
      notifyError(error, 'Não foi possível entrar.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div
        className="relative hidden overflow-hidden lg:block"
        style={{ background: 'radial-gradient(120% 120% at 0% 0%, #3B5E7E 0%, #24405A 60%)' }}
      >
        <div className="absolute -right-16 -top-16 h-72 w-72 rounded-full bg-white/5" />
        <div className="absolute bottom-10 left-10 h-40 w-40 rounded-full bg-white/5" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
              <Icon name="Plane" size={20} />
            </div>
            <span className="text-lg font-semibold tracking-tight">Air Charter Manager</span>
          </div>
          <div className="max-w-md">
            <h1 className="text-3xl font-semibold leading-tight tracking-tight">
              Gestão inteligente de voos executivos
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-white/70">
              Organize agendas, aeronaves, solicitações e o financeiro do seu táxi aéreo em um só
              lugar.
            </p>
            <div className="mt-8 flex items-center gap-2 text-xs text-white/60">
              <Icon name="ShieldCheck" size={16} /> Acesso restrito · sessão protegida
            </div>
          </div>
          <div className="text-xs text-white/40">© 2026 Air Charter Manager</div>
        </div>
      </div>

      <div className="flex items-center justify-center bg-bg p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white">
              <Icon name="Plane" size={20} />
            </div>
            <span className="text-lg font-semibold tracking-tight">Air Charter Manager</span>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight">Bem-vindo de volta</h2>
          <p className="mt-1.5 text-sm text-sub">Entre para acessar o painel.</p>

          <form
            onSubmit={(e) => {
              void submit(e);
            }}
            className="mt-8 space-y-5"
          >
            <Field label="E-mail" required>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub">
                  <Icon name="Mail" size={16} />
                </span>
                <Input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                  }}
                  className="pl-9"
                  placeholder="voce@empresa.com.br"
                />
              </div>
            </Field>

            <Field label="Senha" required>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub">
                  <Icon name="Lock" size={16} />
                </span>
                <Input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                  }}
                  className="pl-9 pr-10"
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  onClick={() => {
                    setShowPassword((v) => !v);
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-sub hover:text-ink"
                >
                  <Icon name={showPassword ? 'EyeOff' : 'Eye'} size={16} />
                </button>
              </div>
            </Field>

            <Btn type="submit" size="lg" className="w-full" disabled={submitting}>
              {submitting ? (
                <>
                  <Spinner /> Entrando…
                </>
              ) : (
                <>
                  Entrar <Icon name="ArrowRight" size={16} />
                </>
              )}
            </Btn>
          </form>
        </div>
      </div>
    </div>
  );
}

/**
 * Troca de senha.
 *
 * Obrigatória no primeiro acesso de quem recebeu senha provisória — o backend
 * bloqueia todas as outras rotas enquanto `mustChangePassword` for verdadeiro
 * (docs/PLANO.md §12.2).
 */
export function ChangePasswordPage(): JSX.Element {
  const { user, refresh, logout } = useAuth();
  const { notify, notifyError } = useFeedback();
  const navigate = useNavigate();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const mismatch = confirmation !== '' && next !== confirmation;
  const tooShort = next !== '' && next.length < 10;
  const valid = current !== '' && next.length >= 10 && next === confirmation;

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!valid) return;

    setSubmitting(true);
    try {
      await api.post('/auth/change-password', {
        currentPassword: current,
        newPassword: next,
      });
      notify('success', 'Senha alterada', 'Entre novamente com a nova senha.');
      await logout();
      void navigate('/login', { replace: true });
    } catch (error) {
      if (error instanceof ApiRequestError) notifyError(error);
      else notifyError(error, 'Não foi possível alterar a senha.');
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-md items-center justify-center p-6">
      <div className="w-full">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white">
            <Icon name="KeyRound" size={20} />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Trocar senha</h1>
            <p className="text-sm text-sub">{user?.email}</p>
          </div>
        </div>

        {user?.mustChangePassword === true && (
          <div className="mb-5 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning-soft p-4">
            <span className="text-warning">
              <Icon name="AlertTriangle" size={20} />
            </span>
            <p className="text-sm">
              Você está usando uma senha provisória. Defina uma senha própria para continuar.
            </p>
          </div>
        )}

        <form
          onSubmit={(e) => {
            void submit(e);
          }}
          className="space-y-4 rounded-xl border border-line bg-white p-5 shadow-card"
        >
          <Field label="Senha atual" required>
            <Input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => {
                setCurrent(e.target.value);
              }}
            />
          </Field>

          <Field
            label="Nova senha"
            required
            help="Mínimo de 10 caracteres, com ao menos uma letra e um número."
            error={tooShort ? 'A senha precisa de pelo menos 10 caracteres.' : undefined}
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => {
                setNext(e.target.value);
              }}
            />
          </Field>

          <Field
            label="Confirme a nova senha"
            required
            error={mismatch ? 'As senhas não conferem.' : undefined}
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(e) => {
                setConfirmation(e.target.value);
              }}
            />
          </Field>

          <div className="flex gap-2 pt-1">
            <Btn type="submit" className="flex-1" disabled={!valid || submitting}>
              {submitting ? <Spinner /> : <Icon name="Save" size={16} />} Salvar
            </Btn>
            {user?.mustChangePassword !== true && (
              <Btn
                variant="outline"
                onClick={() => {
                  void refresh().then(() => {
                    void navigate(-1);
                  });
                }}
              >
                Cancelar
              </Btn>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
