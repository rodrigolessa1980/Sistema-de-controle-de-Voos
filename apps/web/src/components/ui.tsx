/**
 * Primitivos de UI — porte fiel dos componentes de `src/index.html`.
 *
 * As classes Tailwind são as mesmas do protótipo, de propósito: a aparência do
 * sistema não muda na migração. O que muda é que agora são componentes
 * tipados, com props checadas em compilação.
 */

import {
  AIRCRAFT_STATUS_LABELS,
  CHARGE_STATUS_LABELS,
  FINANCIAL_STATUS_LABELS,
  initials,
  REQUEST_STATUS_LABELS,
  TRIP_STATUS_LABELS,
  USER_STATUS_LABELS,
  type AircraftStatus,
  type ChargeStatus,
  type ClientFinancialStatus,
  type FlightRequestStatus,
  type TripStatus,
  type UserStatus,
} from '@acm/shared';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Ban,
  Banknote,
  BarChart3,
  Bell,
  Building2,
  Calculator,
  Calendar,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardCheck,
  Clock,
  Clock3,
  CreditCard,
  Eye,
  EyeOff,
  HelpCircle,
  History,
  Home,
  ImageOff,
  Inbox,
  Info,
  KeyRound,
  LayoutDashboard,
  Lock,
  LogOut,
  Mail,
  MapPin,
  MapPinOff,
  Menu as MenuIcon,
  MoreVertical,
  Pencil,
  Phone,
  PieChart,
  Plane,
  PlaneTakeoff,
  Plus,
  ReceiptText,
  RefreshCw,
  ReceiptText as Receipt,
  Save,
  Search,
  Send,
  Settings,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  TrendingUp,
  User,
  UserPlus,
  Users,
  Wallet,
  Wrench,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import type { JSX } from 'react';

// ============================================================================
//  ÍCONE
// ============================================================================

/**
 * Registro explícito dos ícones usados.
 *
 * `import * as Lucide` funcionaria, mas arrasta a biblioteca inteira para o
 * bundle — eram ~900 kB só de ícones, dos quais usamos algumas dezenas. Com
 * imports nomeados o tree-shaking entra e sobra só o que aparece aqui.
 *
 * O acesso continua por string porque a navegação (`@acm/shared`) guarda o nome
 * do ícone como dado, não como componente.
 */
const ICONS: Record<string, LucideIcon> = {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Ban,
  Banknote,
  BarChart3,
  Bell,
  Building2,
  Calculator,
  Calendar,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardCheck,
  Clock,
  Clock3,
  CreditCard,
  Eye,
  EyeOff,
  HelpCircle,
  History,
  Home,
  ImageOff,
  Inbox,
  Info,
  KeyRound,
  LayoutDashboard,
  Lock,
  LogOut,
  Mail,
  MapPin,
  MapPinOff,
  Menu: MenuIcon,
  MoreVertical,
  Pencil,
  Phone,
  PieChart,
  Plane,
  PlaneTakeoff,
  Plus,
  Receipt,
  ReceiptText,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  TrendingUp,
  User,
  UserPlus,
  Users,
  Wallet,
  Wrench,
  X,
  XCircle,
};

export type IconName = keyof typeof ICONS;

/**
 * Ícone por nome.
 *
 * Nome desconhecido cai em `Circle`, como no protótipo — a interface não quebra
 * por causa de um ícone.
 */
export function Icon({
  name,
  size = 18,
  className = '',
}: {
  name: string;
  size?: number;
  className?: string;
}): JSX.Element {
  const Component = ICONS[name] ?? Circle;
  return <Component size={size} className={className} aria-hidden="true" />;
}

// ============================================================================
//  BOTÃO
// ============================================================================

type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'md' | 'sm' | 'lg' | 'icon' | 'xs';

const BTN_BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap';

const BTN_SIZES: Record<ButtonSize, string> = {
  md: 'h-10 px-4 text-sm',
  sm: 'h-9 px-3 text-sm',
  lg: 'h-11 px-6 text-base',
  icon: 'h-9 w-9',
  xs: 'h-8 w-8',
};

const BTN_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-white shadow-card hover:bg-primary/90',
  outline: 'border border-line bg-white text-ink shadow-card hover:bg-soft',
  ghost: 'text-sub hover:bg-soft hover:text-ink',
  danger: 'bg-danger text-white shadow-card hover:bg-danger/90',
  success: 'bg-success text-white shadow-card hover:bg-success/90',
};

