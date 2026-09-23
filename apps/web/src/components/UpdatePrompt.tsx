/**
 * Card "Nova versão disponível".
 *
 * O deploy é blue-green (docs/DEPLOY.md §6): a versão nova entra no ar sem
 * derrubar a antiga, e quem já está com a tela aberta continua na versão que
 * carregou — o bundle inteiro já está na memória, então nada quebra.
 *
 * Esta tela pergunta a cada minuto qual versão o servidor está servindo
 * (`/version.json`, sem cache). Quando diverge da versão com que ela foi
 * compilada, o card aparece e a pessoa atualiza quando quiser — por exemplo,
 * depois de terminar o formulário que está preenchendo. Nada recarrega sozinho.
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';

import { Btn, Icon } from './ui';

const CHECK_INTERVAL_MS = 60_000;
/** "Depois" esconde o card por este tempo; ele volta enquanto não atualizar. */
const SNOOZE_MS = 15 * 60_000;

const CURRENT_VERSION = __APP_VERSION__;

async function fetchServerVersion(): Promise<string | null> {
  const response = await fetch('/version.json', { cache: 'no-store' });
  if (!response.ok) return null;
  const body = (await response.json()) as { version?: unknown };
  return typeof body.version === 'string' ? body.version : null;
}

export function UpdatePrompt(): JSX.Element | null {
  const [snoozedUntil, setSnoozedUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const server = useQuery({
    queryKey: ['app-version'],
    queryFn: fetchServerVersion,
    // Build local (`npm run dev`) não tem versão: não há o que comparar.
    enabled: CURRENT_VERSION !== 'dev',
    refetchInterval: CHECK_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
    retry: false,
  });

  // Relógio para o "Depois" expirar sem depender de outra renderização.
  useEffect(() => {
    if (snoozedUntil === 0) return undefined;
    const timer = window.setTimeout(() => {
      setNow(Date.now());
    }, snoozedUntil - Date.now());
    return () => {
      window.clearTimeout(timer);
    };
  }, [snoozedUntil]);

  const available =
    server.data !== undefined && server.data !== null && server.data !== CURRENT_VERSION;

  if (!available || now < snoozedUntil) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[60] w-[calc(100%-2rem)] max-w-sm rounded-xl border border-primary/20 bg-white p-4 shadow-lg"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
          <Icon name="RefreshCw" size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Nova versão disponível</p>
          <p className="mt-0.5 text-xs text-sub">
            Salve o que estiver fazendo e clique em Atualizar para usar a versão mais recente.
          </p>
          <div className="mt-3 flex gap-2">
            <Btn
              size="sm"
              onClick={() => {
                // O index.html é servido sem cache: recarregar traz os assets novos.
                window.location.reload();
              }}
            >
              Atualizar
            </Btn>
            <Btn
              size="sm"
              variant="outline"
              onClick={() => {
                const until = Date.now() + SNOOZE_MS;
                setSnoozedUntil(until);
                setNow(Date.now());
              }}
            >
              Depois
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
