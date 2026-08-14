/**
 * Login, autocadastro e troca de senha.
 *
 * Substitui o `Login` de fachada do protótipo, que só chamava
 * `setTimeout(onEnter, 400)` e deixava a escolha de perfil para um `<select>`
 * no cabeçalho. Agora o perfil vem do banco.
 *
 * O cadastro fica na MESMA tela, alternado por um botão, e não em uma rota
 * separada: é o pedido — "precisa na tela principal para se registrar" — e evita
 * que alguém chegue em `/cadastrar` por link antigo depois de o autocadastro ser
 * desligado. Quem se cadastra sai com a conta `pendente`; o acesso só existe
 * como Cliente, e já entra — o alcance de cliente é fechado no próprio cadastro.
 */

import { HOME_PATH, registerBodySchema, type RegisterResponse } from '@acm/shared';
import { useState } from 'react';
import type { JSX } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import { Btn, Field, Icon, Input, Spinner } from '../components/ui';
import { api, ApiRequestError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFeedback } from '../lib/feedback';
import { useFormErrors, validateBody } from '../lib/form';

type Mode = 'login' | 'register';

export function LoginPage(): JSX.Element {
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<Mode>('login');

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

          {mode === 'login' ? (
            <LoginForm
              onRegister={() => {
                setMode('register');
              }}
            />
          ) : (
            <RegisterForm
              onBack={() => {
                setMode('login');
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function LoginForm({ onRegister }: { onRegister: () => void }): JSX.Element {
  const { login } = useAuth();
  const navigate = useNavigate();
  const { notifyError } = useFeedback();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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
    <>
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

      <div className="mt-6 border-t border-line pt-5 text-center text-sm text-sub">
        Ainda não tem acesso?{' '}
        <button
          type="button"
          onClick={onRegister}
          className="font-medium text-primary hover:underline"
        >
          Criar cadastro
        </button>
      </div>
    </>
  );
}

/**
 * Formulário de cadastro: nome, e-mail e senha.
 *
 * Não pede papel nem perfil — quem se cadastra não escolhe o próprio nível de
 * acesso. A confirmação de senha existe só na tela: o contrato do backend tem um
 * campo de senha, e comparar os dois aqui evita o cadastro com senha digitada
 * errada, que ninguém consegue desfazer sem o administrador.
 */
function RegisterForm({ onBack }: { onBack: () => void }): JSX.Element {
  const { notifyError } = useFeedback();
  const { errors, setErrors, setServerErrors, clearAll } = useFormErrors();

  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const set = (field: keyof typeof form, value: string): void => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const mismatch = confirmation !== '' && form.password !== confirmation;

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();

    // Mesmo schema que a rota usa: se passar aqui, passa lá.
    const result = validateBody(registerBodySchema, form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    if (form.password !== confirmation) {
      setErrors({ confirmation: 'As senhas não conferem.' });
      return;
    }

    clearAll();
    setSubmitting(true);
    try {
      const response = await api.post<RegisterResponse>('/auth/register', result.data);
      setSent(response.message);
    } catch (error) {
      if (error instanceof ApiRequestError) setServerErrors(error.details);
      notifyError(error, 'Não foi possível enviar o cadastro.');
    } finally {
      setSubmitting(false);
    }
  };

  if (sent !== null) {
    return (
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-success-soft text-success">
          <Icon name="CheckCircle2" size={24} />
        </div>
        <h2 className="mt-4 text-xl font-semibold tracking-tight">Cadastro enviado</h2>
        <p className="mt-2 text-sm leading-relaxed text-sub">{sent}</p>
        <Btn variant="outline" className="mt-6 w-full" onClick={onBack}>
          <Icon name="ArrowLeft" size={16} /> Voltar para o login
        </Btn>
      </div>
    );
  }

  return (
    <>
      <h2 className="text-2xl font-semibold tracking-tight">Criar cadastro</h2>
      <p className="mt-1.5 text-sm text-sub">
        Preencha seus dados. O administrador libera o acesso e você recebe o aviso para entrar.
      </p>

      <form
        onSubmit={(e) => {
          void submit(e);
        }}
        className="mt-8 space-y-5"
      >
        <Field label="Nome completo" required error={errors['name']}>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub">
              <Icon name="User" size={16} />
            </span>
            <Input
              autoComplete="name"
              required
              value={form.name}
              onChange={(e) => {
                set('name', e.target.value);
              }}
              className="pl-9"
              placeholder="Seu nome"
            />
          </div>
        </Field>

        <Field label="E-mail" required error={errors['email']}>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub">
              <Icon name="Mail" size={16} />
            </span>
            <Input
              type="email"
              autoComplete="email"
              required
              value={form.email}
              onChange={(e) => {
                set('email', e.target.value);
              }}
              className="pl-9"
              placeholder="voce@empresa.com.br"
            />
          </div>
        </Field>

        <Field
          label="Senha"
          required
          help="Escolha a senha que preferir — não há exigência de tamanho nem de formato."
          error={errors['password']}
        >
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub">
              <Icon name="Lock" size={16} />
            </span>
            <Input
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              required
              value={form.password}
              onChange={(e) => {
                set('password', e.target.value);
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

        <Field
          label="Confirme a senha"
          required
          error={mismatch ? 'As senhas não conferem.' : errors['confirmation']}
        >
          <Input
            type="password"
            autoComplete="new-password"
            required
            value={confirmation}
            onChange={(e) => {
              setConfirmation(e.target.value);
            }}
          />
        </Field>

        <Btn type="submit" size="lg" className="w-full" disabled={submitting || mismatch}>
          {submitting ? (
            <>
              <Spinner /> Enviando…
            </>
          ) : (
            <>
              Enviar cadastro <Icon name="ArrowRight" size={16} />
            </>
          )}
        </Btn>
      </form>

      <div className="mt-6 border-t border-line pt-5 text-center text-sm text-sub">
        Já tem acesso?{' '}
        <button type="button" onClick={onBack} className="font-medium text-primary hover:underline">
          Entrar
        </button>
      </div>
    </>
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
            help="Escolha a senha que preferir — não há exigência de tamanho nem de formato."
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
