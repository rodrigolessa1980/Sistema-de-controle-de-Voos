# Air Charter Manager

Sistema de gestão de táxi aéreo — **React + Node + TypeScript + Prisma/MySQL**.

Migração de um protótipo frontend-only (React via CDN, estado no `localStorage`)
para uma aplicação real, com banco, autenticação, autorização por permissão,
polling de 10 segundos, Docker e CI/CD.

| Documento | O que traz |
|---|---|
| [`docs/PLANO.md`](docs/PLANO.md) | Plano técnico e o **checklist vivo** (§10) — é de lá que a próxima sessão começa |
| [`docs/STATUS.md`](docs/STATUS.md) | O placar: o que roda, o que está bloqueado, as correções de rota |
| [`docs/REGRAS.md`](docs/REGRAS.md) | As duas regras estruturais: contrato único front/back e nenhum dado inventado |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | O ensaio de deploy já feito e o caminho para publicar |
| [`prisma/schema.prisma`](prisma/schema.prisma) | Modelo de dados |

**Portas:** frontend `1700`, backend `1701`.

---

## Estrutura

```
packages/shared/     Regras de domínio, contratos Zod, permissões e rótulos.
                     Importado pelo backend E pelo frontend — é o que impede
                     os dois de divergirem numa regra de negócio.

apps/api/            Fastify + Prisma. 15 módulos, jobs em lote, fila de e-mail.
apps/web/            React + Vite + TanStack Query. 19 telas, 3 perfis.

prisma/              schema.prisma, migrations e seed (só estrutural).
docker/              Dockerfiles, nginx e compose de produção.
scripts/             Cadastro das chaves no GitHub, expurgo de dados.
.github/workflows/   CI (lint, tipos, testes, build) e deploy.
```

> O protótipo original (`src/index.html` e os bundles gerados) foi removido: ele
> era a fonte dos dados mockados e já não descreve o sistema. Continua
> recuperável no commit `a38f83b`.

---

## Rodando localmente

Requer **Node 22+** e acesso ao MySQL configurado no `.env`.

```bash
npm install                 # instala todos os workspaces
npm run prisma:generate     # gera o Prisma Client
npm run prisma:deploy       # aplica as migrations
npm run seed                # papéis, permissões, configurações e o admin
npm run dev                 # sobe API (1701) e frontend (1700) juntos
```

Abra <http://localhost:1700>.

### Primeiro acesso

**Não existe dado de demonstração.** O sistema nasce vazio: sem aeronave, sem
cliente, sem tarifa, sem viagem. É deliberado — um seed que inventa frota e
cliente cria um estado que ninguém sabe se é real, e mais cedo ou mais tarde
alguém fatura em cima dele.

O único usuário criado pelo seed é o administrador, a partir de `ADMIN_EMAIL` e
`ADMIN_PASSWORD` do ambiente. Ele entra com `mustChangePassword`, então o
primeiro acesso obriga a trocar a senha. **Não há senha padrão no código**: sem
essas duas variáveis, o seed falha em vez de criar um acesso previsível.

A partir daí o caminho é o mesmo em desenvolvimento e em produção:

1. entrar como admin e trocar a senha;
2. cadastrar as aeronaves em **Aeronaves**;
3. cadastrar as tarifas em **Configurações → Tarifas**;
4. cadastrar os clientes em **Clientes** — marcando "Criar acesso ao portal"
   para quem vai usar o portal do cliente;
5. liberar os acessos da equipe em **Configurações → Permissões**.

### Como alguém ganha acesso

Há três caminhos, e nenhum deles cria acesso sem uma decisão de dentro:

**Autocadastro na tela de login.** Quem abre o sistema vê "Criar cadastro" e
informa nome, e-mail e senha. A conta é gravada com status `pendente`: existe,
tem senha conferível, e **não entra em lugar nenhum**. Tentar entrar antes da
liberação devolve uma mensagem explicando que o cadastro está na fila — e só
depois de a senha estar correta, para a tela não virar um verificador de quem tem
conta no sistema.

**Liberação pelo administrador.** Em **Configurações → Permissões** (aba visível
só para quem tem `user:read`, na prática o admin) fica a fila de cadastros. Para
cada um, o administrador escolhe o **perfil** — Operacional, Financeiro, Cliente
ou Administrador — e libera. Quem se cadastra nunca escolhe o próprio perfil.
Recusar apaga o pedido e devolve o e-mail para uso, de modo que uma recusa por
engano não deixa a pessoa presa.

Perfil **Cliente** precisa de um cadastro de cliente do outro lado, porque é ele
que dá o escopo por linha. Na liberação o administrador aponta um cliente
existente ou deixa em branco para o sistema criar o cadastro com o nome e o
e-mail informados — e se já houver cliente com aquele e-mail, ele é reaproveitado,
para não partir o histórico de viagens e cobranças em dois.

**Senha provisória pelo cadastro de cliente.** O caminho antigo continua: marcar
"Criar acesso ao portal" ao cadastrar um cliente gera senha aleatória, envia por
e-mail e obriga a troca no primeiro acesso. Depende de `MAIL_API_KEY`
configurada — com `MAIL_DRY_RUN=1` o e-mail é apenas registrado no log, então a
senha gerada não chega a ninguém.

### Carregar os dados do protótipo

