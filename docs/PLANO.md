# Plano técnico — Air Charter Manager

Migração do protótipo `src/index.html` (React via CDN + `localStorage`) para uma
aplicação real **React + Node + TypeScript**, com Prisma/MySQL, autorização,
polling de 10s, Docker e CI/CD no GitHub.

> **Como usar este documento.** A §10 é o checklist vivo: `[x]` está feito e
> verificado, `[ ]` é o que falta. É de lá que a próxima sessão de trabalho
> começa. O restante explica *por quê* cada coisa é do jeito que é.

- **Repositório:** `github.com/rodrigolessa1980/Sistema-de-controle-de-Voos`
- **Banco:** MySQL 8 — `aircharter` (host em `MYSQL_HOST`, porta 3306)
- **Portas:** frontend `1700`, backend `1701`
- **Deploy:** SSH com **senha** (`SERVER_USER` / `SERVER_PASSWORD`) — sem chave pública
- **Schema de dados:** [`prisma/schema.prisma`](../prisma/schema.prisma)

---

## 1. Inventário do protótipo (referência histórica)

Levantamento de ponta a ponta do protótipo original, feito antes da migração.
Serve de checklist do que precisava existir no sistema real — e tudo aqui foi
implementado (§10).

> Os arquivos do protótipo (`src/index.html` e os dois bundles de 21.924 linhas)
> foram **removidos** do repositório: eram a fonte dos dados mockados e já não
> descrevem o sistema. Continuam recuperáveis no commit `a38f83b`.

### 1.1 Perfis e navegação

| Perfil | Páginas |
|---|---|
| **Operacional** | Dashboard, Agenda, Solicitações, Viagens, Clientes, Aeronaves, Configurações |
| **Financeiro** | Dashboard, Financeiro, Cobranças, Pagamentos, Clientes, Relatórios |
| **Cliente** | Início, Solicitar Voo, Disponibilidade, Minhas Viagens, Financeiro, Meu Perfil |

Hoje a troca de perfil é o seletor "Visualizar como" (`RoleSwitcher`) e o login é
falso (`Login` só chama `setTimeout(onEnter, 400)`). Vira autenticação real.

### 1.2 Funcionalidades por tela

**Operacional — Dashboard.** 6 indicadores (voos hoje, próximos voos,
solicitações aguardando, confirmados futuros, aeronaves livres `n/total`,
clientes com pendência), banner de alerta quando há inadimplência, tabela dos 6
próximos voos, lista das 5 solicitações pendentes.

**Operacional — Agenda.** Calendário mês/semana/dia (`Calendar`), eventos =
viagens (exceto `recusada`/`cancelada`) + bloqueios/manutenções. Clique no dia
abre nova viagem com a data da ida preenchida; dias passados não são clicáveis.
Modal de detalhe do evento. Legenda voo/manutenção/bloqueio. Máximo de 3 eventos
por célula com "+N mais".

**Operacional — Solicitações.** Busca por código/cliente/destino. Ações: ver
detalhes (com passageiros e documentos), marcar em análise, agendar viagem
(converte → a solicitação vira `convertida`), recusar (com confirmação).

**Operacional — Viagens.** Busca + filtro por status. Ações: visualizar, editar
(bloqueado em `concluida`/`cancelada`), cancelar. Formulário (`TripForm`) com:
seleção de cliente, aviso de pendência financeira do cliente (com valor em
aberto e confirmação obrigatória antes de agendar), origem/destino, data+hora de
ida e volta, aeronave, distância do trecho, **verificação de disponibilidade em
tempo real** (`checkConflict`), painel de cálculo de tarifa (tarifa/h,
distância, velocidade de cruzeiro, horas ida+volta, valor estimado, composição
dos 4 custos), valor comercial editável, editor de passageiros com foto de
documento, observações.

**Operacional — Aeronaves.** CRUD completo com busca. Aviso de área interna.

**Operacional — Configurações.** Abas: Geral (nome da empresa, e-mail de
contato, fuso), Tarifas (CRUD com composição de custo e total calculado),
Margem entre voos (`marginMinutes`).

**Financeiro — Dashboard.** Total a receber, recebido no mês, em atraso,
vencimentos nos próximos 15 dias; tabela de cobranças em aberto por vencimento;
lista de próximos vencimentos.

**Financeiro — Financeiro.** 3 indicadores + tabela de cobranças (total, pago,
saldo, vencimento, status) com busca e filtro. Ações: registrar pagamento, dar
baixa (quitação total em 1 clique).

**Financeiro — Cobranças.** Listagem + criação de cobrança (cliente, viagem
opcional, valor, vencimento).

**Financeiro — Pagamentos.** Histórico de todos os pagamentos (data, cliente,
cobrança, forma, valor) + painel de baixa rápida das cobranças em aberto.

**Financeiro — Relatórios.** Total faturado, total recebido, nº de clientes
inadimplentes; gráfico de recebimentos por mês; distribuição de cobranças por
status; top 5 clientes por saldo em aberto.

**Financeiro — Clientes.** Mesma tela do operacional, somente leitura e **sem
revelar aeronave**.

**Cliente — Início.** Saudação, alerta de pendência, 3 indicadores (próximos
voos, solicitações em análise, saldo), lista dos próximos voos.

**Cliente — Solicitar Voo.** Origem, destino, data+hora de ida e volta,
passageiros com **nome e foto do documento obrigatórios**, observações.
Validações: data não pode ser no passado, volta depois da ida, todos os
passageiros completos. Se houver pendência financeira, modal de atenção antes de
enviar. Tela de sucesso com status "Aguardando análise".

**Cliente — Disponibilidade.** Calendário **mascarado**: cada dia é
`disponivel` (≥1 aeronave livre), `ocupado` (nenhuma livre e há voo) ou
`indisponivel`. Nenhum detalhe de frota é exposto. Clique em dia disponível leva
para Solicitar Voo com a data preenchida.

