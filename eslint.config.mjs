import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'src/index.html',
      'dist/**',
      'build/**',
      'air-charter-manager*.html',
      'prisma/migrations/**',
    ],
  },

  js.configs.recommended,

  // ---------------------------------------------------------------- TypeScript
  // strictTypeChecked exige type information: sem `any` implícito nem
  // operação insegura passando batido (docs/PLANO.md §2).
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    files: ['**/*.{ts,tsx,mts}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      /**
       * `require-await` fica desligado de propósito.
       *
       * Fastify e o TanStack Query tipam handlers e `queryFn` como
       * `() => Promise<T>`; escrever `async` sem `await` no corpo é a forma
       * idiomática de satisfazer essa assinatura. A regra marcaria dezenas
       * desses casos como erro sem apontar nenhum defeito real.
       *
       * O que realmente importa — promise solta e promise onde se espera void —
       * continua ligado nas duas regras acima.
       */
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: false, allowNullish: false },
      ],
      // Prisma.Decimal e Date em template string são casos legítimos e comuns;
      // o `restrict-template-expressions` acima já barra os perigosos.
      '@typescript-eslint/no-non-null-assertion': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-param-reassign': 'error',
    },
  },

  // Arquivos de configuração em JavaScript puro (postcss, tailwind, este mesmo
  // arquivo) não pertencem a nenhum tsconfig, então as regras que dependem de
  // informação de tipo não têm como rodar neles.
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
  },

  // -------------------------------------------------------------------- React
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      /**
       * `only-export-components` desligado.
       *
       * Ele reclama de arquivos que exportam componente E outra coisa — que é
       * exatamente o padrão de Provider + hook (`AuthProvider` + `useAuth`) e
       * de componente + helper (`PassengersEditor` + `newPassenger`). Separar
       * cada par em dois arquivos só para agradar a regra pioraria a leitura.
       *
       * O custo é um reload completo em vez de hot reload ao editar esses
       * arquivos específicos. Aceitável.
       */
      'react-refresh/only-export-components': 'off',
      // O front usa console.log em nenhum lugar; mantém o padrão do repo.
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  // ---------------------------------------------------------------------- Node
  {
    files: ['apps/api/**/*.ts', 'prisma/**/*.ts', 'scripts/**/*.{mjs,js}', '*.mjs', '*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Scripts de operação (criar banco, inspecionar) reportam no stdout — é a
  // interface deles, e rodam fora de qualquer tsconfig.
  {
    files: ['scripts/**/*.{mjs,js}'],
    rules: { 'no-console': 'off' },
  },

  // O seed e os scripts de operação reportam progresso no stdout — é a interface
  // deles. Aqui console.log é o comportamento correto, não um esquecimento.
  {
    files: ['prisma/seed.ts', 'prisma/seed-demo.ts', 'apps/api/src/jobs/**/*.ts'],
    rules: { 'no-console': 'off' },
  },

  // Testes: asserções e mocks tornam algumas regras de tipo ruído puro.
  {
    files: ['**/*.test.ts', '**/*.spec.ts', 'apps/api/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      'no-console': 'off',
    },
  },

  prettier,
);