Para ver as telas com conteúdo sem cadastrar nada à mão, `npm run seed:demo`
recarrega exatamente os registros que existiam na primeira versão — 4 aeronaves,
10 clientes, 4 tarifas, 8 viagens, 5 solicitações, 6 cobranças com 6 pagamentos
e 2 bloqueios de agenda:

```bash
npm run seed:demo                  # simula: mostra o que entraria
npm run seed:demo -- --confirm     # grava
```

Recusa rodar se o banco já tiver cliente, então não há como duplicar.

**São dados de demonstração.** Depois de gravados, um cliente fictício é
indistinguível de um real — antes de operar para valer, limpe tudo.

### Limpar o banco

`node scripts/purge-operational-data.mjs` mostra o que seria apagado sem tocar
em nada. Com `--confirm`, apaga todos os dados operacionais e preserva papéis,
permissões, configurações e o admin.

---

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | API + frontend em modo desenvolvimento |
| `npm run build` | Compila shared → api → web |
| `npm run lint` | ESLint com zero tolerância a warning |
| `npm run typecheck` | `tsc --noEmit` nos três pacotes |
| `npm test` | Vitest — unitário + integração (exige `TEST_DATABASE_URL`) |
| `npm run test:unit` | Só os testes de regra de domínio (não precisa de banco) |
| `npm run test:integration` | Só os de integração, contra o banco de teste |
| **`npm run verify`** | **Tudo acima, na ordem do CI** |
| `npm run prisma:migrate` | Cria uma migration nova a partir do schema |
| `npm run prisma:studio` | Abre o Prisma Studio |
| `npm run seed` | Papéis, permissões, configurações e o admin |
| `npm run seed:demo` | Recarrega os dados do protótipo (exige `-- --confirm`) |

---

## Decisões que valem conhecer antes de mexer

**Dinheiro é `string` decimal, nunca `number`.** Toda aritmética acontece em
centavos inteiros (`packages/shared/src/money.ts`). Ponto flutuante binário não
representa 0,1 exatamente, e o erro acumula em cobrança.

**As regras de negócio ficam em `packages/shared/src/domain.ts`, e são puras.**
O backend é a autoridade; o frontend usa as MESMAS funções para dar feedback
imediato (o aviso "Voo NÃO disponível" aparece enquanto a pessoa digita). Uma
implementação, dois consumidores.

**Autorização tem três camadas** (`docs/PLANO.md` §4.2): permissão na rota,
escopo injetado no `where` da query, e DTO por perfil na saída. As três são
obrigatórias — o DTO é o que garante que o cliente nunca receba aeronave nem
tarifa interna, e o compilador reforça isso.

**Nada de N+1.** Saldo, situação financeira e contagem de viagens são COLUNAS
denormalizadas, atualizadas na mesma transação da mutação. Regra de revisão de
PR: nenhum `await` dentro de `for`/`map` sobre resultado de query.

**O polling de 10s é UMA requisição para o app inteiro.** `GET /api/changes`
devolve só o delta desde o último cursor e o frontend invalida apenas os caches
afetados. Nada mudou → ~40 bytes.

**E-mail nunca é enviado de forma síncrona.** Vai para a fila `EmailOutbox` na
mesma transação do fato, e um worker entrega com retry e backoff
(`docs/PLANO.md` §13).

**O formulário valida com o MESMO schema Zod da rota.** `apps/web/src/lib/form.ts`
roda `schema.safeParse` antes de enviar, usando o objeto de `@acm/shared` que o
Fastify usa como `schema.body`. Se passar no front, passa no back — e o 422 que
o servidor devolver vai para o campo certo, não só para um toast.

---

## Estado atual

Construído e verificado contra um MySQL de verdade: autenticação, os três
limites de autorização do `HANDOFF.md`, conflito de agenda com margem, cálculo
de tarifa, solicitação com documento, aviso por e-mail + sino, change feed com
isolamento por cliente, pagamento, baixa e agregados denormalizados.

O placar completo está em [`docs/STATUS.md`](docs/STATUS.md); o checklist do que
falta, na §10 de [`docs/PLANO.md`](docs/PLANO.md).

As **13 chaves e 10 variables** de produção já estão cadastradas no GitHub
(`docs/DEPLOY.md` §2.1).

**Para publicar:**

```powershell
./scripts/publicar.ps1
```

Instala o `gh`, autentica reaproveitando a credencial que o `git push` já usa,
cadastra as chaves, dispara o deploy e verifica se subiu.

**Pendências que dependem de outra pessoa:**

1. **O environment `production` sem proteção.** Criar o environment e marcar
   *Required reviewers* exige **admin no repositório**, que a conta que publica
   não tem. Enquanto isso não for feito, todo push em `main` publica direto em
   produção, sem aprovação (`docs/DEPLOY.md` §2.2).
2. **Provedor de e-mail não definido.** Sem `MAIL_API_KEY`, o worker roda em
   dry-run: enfileira e loga, mas não envia. O aviso de nova solicitação só
   chega de verdade depois de contratar o provedor e publicar SPF/DKIM.
3. **Rotacionar as senhas e criar um usuário de deploy não-root** — hoje a senha
   do MySQL e a do `root` do servidor são a mesma (`docs/PLANO.md` §11).
4. **Fuso, unidades de tarifa e o cálculo de horas de voo** — decisões em aberto
   no plano (§12.1) e a divergência apontada em `docs/STATUS.md` §4.