**Cliente — Minhas Viagens.** Abas Próximas / Histórico.

**Cliente — Financeiro.** Saldo, total pago, em atraso; cada cobrança com
total/pago/saldo e as formas de pagamento já registradas.

**Cliente — Meu Perfil.** Edição dos próprios dados de contato.

**Transversal.** Toasts, modal de confirmação, visualizador de documento
(lightbox), busca e filtros, avatar por iniciais, formatação `pt-BR` de moeda e
datas, layout responsivo com drawer no mobile, sino de notificações (hoje
decorativo).

### 1.3 Regras de negócio (hoje no front, vão para o servidor)

| Regra | Fórmula no protótipo |
|---|---|
| `paid` | `Σ payments.amount` |
| `balance` | `max(0, total − paid)` |
| `chStatus` | `pago` se `paid ≥ total`; senão `vencido` se venceu e há saldo; senão `parcial` se `paid > 0`; senão `pendente` |
| `clientFin` | `vencido` se alguma cobrança vencida; `pendente` se há saldo; senão `em_dia` |
| `clientTrips` | viagens do cliente com status ≠ `recusada` |
| `costSum` | `combustivel + horaVoo + taxas + despesaPiloto` |
| `checkConflict` | sobreposição `inicioA < fimB && fimA > inicioB` entre viagens ativas + bloqueios da **mesma aeronave**, respeitando `marginMinutes` |
| Horas de voo | `2 × distanceKm ÷ cruiseSpeed`, arredondado a 1 decimal |
| Valor estimado | `round(tarifa.value × horas)` |
| Agendamento | Operacional agenda **direto** (nasce `confirmada`); Cliente **solicita** e o operacional converte |

O servidor passa a ser a fonte de verdade dessas regras. Elas ficam em
`packages/shared/src/domain/` como funções **puras**, importadas pelo backend
(autoridade) e pelo frontend (feedback imediato na UI). Uma implementação, dois
consumidores — sem divergência.

### 1.4 O que o protótipo não tinha e o sistema real precisa

Login real com senha; autorização por permissão; upload de arquivo em vez de
base64 no `localStorage`; códigos sequenciais à prova de concorrência;
auditoria; notificações funcionais no sino; **aviso por e-mail de nova
solicitação** (§13); motivo de recusa/cancelamento; estorno de pagamento;
retenção/expurgo de documentos (LGPD); paginação; atualização automática entre
usuários (o polling de 10s).

---

## 2. Stack e decisões

| Camada | Escolha | Por quê |
|---|---|---|
| Monorepo | **npm workspaces** | Tipos compartilhados sem publicar pacote. O plano original dizia pnpm; ativá-lo pelo corepack exige privilégio de administrador na máquina de desenvolvimento, e npm workspaces resolve o mesmo problema sem esse pré-requisito |
| Backend | **Fastify 5** + TypeScript | Mais rápido que Express e com inferência de tipos de verdade nas rotas |
| Validação/contrato | **Zod** + `fastify-type-provider-zod` | Um schema Zod = validação em runtime **e** tipo TS. Sem `any` na borda |
| ORM | **Prisma 6** (`mysql`) | Tipagem gerada do schema; `include`/`select` explícitos matam N+1 |
| Frontend | **React 18 + Vite + TypeScript** | Substitui Babel-no-browser; build real, HMR |
| Estado de servidor | **TanStack Query v5** | Cache por chave + invalidação seletiva: base do polling de 10s |
| Formulários | react-hook-form + `zodResolver` | Reaproveita os mesmos schemas Zod do backend |
| Estilo | **Tailwind 3** com os tokens atuais | `build/tailwind.config.js` já tem a paleta; a UI não muda |
| Ícones | `lucide-react` | Troca o `Icon` que lê `window.lucide.icons` |
| Roteamento | React Router 7 | Substitui o `switch (page)` de `renderPage` |
| Testes | Vitest + Supertest + Playwright | Unitário (domínio), integração (API), e2e (fluxos por perfil) |
| Lint | ESLint 9 flat + `typescript-eslint` strict-type-checked + Prettier | Exigência de lint feito e código fortemente tipado |
| Container | Docker multi-stage + Compose | Deploy em produção pelo CI |

### Regras de tipagem (não negociáveis)

`tsconfig` com `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`.
ESLint com `no-explicit-any` como **erro**, `no-unsafe-*` ligados,
`no-floating-promises`, `consistent-type-imports`. IDs de entidades usam branded
types (`ClientId`, `TripId`) para que um `clientId` nunca entre onde se espera um
`tripId`. Dinheiro trafega como `string` decimal na API (nunca `number`) e é
manipulado com `Prisma.Decimal` / `decimal.js` no servidor.

---

## 3. Estrutura do repositório

```
Sistema-de-controle-de-Voos/
├── .github/workflows/
│   ├── ci.yml                  # lint + typecheck + testes + build (PR e push)
│   └── deploy.yml              # build/push imagens + deploy por senha (main)
├── docker/
│   ├── api.Dockerfile
│   ├── web.Dockerfile
│   ├── nginx.conf
│   └── compose.prod.yml        # o que roda no servidor
├── prisma/
│   ├── schema.prisma           # ← já criado
│   ├── migrations/
│   └── seed.ts                 # importa os dados mockados de seed() do protótipo
├── packages/
│   └── shared/
│       ├── src/domain/         # chStatus, balance, checkConflict, cálculo de tarifa
│       ├── src/contracts/      # schemas Zod de request/response
│       ├── src/permissions.ts  # catálogo de permissões + matriz por papel
│       └── src/labels.ts       # o objeto `L` do protótipo, tipado
├── apps/
│   ├── api/
│   │   └── src/
│   │       ├── modules/        # aircraft, tariff, client, trip, request,
│   │       │                   # charge, payment, availability, dashboard,
│   │       │                   # report, document, notification, changes, auth
│   │       ├── plugins/        # prisma, auth, rbac, errors, logger, cors, rate-limit
│   │       ├── jobs/           # overdue, aggregates, purge-documents, prune-feed
│   │       └── server.ts
│   └── web/
│       └── src/
│           ├── features/       # espelha os módulos da API
│           ├── components/ui/  # Btn, Card, Badge, Modal, Field, Stat... (do protótipo)
│           ├── lib/api-client.ts
│           ├── lib/use-change-feed.ts   # polling de 10s
│           └── routes/
├── docs/PLANO.md               # este arquivo
├── src/index.html              # protótipo — mantido como referência visual
└── .env.example
```

