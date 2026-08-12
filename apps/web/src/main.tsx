import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { App } from './App';
import './index.css';
import { ApiRequestError } from './lib/api';
import { AuthProvider } from './lib/auth';
import { FeedbackProvider } from './lib/feedback';

/**
 * O `staleTime` de 30s combina com o polling de 10s: a invalidação vinda do
 * change feed é o que dispara a rebusca, não um cronômetro por consulta. Assim
 * navegar entre telas usa o cache, e o dado ainda chega em até 10 segundos.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // 4xx é decisão do servidor: repetir não muda a resposta.
        if (error instanceof ApiRequestError && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

const container = document.getElementById('root');
if (container === null) throw new Error('elemento #root não encontrado');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <FeedbackProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </FeedbackProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
