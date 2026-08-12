import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/api/test/**/*.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,

    /**
     * Um processo, em série.
     *
     * Os testes de integração compartilham um banco MySQL de verdade e cada um
     * limpa as tabelas no `beforeEach`. Em paralelo, um arquivo apagaria os
     * dados que outro acabou de criar.
     */
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },

    coverage: {
      provider: 'v8',
      include: ['packages/shared/src/**', 'apps/api/src/**'],
      reporter: ['text', 'lcov'],
    },
  },

  resolve: {
    alias: {
      /**
       * `fileURLToPath`, não `.pathname`.
       *
       * No Windows, `new URL(...).pathname` devolve `/C:/Users/...` — com a
       * barra na frente da letra do drive —, e o Vite não resolve esse caminho.
       */
      '@acm/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
    },
  },
});