Cada módulo da API tem sempre os mesmos 4 arquivos: `*.routes.ts` (HTTP + Zod),
`*.service.ts` (regra + transação), `*.repository.ts` (Prisma) e `*.dto.ts`
(serialização por perfil). O DTO é o que garante que o cliente nunca receba
aeronave nem tarifa.

---

## 4. Autorização

Modelo: **RBAC com permissões granulares + escopo por linha + filtro de campo**.
Tabelas `Role`, `Permission`, `RolePermission`, `UserPermission` (override
`allow`/`deny`, onde `deny` sempre vence).

### 4.1 Matriz

`R` = ler tudo · `Ro` = ler só o próprio · `C` criar · `U` atualizar · `D`
remover · `—` sem acesso

| Recurso | Operacional | Financeiro | Cliente | Admin |
|---|---|---|---|---|
| `aircraft` | R C U D | — | — | R C U D |
| `tariff` | R C U | — | — | R C U |
| `client` | R C U | R | Ro Uo | R C U D |
| `trip` | R C U + `cancel` `complete` | R | Ro | tudo |
| `request` | R + `review` `convert` `reject` | — | Ro Co | tudo |
| `charge` | R (leitura) | R C | Ro | tudo |
| `payment` | **—** | R C + `settle` `reverse` | — | tudo |
| `availability` | completo | — | **mascarado** | completo |
| `settings` | R U | R | — | R U |
| `report:financial` | — | R | — | R |
| `document` | R | — | Co + Ro | R |
| `user` / `role` | — | — | — | R C U D |
| `audit` | — | — | — | R |

Os três limites que vêm do `HANDOFF.md` e são aplicados no servidor:

1. **Operacional não dá baixa.** Nenhuma permissão `payment:*`.
2. **Financeiro não altera viagens.** Apenas `trip:read`.
3. **Cliente só vê o próprio e nunca vê a frota.** `Ro`/`Co` + DTO reduzido.

### 4.2 Como é aplicado (três camadas)

```ts
// 1. Rota — permissão exigida, verificada antes do handler
app.post('/trips', { preHandler: requirePermission('trip:create') }, handler)

// 2. Escopo por linha — injetado no where, não checado depois
const scope = clientScope(user)          // { clientId: user.clientId } | {}
prisma.trip.findMany({ where: { ...filters, ...scope } })

// 3. Campo — DTO por perfil, na saída
export function toTripDTO(trip: TripWithRelations, viewer: Viewer) {
  const base = { id, code, origin, destination, departureAt, returnAt,
                 passengers, status, notes }
  if (viewer.role === 'cliente') return base          // sem aeronave, sem tarifa
  return { ...base, aircraft: trip.aircraft, internalTariff: trip.internalTariff,
           flightHours: trip.flightHours, estimatedValue: trip.estimatedValue,
           commercialValue: trip.commercialValue }
}
```

O tipo de retorno do DTO é discriminado pelo perfil, então **o próprio
compilador** impede que um handler de cliente devolva `internalTariff`.

O frontend recebe a lista de permissões em `GET /api/auth/me` e usa para
esconder botões — mas isso é só UX. A decisão é sempre do servidor.

---

## 5. API

Todas as rotas sob `/api`, JSON, autenticadas por access token (JWT curto, 15
min) + refresh token httpOnly rotativo (7 dias, hash SHA-256 no banco).

```
POST   /auth/login                     POST   /auth/refresh
POST   /auth/logout                    GET    /auth/me
POST   /auth/change-password

GET    /aircraft                       POST   /aircraft
GET    /aircraft/:id                   PATCH  /aircraft/:id        DELETE /aircraft/:id
GET    /tariffs                        POST   /tariffs             PATCH  /tariffs/:id
GET    /clients                        POST   /clients
GET    /clients/:id                    PATCH  /clients/:id         GET    /clients/:id/summary

GET    /trips                          POST   /trips               (nasce confirmada)
GET    /trips/:id                      PATCH  /trips/:id
POST   /trips/:id/cancel               POST   /trips/:id/complete
POST   /trips/check-availability       (checkConflict no servidor)

GET    /requests                       POST   /requests            (só cliente)
GET    /requests/:id
POST   /requests/:id/review            POST   /requests/:id/reject
POST   /requests/:id/convert           (cria a viagem e marca convertida)

GET    /charges                        POST   /charges
GET    /charges/:id
POST   /charges/:id/payments           POST   /charges/:id/settle  (baixa total)
GET    /payments                       POST   /payments/:id/reverse

GET    /availability/calendar?from&to  (completo p/ interno, mascarado p/ cliente)
GET    /dashboard/operacional          GET    /dashboard/financeiro
GET    /dashboard/cliente              GET    /reports/financial

POST   /documents                      GET    /documents/:id       (stream autorizado)
GET    /notifications                  POST   /notifications/:id/read
GET    /settings                       PATCH  /settings
GET    /changes?since=<seq>            ← polling de 10s
GET    /health                         GET    /ready
```

Listagens são paginadas por cursor (`?cursor=&limit=`, máx. 100) com busca e
filtros server-side. Os endpoints `/dashboard/*` e `/reports/financial` devolvem
todos os indicadores da tela em **uma** chamada, com os agregados calculados em
SQL — nunca montados no cliente.

---

## 6. Polling de 10 segundos

