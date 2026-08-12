import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env['API_BASE_URL'] ?? 'http://localhost:1701';

  return {
    plugins: [react()],

    resolve: {
      alias: {
        /**
         * `@acm/shared` é resolvido para o FONTE, não para `dist`.
         *
         * O pacote é compilado em CommonJS para o backend, e o Rollup não
         * consegue analisar estaticamente os exports nomeados de um CJS
         * re-exportado com `export *` — o build quebrava em `initials`.
         *
         * Apontando para o fonte, o Vite compila o TypeScript junto com o app:
         * tree-shaking funciona, não há build intermediário para ficar velho, e
         * o backend continua usando o `dist` CommonJS normalmente.
         */
        '@acm/shared': fileURLToPath(new URL('../../packages/shared/src', import.meta.url)),
      },
    },

    server: {
      port: Number(env['PORT_FRONTEND'] ?? 1700),
      strictPort: true,
      // Em desenvolvimento o front chama /api e o Vite repassa para o backend.
      // Assim o cookie de refresh é same-origin, igual à produção com nginx.
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
      },
    },

    preview: { port: Number(env['PORT_FRONTEND'] ?? 1700), strictPort: true },

    build: {
      outDir: 'dist',
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom', 'react-router-dom'],
            query: ['@tanstack/react-query'],
          },
        },
      },
    },
  };
});