export function Btn({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`${BTN_BASE} ${BTN_SIZES[size]} ${BTN_VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

// ============================================================================
//  ESTRUTURA
// ============================================================================

export function Card({
  className = '',
  children,
}: {
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className={`rounded-xl border border-line bg-white shadow-card ${className}`}>
      {children}
    </div>
  );
}

export function PageHead({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string | undefined;
  children?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {desc !== undefined && <p className="mt-1 text-sm text-sub">{desc}</p>}
      </div>
      {children !== undefined && (
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      )}
    </div>
  );
}

export function Empty({
  icon,
  title,
  desc,
  action,
}: {
  icon: string;
  title: string;
  desc?: string | undefined;
  action?: ReactNode | undefined;
}): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-soft text-sub">
        <Icon name={icon} size={24} />
      </div>
      <h3 className="mt-4 text-sm font-semibold">{title}</h3>
      {desc !== undefined && <p className="mt-1 max-w-sm text-sm text-sub">{desc}</p>}
      {action !== undefined && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  icon,
  hint,
  tone = 'primary',
}: {
  label: string;
  value: string | number;
  icon: string;
  hint?: string | undefined;
  tone?: 'primary' | 'success' | 'warning' | 'danger';
}): JSX.Element {
  const tones = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
  } as const;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-sub">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
          {hint !== undefined && <p className="mt-1 text-xs text-sub">{hint}</p>}
        </div>
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}
        >
          <Icon name={icon} size={20} />
        </div>
      </div>
    </Card>
  );
}

export function Avatar({
  name,
  size = 'h-9 w-9 text-xs',
}: {
  name: string;
  size?: string;
}): JSX.Element {
  return (
    <div
      className={`flex items-center justify-center rounded-full bg-primary/10 font-semibold text-primary ${size}`}
    >
      {initials(name)}
    </div>
  );
}

// ============================================================================
//  BADGES
// ============================================================================

type Tone = 'primary' | 'neutral' | 'success' | 'warning' | 'danger';

export function Badge({
  tone = 'primary',
  dot = false,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  children: ReactNode;
}): JSX.Element {
  const tones: Record<Tone, string> = {
    primary: 'bg-primary/10 text-primary',
    neutral: 'bg-soft text-sub',
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-[#9A6A10]',
    danger: 'bg-danger-soft text-danger',
  };
  const dots: Record<Tone, string> = {
    primary: 'bg-primary',
    neutral: 'bg-sub',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dots[tone]}`} />}
      {children}
    </span>
  );
}

// `Record<Union, Tone>` obriga a tratar todo status novo do enum.
const TRIP_TONES: Record<TripStatus, Tone> = {
  confirmada: 'success',
  recusada: 'danger',
  em_andamento: 'primary',
  concluida: 'neutral',
  cancelada: 'neutral',
};

const REQUEST_TONES: Record<FlightRequestStatus, Tone> = {
  aguardando_analise: 'warning',
  em_analise: 'primary',
  convertida: 'success',
  recusada: 'danger',
};

const CHARGE_TONES: Record<ChargeStatus, Tone> = {
  pendente: 'warning',
  parcial: 'primary',
  pago: 'success',
  vencido: 'danger',
};

const FINANCIAL_TONES: Record<ClientFinancialStatus, Tone> = {
  em_dia: 'success',
  pendente: 'warning',
  vencido: 'danger',
};

const AIRCRAFT_TONES: Record<AircraftStatus, Tone> = {
  disponivel: 'success',
  em_voo: 'primary',
  manutencao: 'warning',
  indisponivel: 'neutral',
};

const USER_TONES: Record<UserStatus, Tone> = {
  pendente: 'warning',
  ativo: 'success',
  inativo: 'neutral',
  bloqueado: 'danger',
};

export const TripBadge = ({ status }: { status: TripStatus }): JSX.Element => (
  <Badge tone={TRIP_TONES[status]} dot>
    {TRIP_STATUS_LABELS[status]}
  </Badge>
);

export const RequestBadge = ({ status }: { status: FlightRequestStatus }): JSX.Element => (
  <Badge tone={REQUEST_TONES[status]} dot>
    {REQUEST_STATUS_LABELS[status]}
  </Badge>
);