O caminho ingênuo (cada tela pedindo sua lista a cada 10s) multiplica requisição
por tela aberta e transfere o dataset inteiro sem necessidade. A solução é
**uma** requisição a cada 10s, que devolve só o delta.

Cada mutação grava uma linha em `ChangeFeed` (`seq` autoincremento, `entity`,
`entityId`, `action`, `clientScopeId`) **dentro da mesma transação** da escrita.
Se a transação falhar, não há evento fantasma.

```ts
// apps/web/src/lib/use-change-feed.ts
export function useChangeFeed() {
  const qc = useQueryClient()
  const cursor = useRef<string | null>(null)

  useQuery({
    queryKey: ['changes'],
    queryFn: async () => {
      const res = await api.get('/changes', { since: cursor.current })
      cursor.current = res.seq
      if (res.reset) { qc.invalidateQueries(); return res }   // cursor antigo demais
      const keys = new Set(res.changes.map(c => ENTITY_TO_QUERY_KEY[c.entity]))
      for (const key of keys) qc.invalidateQueries({ queryKey: [key] })
      return res
    },
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,   // pausa com a aba oculta
  })
}
```

Propriedades:

- **1 requisição / 10s / usuário**, independente de quantas telas estão abertas.
- Nada mudou → resposta de ~40 bytes, uma busca por índice
  (`@@index([clientScopeId, seq])`).
- Invalidação **seletiva**: um pagamento novo invalida `charges` e `clients`, não
  a agenda.
- Isolamento por escopo: o cliente só recebe eventos com
  `clientScopeId = null` (dados públicos internos) ou igual ao seu.
- `since` velho demais (feed podado) → `{ reset: true }` e recarga completa.
- Aba oculta não faz polling; ao voltar, um refetch imediato reconcilia.
- Cabe migrar para SSE/WebSocket depois **sem mudar o front**: o mesmo delta
  passa a ser empurrado em vez de puxado.

`GET /changes` tem rate limit próprio, mais folgado que o resto (6 req/min por
usuário é o esperado).

---

## 7. Sem N+1 e processamento em lote

### 7.1 Os N+1 do protótipo e a correção de cada um

| Onde | Protótipo | Correção |
|---|---|---|
| Nome do cliente em toda linha de tabela | `cn(id)` → `db.clients.find(...)` por linha | `include: { client: { select: { id, name, company } } }` |
| Aeronave em toda linha | `acLabel(id)` / `pf(id)` por linha | `include: { aircraft: { select: { prefix, model, kind } } }` |
| Pago/saldo de cada cobrança | `paid(c)` soma `payments` por linha | colunas `paidAmount` / `balance` (`[DENORM]`) |
| Saldo e situação de cada cliente | `clientBalance` + `clientFin` varrem **todas** as cobranças por linha | colunas `openBalance`, `overdueBalance`, `financialStatus` |
| Contagem de viagens do cliente | `clientTrips` varre `trips` por linha | coluna `tripCount` |
| Código da viagem na cobrança | `tc(id)` → `db.trips.find(...)` por linha | `include: { trip: { select: { code, origin, destination } } }` |
| Tarifa ativa da aeronave | `db.tariffs.find(...)` linear | índice `[aircraftId, active, startDate]` |
| Recebimentos por mês (Relatórios) | `flatMap` de todos os pagamentos no cliente | `payment.groupBy({ by: ['month'], _sum: { amount } })` |
| Calendário de disponibilidade do cliente | `dayStatus` × 42 dias × frota × viagens | 2 queries por janela (viagens + bloqueios) e cálculo O(n) em memória |
| `checkConflict` | varre `db.trips` inteiro | 2 queries por janela usando `[aircraftId, departureAt, returnAt]` |

As colunas `[DENORM]` são mantidas **na mesma transação** da mutação que as
afeta. Nunca há leitura-modificação-escrita fora de transação:

```ts
await prisma.$transaction(async (tx) => {
  const payment = await tx.payment.create({ data: { chargeId, amount, ... } })
  const charge  = await tx.charge.update({
    where: { id: chargeId },
    data: {
      paidAmount: { increment: amount },
      balance:    { decrement: amount },   // atômico no MySQL, sem race
    },
  })
  await tx.charge.update({ where: { id: chargeId }, data: { status: settlementStatus(charge) } })
  await refreshClientAggregates(tx, charge.clientId)   // 1 groupBy + 1 update
  await tx.changeFeed.createMany({ data: [
    { entity: 'charge', entityId: chargeId,        action: 'updated', clientScopeId: charge.clientId },
    { entity: 'client', entityId: charge.clientId, action: 'updated', clientScopeId: charge.clientId },
  ]})
})
```

Regra de revisão de PR: **nenhum `await` dentro de `for`/`map` sobre resultado de
query.** Toda relação vem por `include`; toda busca múltipla usa
`where: { id: { in: [...] } }`; toda escrita múltipla usa `createMany` /
`updateMany` / `$transaction`. Em desenvolvimento, um middleware do Prisma conta
queries por requisição e falha o teste se passar do orçamento definido por rota.
`connection_limit=10` na `DATABASE_URL` (backend single-instance).

### 7.2 Jobs em lote

Todos processam em blocos de `BATCH_SIZE` (500) com cursor, para nunca travar
tabela nem estourar memória.

| Job | Cron | O que faz |
|---|---|---|
| `refreshOverdueCharges` | `*/5 * * * *` | `updateMany` marcando `vencido` onde `dueDate < hoje AND balance > 0 AND status IN (pendente, parcial)`. É o que mantém `chStatus` correto sem depender de leitura |
| `refreshClientAggregates` | `*/10 * * * *` | `groupBy` de cobranças por cliente → `$transaction` de updates em blocos. Rede de segurança do cálculo transacional |
| `dispatchEmailOutbox` | a cada 30s | Envia a fila de e-mail (§13): busca `pendente AND nextAttemptAt <= now()` pelo índice, envia em lote, backoff exponencial no erro |
| `pruneChangeFeed` | `0 * * * *` | `deleteMany` de eventos com mais de 24h |
| `purgeExpiredDocuments` | `0 3 * * *` | Remove documentos de passageiro além da retenção (`documentRetentionDays`) — obrigação LGPD |
| `notifyUpcomingDueDates` | `0 8 * * *` | Notificações de vencimento próximo, em lote por cliente |

