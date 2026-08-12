/**
 * Toasts e modal de confirmação — protótipo: `Toasts`, `notify`, `ConfirmModal`.
 *
 * Vira contexto para que qualquer tela chame `notify()` / `confirm()` sem
 * receber tudo por prop, como o protótipo fazia pelo `AppCtx`.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';

import { ApiRequestError } from './api';
import { Btn, Icon, Modal } from '../components/ui';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  readonly id: number;
  readonly type: ToastType;
  readonly title: string;
  readonly desc?: string | undefined;
}

interface ConfirmOptions {
  readonly title: string;
  readonly desc?: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly danger?: boolean;
  readonly onConfirm: () => void | Promise<void>;
}

interface FeedbackApi {
  readonly notify: (type: ToastType, title: string, desc?: string) => void;
  /** Traduz um erro da API em toast, usando a mensagem que o servidor mandou. */
  readonly notifyError: (error: unknown, fallback?: string) => void;
  readonly confirm: (options: ConfirmOptions) => void;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

const TOAST_MS = 3600;

export function FeedbackProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);

  const notify = useCallback((type: ToastType, title: string, desc?: string): void => {
    const id = nextId.current++;
    setToasts((list) => [...list, { id, type, title, ...(desc === undefined ? {} : { desc }) }]);
    setTimeout(() => {
      setToasts((list) => list.filter((t) => t.id !== id));
    }, TOAST_MS);
  }, []);

  const notifyError = useCallback(
    (error: unknown, fallback = 'Não foi possível concluir a operação.'): void => {
      if (error instanceof ApiRequestError) {
        const fields = error.fieldErrors;
        notify(
          'error',
          error.message,
          fields.length > 0 ? fields.map((f) => f.message).join(' · ') : undefined,
        );
        return;
      }
      notify('error', fallback, error instanceof Error ? error.message : undefined);
    },
    [notify],
  );

  const confirm = useCallback((options: ConfirmOptions): void => {
    setConfirmState(options);
  }, []);

  const value = useMemo<FeedbackApi>(
    () => ({ notify, notifyError, confirm }),
    [notify, notifyError, confirm],
  );

  const closeConfirm = (): void => {
    setConfirmState(null);
    setBusy(false);
  };

  const runConfirm = async (): Promise<void> => {
    if (!confirmState) return;
    setBusy(true);
    try {
      await confirmState.onConfirm();
      closeConfirm();
    } catch (error) {
      notifyError(error);
      closeConfirm();
    }
  };

  const toastStyle: Record<ToastType, { icon: string; color: string }> = {
    success: { icon: 'CheckCircle2', color: 'text-success' },
    error: { icon: 'AlertTriangle', color: 'text-danger' },
    info: { icon: 'Info', color: 'text-primary' },
    warning: { icon: 'AlertTriangle', color: 'text-warning' },
  };

  return (
    <FeedbackContext.Provider value={value}>
      {children}

      <div className="fixed right-4 top-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((toast) => {
          const style = toastStyle[toast.type];
          return (
            <div
              key={toast.id}
              role="status"
              className="flex items-start gap-3 rounded-xl border border-line bg-white p-3.5 shadow-pop animate-fade"
            >
              <span className={style.color}>
                <Icon name={style.icon} size={18} />
              </span>
              <div className="flex-1">
                <p className="text-sm font-semibold">{toast.title}</p>
                {toast.desc !== undefined && <p className="text-sm text-sub">{toast.desc}</p>}
              </div>
            </div>
          );
        })}
      </div>

      {confirmState !== null && (
        <Modal open onClose={closeConfirm} size="max-w-md">
          <div className="flex items-start gap-3">
            {confirmState.danger === true && (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger">
                <Icon name="AlertTriangle" size={20} />
              </div>
            )}
            <div>
              <h3 className="text-lg font-semibold">{confirmState.title}</h3>
              {confirmState.desc !== undefined && (
                <p className="mt-1.5 text-sm text-sub">{confirmState.desc}</p>
              )}
            </div>
          </div>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Btn variant="outline" onClick={closeConfirm} disabled={busy}>
              {confirmState.cancelLabel ?? 'Cancelar'}
            </Btn>
            <Btn
              variant={confirmState.danger === true ? 'danger' : 'primary'}
              disabled={busy}
              onClick={() => {
                void runConfirm();
              }}
            >
              {confirmState.confirmLabel ?? 'Confirmar'}
            </Btn>
          </div>
        </Modal>
      )}
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): FeedbackApi {
  const context = useContext(FeedbackContext);
  if (context === null) throw new Error('useFeedback precisa estar dentro de <FeedbackProvider>');
  return context;
}