export const ChargeBadge = ({ status }: { status: ChargeStatus }): JSX.Element => (
  <Badge tone={CHARGE_TONES[status]} dot>
    {CHARGE_STATUS_LABELS[status]}
  </Badge>
);

export const FinancialBadge = ({ status }: { status: ClientFinancialStatus }): JSX.Element => (
  <Badge tone={FINANCIAL_TONES[status]} dot>
    {FINANCIAL_STATUS_LABELS[status]}
  </Badge>
);

export const AircraftBadge = ({ status }: { status: AircraftStatus }): JSX.Element => (
  <Badge tone={AIRCRAFT_TONES[status]} dot>
    {AIRCRAFT_STATUS_LABELS[status]}
  </Badge>
);

export const UserBadge = ({ status }: { status: UserStatus }): JSX.Element => (
  <Badge tone={USER_TONES[status]} dot>
    {USER_STATUS_LABELS[status]}
  </Badge>
);

// ============================================================================
//  FORMULÁRIO
// ============================================================================

export const inputCls =
  'h-10 w-full rounded-lg border border-line bg-white px-3 text-sm shadow-card placeholder:text-sub/70 focus:outline-none focus:ring-2 focus:ring-primary/40';

export function Field({
  label,
  help,
  required = false,
  error,
  children,
}: {
  label: string;
  help?: string | undefined;
  required?: boolean;
  error?: string | undefined;
  children: ReactNode;
}): JSX.Element {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5">
        <label className="text-sm font-medium text-ink">
          {label}
          {required && <span className="ml-0.5 text-danger">*</span>}
        </label>
        {help !== undefined && (
          <span data-help title={help} className="text-sub/70 hover:text-primary">
            <Icon name="HelpCircle" size={14} />
          </span>
        )}
      </div>
      {children}
      {error !== undefined && error !== '' && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

export function Input({
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return <input className={`${inputCls} ${className}`} {...rest} />;
}

export function Textarea({
  className = '',
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>): JSX.Element {
  return (
    <textarea
      className={`min-h-[80px] w-full rounded-lg border border-line bg-white px-3 py-2 text-sm shadow-card placeholder:text-sub/70 focus:outline-none focus:ring-2 focus:ring-primary/40 ${className}`}
      {...rest}
    />
  );
}

export function Select({
  className = '',
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>): JSX.Element {
  return (
    <select
      className={`${inputCls} ${rest.disabled === true ? 'opacity-60' : ''} ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => {
        onChange(!checked);
      }}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? 'bg-primary' : 'bg-slate-300'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}): JSX.Element {
  return (
    <div className="relative w-full sm:w-64">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub">
        <Icon name="Search" size={16} />
      </span>
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        placeholder={placeholder}
        className={`${inputCls} pl-9`}
      />
    </div>
  );
}

// ============================================================================
//  TABELA
// ============================================================================

export const TH = ({
  children,
  className = '',
}: {
  children?: ReactNode;
  className?: string;
}): JSX.Element => (
  <th
    className={`h-11 px-4 text-left text-xs font-semibold uppercase tracking-wide text-sub ${className}`}
  >
    {children}
  </th>
);

export const TD = ({
  children,
  className = '',
  onClick,
}: {
  children?: ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLTableCellElement>) => void;
}): JSX.Element => (
  <td className={`px-4 py-3 align-middle ${className}`} onClick={onClick}>
    {children}
  </td>
);

export function DetailRow({
  icon,
  label,
  value,
}: {
  icon?: string | undefined;
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div className="flex items-start gap-2.5">
      {icon !== undefined && (
        <span className="mt-0.5 text-sub">
          <Icon name={icon} size={16} />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-xs text-sub">{label}</p>
        <p className="truncate font-medium">{value}</p>
      </div>
    </div>
  );
}

// ============================================================================
//  MODAL
// ============================================================================

export function Modal({
  open,
  onClose,
  title,
  desc,
  children,
  footer,
  size = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title?: string | undefined;
  desc?: string | undefined;
  children: ReactNode;
  footer?: ReactNode | undefined;
  size?: string;
}): JSX.Element | null {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain">
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px]" />
      {/* min-h-full centraliza quando cabe e permite rolar quando é maior que a tela */}
      <div
        className="relative flex min-h-full items-start justify-center p-3 sm:items-center sm:p-6"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          className={`relative z-10 my-2 w-full ${size} rounded-xl border border-line bg-white p-5 shadow-pop animate-fade sm:my-8 sm:p-6`}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="absolute right-3 top-3 rounded-md p-1 text-sub hover:bg-soft sm:right-4 sm:top-4"
          >
            <Icon name="X" size={18} />
          </button>
          {title !== undefined && (
            <h3 className="pr-8 text-lg font-semibold tracking-tight">{title}</h3>
          )}
          {desc !== undefined && <p className="mt-1 text-sm text-sub">{desc}</p>}
          <div className="mt-4">{children}</div>
          {footer !== undefined && (
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
//  MENU DE AÇÕES
// ============================================================================

export interface MenuItem {
  readonly label: string;
  readonly icon: string;
  readonly onClick: () => void;
  readonly hidden?: boolean;
  readonly danger?: boolean;
  readonly separator?: boolean;
}

export function Menu({ items }: { items: readonly MenuItem[] }): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
    };
  }, []);

  const visible = items.filter((item) => item.hidden !== true);
  // Sem nenhuma ação permitida, nem o botão aparece.
  if (visible.length === 0) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label="Ações"
        onClick={() => {
          setOpen((o) => !o);
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-sub hover:bg-soft hover:text-ink"
      >
        <Icon name="MoreVertical" size={16} />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-52 rounded-lg border border-line bg-white p-1 shadow-pop animate-fade">
          {visible.map((item, index) => (
            <div key={item.label}>
              {item.separator === true && index > 0 && <div className="my-1 h-px bg-line" />}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-soft ${
                  item.danger === true ? 'text-danger hover:bg-danger-soft' : 'text-ink'
                }`}
              >
                <Icon name={item.icon} size={16} />
                {item.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
//  ESTADOS DE CARGA E ERRO
// ============================================================================

export function Spinner({ className = '' }: { className?: string }): JSX.Element {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      role="status"
      aria-label="Carregando"
    />
  );
}

export function Loading({ label = 'Carregando…' }: { label?: string }): JSX.Element {
  return (
    <div className="flex items-center justify-center gap-2 py-14 text-sm text-sub">
      <Spinner />
      {label}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-danger-soft text-danger">
        <Icon name="AlertTriangle" size={24} />
      </div>
      <h3 className="mt-4 text-sm font-semibold">Não foi possível carregar</h3>
      <p className="mt-1 max-w-sm text-sm text-sub">{message}</p>
      {onRetry !== undefined && (
        <Btn variant="outline" size="sm" className="mt-5" onClick={onRetry}>
          <Icon name="RefreshCw" size={16} /> Tentar de novo
        </Btn>
      )}
    </div>
  );
}

/** Faixa de aviso reutilizável (pendência financeira, dicas, conflito). */
export function Banner({
  tone,
  icon,
  title,
  children,
  action,
}: {
  tone: 'info' | 'warning' | 'danger' | 'success';
  icon: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode | undefined;
}): JSX.Element {
  const styles = {
    info: 'border-primary/25 bg-primary-soft/60 text-primary-dark',
    warning: 'border-warning/30 bg-warning-soft',
    danger: 'border-danger/30 bg-danger-soft',
    success: 'border-success/30 bg-success-soft',
  } as const;

  const iconColor = {
    info: 'text-primary',
    warning: 'text-warning',
    danger: 'text-danger',
    success: 'text-success',
  } as const;

  return (
    <div className={`flex items-start gap-3 rounded-xl border p-4 ${styles[tone]}`}>
      <span className={iconColor[tone]}>
        <Icon name={icon} size={20} />
      </span>
      <div className="flex-1">
        <p className="text-sm font-semibold">{title}</p>
        {children !== undefined && <div className="mt-0.5 text-sm text-sub">{children}</div>}
      </div>
      {action}
    </div>
  );
}

/** Grupo de abas — protótipo: `ClientDetail`, `OpConfig`, `CliViagens`. */
export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
  className = '',
}: {
  value: T;
  onChange: (value: T) => void;
  tabs: readonly { readonly key: T; readonly label: string; readonly icon?: string }[];
  className?: string;
}): JSX.Element {
  return (
    <div className={`inline-flex rounded-lg bg-soft p-1 ${className}`}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => {
            onChange(tab.key);
          }}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${
            value === tab.key ? 'bg-white shadow-card' : 'text-sub'
          }`}
        >
          {tab.icon !== undefined && <Icon name={tab.icon} size={16} />}
          {tab.label}
        </button>
      ))}
    </div>
  );
}