Inserções em massa também são em lote: passageiros de uma viagem entram com um
único `createMany` (não N inserts), e o `prisma/seed.ts` carrega os dados de
`seed()` do protótipo com `createMany` por tabela dentro de uma transação.

---

## 8. Docker

Duas imagens, ambas multi-stage e rodando como usuário não-root.

**`docker/api.Dockerfile`** — `deps` (npm ci, deps de produção) → `build`
(`prisma generate` + `tsc`) → `runtime` (`node:22-alpine`, só `dist/` +
`node_modules` de produção + engine do Prisma). Porta 1701. Healthcheck em
`/api/health`. `CMD` roda `prisma migrate deploy` e sobe o servidor.

**`docker/web.Dockerfile`** — build Vite → `nginx:alpine` servindo os estáticos,
com fallback de SPA e proxy de `/api` para o serviço `api`. Porta 1700.

**`docker/compose.prod.yml`** — os dois serviços, `restart: unless-stopped`,
`env_file: .env`, imagens vindas do GHCR por tag, `depends_on` com healthcheck.
O MySQL **não** entra no Compose: já existe no servidor.

```yaml
services:
  api:
    image: ghcr.io/rodrigolessa1980/sistema-de-controle-de-voos-api:${IMAGE_TAG}
    ports: ["1701:1701"]
    env_file: [.env]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:1701/api/health"]
      interval: 30s
  web:
    image: ghcr.io/rodrigolessa1980/sistema-de-controle-de-voos-web:${IMAGE_TAG}
    ports: ["1700:80"]
    depends_on: { api: { condition: service_healthy } }
    restart: unless-stopped
```

---

## 9. CI/CD no GitHub

### `ci.yml` — em todo PR e push

`npm ci` → `prisma validate` → `eslint` (zero warnings)
→ `tsc --noEmit` em todos os pacotes → `vitest run` (unit + integração contra
MySQL de serviço) → `npm run build` → `docker build` das duas imagens (sem push).
Merge bloqueado se qualquer etapa falhar.

### `deploy.yml` — push em `main` (ou tag `v*`)

1. Build e push das imagens para o **GHCR**, com tag `sha-<commit>` e `latest`
   (autenticação pelo `GITHUB_TOKEN` — não precisa de segredo extra).
2. Monta o `.env` de produção a partir dos secrets do repositório.
3. Copia `.env` + `compose.prod.yml` para o servidor e sobe.

Como **não há chave SSH, só senha**, o passo de deploy usa `sshpass`. O host é
fixado com `ssh-keyscan` antes, para não abrir mão da verificação de host:

```yaml
- name: Deploy por SSH (autenticação por senha)
  env:
    SSHPASS: ${{ secrets.SERVER_PASSWORD }}
    HOST:    ${{ secrets.SERVER_HOST }}
    USER:    ${{ secrets.SERVER_USER }}
    APP_DIR: ${{ vars.SERVER_APP_DIR }}
  run: |
    sudo apt-get update -qq && sudo apt-get install -y sshpass
    mkdir -p ~/.ssh && ssh-keyscan -H "$HOST" >> ~/.ssh/known_hosts   # pin do host
    sshpass -e scp docker/compose.prod.yml .env.prod "$USER@$HOST:$APP_DIR/"
    sshpass -e ssh "$USER@$HOST" bash -se <<'EOF'
      set -euo pipefail
      cd "$APP_DIR"
      mv .env.prod .env && chmod 600 .env
      echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
      docker compose -f compose.prod.yml pull
      docker compose -f compose.prod.yml up -d --remove-orphans
      docker compose -f compose.prod.yml exec -T api npx prisma migrate deploy
      docker image prune -f
    EOF
```

`sshpass -e` lê a senha de `SSHPASS`, então ela nunca aparece na linha de
comando nem no log. Migrations rodam **depois** do container subir e antes de
considerar o deploy concluído; se `migrate deploy` falhar, o job falha.

Healthcheck pós-deploy contra `http://SERVER_HOST:1701/api/health` e
`:1700`; falhando, o job reverte para a tag anterior.

### 9.1 Chaves a cadastrar no repositório

**Secrets** (`Settings → Secrets and variables → Actions → Secrets`):

| Nome | Conteúdo |
|---|---|
| `MYSQL_HOST` | IP do servidor de banco |
| `MYSQL_PORT` | `3306` |
| `MYSQL_USER` | usuário do banco |
| `MYSQL_PASSWORD` | senha do banco |
| `MYSQL_DATABASE` | `aircharter` |
| `DATABASE_URL` | `mysql://user:senha%40encoded@host:3306/aircharter?connection_limit=10` |
| `SERVER_HOST` | IP do servidor de aplicação |
| `SERVER_USER` | usuário de deploy |
| `SERVER_PASSWORD` | senha de deploy |
| `JWT_ACCESS_SECRET` | gerado (48 bytes) |
| `JWT_REFRESH_SECRET` | gerado (48 bytes) |
| `COOKIE_SECRET` | gerado (32 bytes) |
| `ENCRYPTION_KEY` | gerado (32 bytes hex) |
| `MAIL_API_KEY` | chave do provedor de e-mail (§13.3) — **ainda não definido** |

**Variables** (não são segredo — ficam legíveis no log, e é bom que fiquem):

| Nome | Valor |
|---|---|
| `PORT_FRONTEND` | `1700` |
| `PORT_BACKEND` | `1701` |
| `SERVER_APP_DIR` | `/opt/aircharter` |
| `POLL_INTERVAL_MS` | `10000` |
| `TZ` | `America/Sao_Paulo` |
| `MAIL_PROVIDER` | `resend` \| `ses` \| `sendgrid` |
| `MAIL_FROM` | ex.: `nao-responda@aircharter.com.br` |

O script [`scripts/setup-github-secrets.ps1`](../scripts/setup-github-secrets.ps1)
cadastra tudo de uma vez via `gh`.

### 9.2 Ambientes

`production` como GitHub Environment com **required reviewer**, para que ninguém
publique em produção sem aprovação. Os secrets de deploy ficam no environment,
não no repositório — assim um PR de fork nunca os alcança.

---

## 10. Fases de entrega

Checklist vivo. `[x]` está feito e verificado; `[ ]` é o que falta. É a partir
daqui que a próxima sessão de trabalho começa.

### Fase 0 · Fundação

- [x] Monorepo npm workspaces (`packages/shared`, `apps/api`, `apps/web`)
- [x] TypeScript `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`
- [x] ESLint 9 flat com `strictTypeChecked`, zero warning tolerado
- [x] Prettier e EditorConfig
- [x] Vitest configurado (unitário + integração)
- [x] Dockerfiles da API e do frontend, nginx, compose de produção
- [x] `.github/workflows/ci.yml`
- [x] `.gitignore` cobrindo `.env` e todo tipo de credencial
- [x] CI executado de verdade no GitHub — verde em `f21e749`

### Fase 1 · Dados

- [x] `prisma/schema.prisma` — 23 modelos, 15 enums
- [x] Migration inicial aplicada no MySQL
- [x] Banco de teste (`aircharter_test`) separado, com as mesmas migrations
- [x] `seed.ts` **estrutural**: papéis, permissões, configurações, sequências, admin
- [x] Catálogo de 52 permissões em `packages/shared/src/permissions.ts`
- [x] **Nenhum dado mock** — seed de demonstração removido, banco expurgado
- [x] Script `purge-operational-data.mjs` com dry-run e dupla confirmação

### Fase 2 · Autenticação e autorização

- [x] Login com senha, para todos os perfis
- [x] Refresh token rotativo em cookie httpOnly, hash SHA-256 no banco
- [x] Reuso de token revogado derruba a sessão inteira
- [x] Bloqueio após 5 tentativas falhas
- [x] `GET /auth/me` com permissões efetivas
- [x] Troca de senha, obrigatória quando `mustChangePassword`
- [x] `requirePermission` em `preValidation` (antes da validação do corpo)
- [x] Escopo por linha injetado no `where`
- [x] DTO por perfil (`tripInternalSchema` vs `tripClientSchema`)
- [x] Testes provando os 3 limites da §4.2 — 25 casos de integração

### Fase 3 · Operacional

- [x] Aeronaves — CRUD com remoção lógica
- [x] Tarifas — CRUD com total calculado no servidor
- [x] Clientes — CRUD com agregados denormalizados
- [x] Viagens — criar, editar, cancelar, concluir
- [x] `POST /trips/check-availability` (conflito, margem, bloqueio)
- [x] `GET /trips/pricing-preview` (horas de voo e valor estimado)
- [x] Solicitações — analisar, recusar, converter em viagem
- [x] Agenda mês/semana/dia
- [x] Bloqueios e manutenções
- [x] 6 telas do frontend

### Fase 4 · Financeiro

- [x] Cobranças — criar e listar com filtro por status
- [x] Pagamento parcial com `increment`/`decrement` atômico
- [x] Baixa (quitação total em um comando)
- [x] Estorno com recálculo do zero
- [x] Painel financeiro agregado em SQL
- [x] Relatórios: recebimentos por mês, distribuição por status, maiores saldos
- [x] 5 telas do frontend

### Fase 5 · Cliente

- [x] Solicitar voo com documento obrigatório de cada passageiro
- [x] Upload de documento com verificação de magic bytes
- [x] Download só por rota autenticada e com vínculo comprovado
- [x] Disponibilidade mascarada (só o status do dia)
- [x] Minhas viagens, financeiro e perfil
- [x] Nenhum campo de frota ou tarifa na resposta do cliente — testado
- [x] 6 telas do frontend

### Fase 6 · Tempo real e avisos

- [x] `ChangeFeed` gravado na mesma transação da mutação
- [x] `GET /api/changes` com cursor e escopo por cliente
- [x] Hook de polling de 10s — uma requisição para o app inteiro
- [x] Invalidação seletiva por entidade
- [x] Sino de notificações funcional
- [x] Fila de e-mail (outbox) com idempotência
- [x] Worker com retry e backoff exponencial
- [x] Aviso de nova solicitação: e-mail **e** sino, destinatários por permissão
- [x] 6 jobs em lote (vencidos, agregados, poda do feed, expurgo, tokens, e-mail)
- [ ] **Provedor de e-mail contratado** — sem ele o envio fica em dry-run (§13.3)
- [ ] SPF e DKIM publicados no domínio

### Fase 7 · Produção

- [x] `deploy.yml` com `sshpass` e fixação da chave do host
- [x] Healthcheck pós-deploy contra `/api/health`, `/api/ready` e `:1700`
- [x] Migrations aplicadas no entrypoint, antes do servidor subir
- [x] Chaves cadastradas no GitHub (§9.1) — 13 secrets e 10 variables, no nível
      do repositório
- [ ] GitHub Environment `production` com required reviewer — **exige admin no
      repositório**, que a conta `JeniferBenites` não tem (`push: true`,
      `admin: false`). Só o dono do repositório consegue criar
- [x] Primeiro deploy executado e verificado no ar — 5 healthchecks em 200 e
      login ponta a ponta com as 52 permissões
- [ ] Senhas rotacionadas e usuário de deploy não-root criado (§11)
- [ ] **HTTPS.** Hoje o acesso é HTTP puro: senha e cookie de sessão trafegam em
      claro. Aceitável para homologar, não para dado real de cliente

### Qualidade — transversal

- [x] 64 testes unitários (regras de domínio, dinheiro, matriz de permissões)
- [x] 25 testes de integração de autorização, contra MySQL real
- [x] 67 testes de integração das operações, contra MySQL real
- [x] **156 testes no total**, todos passando
- [x] Frontend validando com os MESMOS schemas Zod do backend
- [x] Erro do servidor mapeado para o campo do formulário
- [x] `npm run verify`: prisma + lint + typecheck + testes + build

Fases 3, 4 e 5 podem correr em paralelo depois da 2 — módulos independentes.

---

## 11. Segurança — pontos a tratar antes do primeiro deploy

O `.env` com credenciais de produção estava **fora** do `.gitignore` antigo
(que cobria só `node_modules/`, `.DS_Store` e `*.log`). Verifiquei o histórico:
o repositório tem um único commit e o `.env` **nunca** foi versionado — mas
estava a um `git add -A` de ir para o GitHub. O novo `.gitignore` fecha isso.

Recomendações, em ordem de prioridade:

1. **Rotacionar a senha atual.** Ela é ao mesmo tempo a senha do MySQL e a senha
   de `root` do servidor, e já circulou fora do cofre. Duas senhas distintas,
   novas, só nos secrets do GitHub.
2. **Parar de usar `root` para deploy.** Criar um usuário de deploy no grupo
   `docker`, sem `sudo` irrestrito. Se o CI for comprometido, o dano é o app.
3. **Usuário MySQL dedicado.** `aircharter_app` com privilégio apenas no schema
   `aircharter`, em vez do usuário atual.
4. **Fechar a 3306.** Hoje o MySQL responde em IP público. Restringir por
   firewall ao IP do runner, ou rodar as migrations de dentro do container (que
   é o que o `deploy.yml` faz) e bloquear o acesso externo por completo.
5. **Documentos de passageiro são dado sensível (LGPD).** Fora do diretório
   servido pelo nginx, download só por rota autenticada e autorizada, com
   retenção e expurgo automático (`purgeExpiredDocuments`).
6. **Senha de SSH no CI.** `sshpass` é a única opção sem chave, mas é mais frágil
   que chave pública. Quando possível, gerar um par de chaves só para o deploy e
   migrar — o `deploy.yml` muda em 3 linhas.

---

## 12. Decisões

### Fechadas — Rodrigo Lessa, 12/08/2026

**Aceite da viagem pelo cliente: não existe.** "A Fernanda marcando já está
confirmada." A viagem nasce `confirmada`, exatamente como no protótipo. Nenhum
status `aguardando_aceite` entra no enum `TripStatus`.

> Pendência que isso cria: o texto da tela de solicitação
> (`src/index.html:1755`) diz *"nossa equipe seleciona a melhor opção e envia a
> viagem para o seu aceite"* — está errado e precisa ser reescrito na migração,
> senão o cliente fica esperando uma tela de aceite que não existe. Sugestão:
> *"nossa equipe seleciona a melhor opção e confirma a sua viagem"*.

**Portal do cliente: login e senha.** Sem link mágico. `User.passwordHash`
continua obrigatório para todos os perfis; nenhum model `LoginToken` é criado.

> Pendência que isso cria: como os 10 clientes já cadastrados recebem a primeira
> senha? O campo `User.mustChangePassword` já existe no schema para o fluxo de
> senha provisória. Ver §12.2.

**Aviso de nova solicitação: e-mail + notificação no sistema.** Toda solicitação
de voo que chega para aprovação dispara um e-mail para quem aprova, **além** do
aviso no sino do sistema. Detalhado na §13.

### 12.1 Ainda em aberto

1. **Fuso horário.** O protótipo congela hoje em `2026-08-11T12:00:00` (`TODAY`).
   Em produção gravo tudo em **UTC** no banco e apresento em
   `America/Sao_Paulo`. Confirma?
2. **`por_trecho` e `diaria`.** As duas unidades de tarifa existem no enum, mas o
   protótipo só calcula `por_hora` (`2 × distanceKm ÷ cruiseSpeed`). Implemento o
   cálculo das outras duas agora ou deixo `por_hora` como único caminho ativo?
3. **Dados de demonstração.** O `seed.ts` carrega as 4 aeronaves, 10 clientes, 4
   tarifas, 8 viagens, 5 solicitações, 6 cobranças e 2 bloqueios do protótipo —
   útil para homologar. Em produção, seed só de permissões, papéis e usuário
   admin. Confirma?

### 12.2 Nova pergunta, criada pela decisão de login e senha

Como o cliente recebe a primeira senha? Três caminhos, todos suportados pelo
schema atual:

- **(a) Senha provisória por e-mail.** O operacional cadastra o cliente, o
  sistema gera senha aleatória, envia por e-mail e marca
  `mustChangePassword = true`. Troca obrigatória no primeiro acesso.
  *É o caminho que eu recomendo* — reaproveita a mesma fila de e-mail do aviso
  de solicitação, que agora é obrigatória de qualquer forma.
- **(b) Convite com link de definição de senha.** O e-mail leva a uma tela onde
  o cliente escolhe a própria senha. Mais limpo, mas exige um model de token de
  convite.
- **(c) Manual.** O operacional define a senha e passa por WhatsApp. Zero
  infraestrutura, mas senha em canal não seguro e trabalho a cada cliente novo.

Junto com isso: **"esqueci minha senha" entra no escopo?** Com senha e sem link
mágico, mais cedo ou mais tarde alguém vai precisar. E o fluxo de recuperação é,
tecnicamente, o mesmo token de uso único do caminho (b).

---

## 13. Avisos: e-mail + notificação no sistema

Requisito do Rodrigo (12/08/2026): *"sempre que chegar uma solicitação para a Fe
aprovar um voo tem que mandar um e-mail avisando que tem aprovação, mais o aviso
no sistema."*

São **dois canais para o mesmo fato**, e nenhum dos dois pode se perder.

### 13.1 Quem recebe

Não vai para um endereço fixo no código. O destinatário é resolvido por
permissão, no momento em que a solicitação é criada:

1. Todos os `User` com `status = ativo` que tenham a permissão
   `request:review` — hoje isso é a Fernanda e quem mais estiver no perfil
   operacional. Amanhã, quem entrar no perfil recebe automaticamente.
2. `settings.contactEmail` (hoje `operacoes@aircharter.com.br`), como caixa
   institucional.
3. `settings.notifyExtraEmails`, para endereços fora do sistema.

Fixar o e-mail da Fernanda no código significa que, no dia em que ela sair de
férias, ninguém é avisado. Amarrar na permissão resolve isso sem deploy.

### 13.2 Como não se perde nem duplica

O envio **não** acontece dentro do handler. O padrão é *outbox*:

```ts
await prisma.$transaction(async (tx) => {
  const request = await tx.flightRequest.create({ data: { ...dados, code } })
  await tx.passenger.createMany({ data: pax })            // 1 insert, não N

  // aviso no sistema — um insert para todos os aprovadores
  await tx.notification.createMany({
    data: approvers.map((u) => ({
      userId: u.id, type: 'solicitacao_nova',
      title: `Nova solicitação ${request.code}`,
      body: `${cliente.name} · ${request.origin} → ${request.destination}`,
      entity: 'request', entityId: request.id,
    })),
  })

  // aviso por e-mail — enfileirado, não enviado
  await tx.emailOutbox.create({
    data: {
      dedupeKey: `request.created:${request.id}`,          // idempotência
      recipients: recipients.join(','),
      subject: `Nova solicitação de voo ${request.code} — aprovação pendente`,
      template: 'solicitacao-nova',
      payload: { code, clienteNome, origem, destino, ida, volta, pax, link },
    },
  })

  await tx.changeFeed.create({ data: { entity: 'request', entityId: request.id,
                                       action: 'created' } })
})
```

Tudo na mesma transação. As três consequências:

- Se a transação der rollback, **não sai e-mail de uma solicitação que não
  existe** — que é exatamente o que aconteceria com `sendMail()` no handler.
- Se o SMTP estiver fora do ar, a linha fica na fila e o worker tenta de novo. O
  aviso não se perde em silêncio.
- O cliente recebe a resposta HTTP na hora. O tempo do SMTP (que pode ser
  segundos) não entra na latência da requisição.

O `dedupeKey` é `@unique`. Um retry do worker, um duplo clique no botão ou dois
processos concorrentes não geram um segundo e-mail.

Um worker roda a cada 30s: busca `status = pendente AND nextAttemptAt <= now()`
pelo índice `[status, nextAttemptAt]`, envia em lote, e no erro aplica backoff
exponencial (1min, 4min, 15min, 1h, 4h). Após `maxAttempts = 5`, marca `falhou` —
e aí o alerta é operacional, não silencioso.

O `payload` nunca leva dado sensível: **nenhum documento de passageiro sai por
e-mail**. O e-mail carrega o resumo e um link para o sistema; o documento só é
visto na rota autenticada.

### 13.3 Isso torna o e-mail uma dependência obrigatória

Vale registrar a ironia, porque muda o planejamento: descartamos o link mágico
em parte pelo custo de montar infraestrutura de e-mail — mas o aviso de
aprovação exige exatamente a mesma infraestrutura. **O provedor de e-mail
transacional agora é pré-requisito**, e ele não existe no `.env` atual.

Precisa de um provedor com SPF e DKIM configurados no domínio, senão o aviso vai
para a caixa de spam da Fernanda e o requisito não é cumprido de fato:

| Opção | Nota |
|---|---|
| **Resend** | Melhor DX, 3.000 e-mails/mês grátis. Recomendado |
| **Amazon SES** | Mais barato em volume, configuração mais burocrática |
| **SendGrid** | Consolidado, 100/dia grátis |
| SMTP próprio no servidor | Não recomendado: entregabilidade ruim, IP de VPS quase sempre cai em spam |

Variáveis novas no `.env` e nos secrets: `MAIL_PROVIDER`, `MAIL_API_KEY`,
`MAIL_FROM`, `MAIL_FROM_NAME`, `MAIL_REPLY_TO`. Já estão em `.env.example`.

**Decisão necessária: qual provedor, e quem tem acesso ao DNS do domínio para
publicar SPF/DKIM?** Sem isso, a Fase 6 não fecha.

### 13.4 Outros avisos que o mesmo mecanismo cobre

Uma vez montada a fila, esses saem quase de graça. O enum `NotificationType` já
os prevê:

| Fato | Quem recebe | Canal |
|---|---|---|
| Nova solicitação de voo | aprovadores (`request:review`) | e-mail + sino |
| Solicitação convertida em viagem | cliente | e-mail + sino |
| Solicitação recusada | cliente | e-mail + sino |
| Viagem cancelada | cliente + operacional | e-mail + sino |
| Cobrança criada | cliente | sino (e-mail opcional) |
| Cobrança vencendo em 3 dias | cliente | e-mail + sino |
| Pagamento recebido | financeiro | sino |

Sugiro ligar só o primeiro na Fase 6 (é o que foi pedido) e deixar os demais
atrás de flags em `Settings`, para o Rodrigo ligar um a um sem deploy.

---

## 14. Documentos irmãos

| Documento | O que traz |
|---|---|
| [`STATUS.md`](STATUS.md) | O placar: o que roda, o que está bloqueado, as correções de rota e a divergência de cálculo do protótipo |
| [`REGRAS.md`](REGRAS.md) | As duas regras estruturais: o front exigindo o que o back exige, e nenhum dado inventado |
| [`DEPLOY.md`](DEPLOY.md) | O ensaio de deploy já executado e o que falta para publicar de verdade |
