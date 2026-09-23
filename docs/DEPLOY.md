# Deploy

Como publicar em produção, e o que já foi verificado.

---

## 1. Ensaio local — feito e aprovado

O caminho completo do deploy foi executado nesta máquina, com as mesmas imagens
e o mesmo `compose.prod.yml` que vão para o servidor. Só o passo do SSH ficou de
fora, porque depende das chaves no GitHub.

| Verificação | Resultado |
|---|---|
| `docker build -f docker/api.Dockerfile` | imagem gerada |
| `docker build -f docker/web.Dockerfile` | imagem gerada (76 MB) |
| `docker compose -f compose.prod.yml up -d` | dois containers **healthy** |
| Migrations no entrypoint, antes do servidor subir | `[entrypoint] aplicando migrations…` |
| `GET :1701/api/health` | 200 |
| `GET :1701/api/ready` (confirma o banco) | 200 |
| `GET :1700/health` (nginx) | 200 |
| `GET :1700/` (SPA) | 200 |
| `GET :1700/api/health` (proxy do nginx para a API) | 200 |
| `GET :1700/operacional/viagens` (fallback de SPA) | 200 |
| `POST :1700/api/auth/login` ponta a ponta | 200 · admin com 52 permissões |

São exatamente as verificações que o passo "Verificar a saúde após o deploy" do
`deploy.yml` faz contra o servidor.

O ensaio rodou apontado para o banco **de teste** (`aircharter_test`), não o de
produção.

### Dois defeitos que o ensaio encontrou

**`COPY --from=deps /app/apps/web/node_modules` falhava.** O npm decide sozinho
o que hoista para a raiz e o que fica em `apps/*/node_modules`, e esse layout
muda conforme a resolução de versões. Os dois Dockerfiles passaram a copiar
`/app` inteiro, que é indiferente a essa decisão.

**A imagem da API tem 1,18 GB.** Vem do engine do Prisma somado às dependências
de produção. Funciona, mas vale reduzir depois — `prisma generate --no-engine`
com Accelerate, ou um estágio que descarte os engines de plataformas que não
são usadas.

---

## 2. O que falta para publicar de verdade

### 2.0 Caminho curto

Um único comando faz tudo — instala o `gh` se preciso, autentica, cadastra as
chaves, tenta criar o environment, dispara o deploy e verifica se subiu:

```powershell
./scripts/publicar.ps1
```

**Não para em nenhum passo interativo** se a máquina já tiver uma credencial do
GitHub guardada (o caso de quem já deu `git push` alguma vez): o script a
reaproveita via `GH_TOKEN`. Só cai no `gh auth login` quando o cofre está vazio.

Os passos avulsos estão abaixo, para quem preferir fazer um de cada vez.

### 2.1 Cadastrar as chaves no GitHub — **FEITO**

**13 secrets e 10 variables cadastrados** em
`rodrigolessa1980/Sistema-de-controle-de-Voos`, no nível do repositório.

Não foi preciso `gh auth login`: a máquina já tinha uma credencial do GitHub
armazenada pelo Git Credential Manager (token `gho_`, escopos `gist, repo,
workflow`), a mesma que o `git push` usa. O `gh` aceita essa credencial por
`GH_TOKEN`, então o script rodou sem nenhum passo interativo.

```powershell
./scripts/setup-github-secrets.ps1         # -WhatIf para simular antes
```

O script lê o `.env`, monta a `DATABASE_URL` com a senha percent-encoded, **gera
na hora** os segredos criptográficos (JWT, cookie, encryption) e cadastra tudo.
Nenhum valor é impresso nem gravado em arquivo.

| Secrets (13) | Variables (10) |
|---|---|
| `MYSQL_HOST` `MYSQL_PORT` `MYSQL_USER` `MYSQL_PASSWORD` `MYSQL_DATABASE` | `PORT_FRONTEND` `PORT_BACKEND` |
| `DATABASE_URL` | `SERVER_APP_DIR` `POLL_INTERVAL_MS` |
| `SERVER_HOST` `SERVER_USER` `SERVER_PASSWORD` | `TZ` `NODE_ENV` |
| `JWT_ACCESS_SECRET` `JWT_REFRESH_SECRET` `COOKIE_SECRET` `ENCRYPTION_KEY` | `MAIL_PROVIDER` `MAIL_FROM` `MAIL_FROM_NAME` `MAIL_REPLY_TO` |

`MAIL_API_KEY` **não** foi cadastrada: não há provedor de e-mail contratado. O
`deploy.yml` detecta a ausência e sobe com `MAIL_DRY_RUN=1`, em vez de acumular
falha na fila.

### 2.2 Criar o Environment `production` — **exige o dono do repositório**

Este passo **não pôde ser feito** e não é questão de autenticação:

```
PUT /repos/.../environments/production
→ 403 "Must have admin rights to Repository."
```

A conta `JeniferBenites` tem `push: true` e `admin: false` no repositório —
suficiente para cadastrar secrets e publicar código, insuficiente para criar
environment ou definir regra de proteção. Só **rodrigolessa1980** consegue.

Enquanto isso não for feito, o `deploy.yml` continua declarando
`environment: production`, e o GitHub cria o environment sozinho na primeira
execução — **sem required reviewer**. Ou seja: hoje, qualquer push em `main`
publica direto em produção, sem aprovação.

Para fechar isso, o dono do repositório precisa ir em
**Settings → Environments → production** e marcar *Required reviewers*.

### 2.3 Disparar o deploy

Push em `main`, ou **Actions → Deploy → Run workflow**.

O fluxo é: verificações (lint, tipos, testes contra um MySQL efêmero) → build e
push das imagens no GHCR → `sshpass` copia `.env`, `compose.prod.yml`,
`deploy.sh` e a config da borda para o servidor → `deploy.sh deploy <tag>`
(blue-green, §6) → verificação externa da versão servida. Se qualquer etapa
falhar antes da troca, a versão no ar não é tocada.

---

## 3. Estado do servidor — **no ar**

O deploy foi executado e verificado. Commit `f21e749`, CI e Deploy verdes.

| Verificação | Resultado |
|---|---|
| `GET :1701/api/health` | 200 |
| `GET :1701/api/ready` (confirma o banco) | 200 |
| `GET :1700/health` (nginx) | 200 |
| `GET :1700/` (SPA) | 200 |
| `GET :1700/api/health` (proxy do nginx) | 200 |
| `POST :1700/api/auth/login` | 200 · admin com 52 permissões |

### Dois defeitos que só o CI encontrou

**O `deploy.yml` não compilava.** `jobs.<id>.environment.url` não aceita o
contexto `secrets`, e o arquivo usava `${{ secrets.SERVER_HOST }}` ali. O
GitHub rejeita o workflow inteiro sem mensagem pela API — o run aparece com
zero jobs e com o caminho do arquivo no lugar do nome, que foi o que denunciou.
Trocar por `vars` compilaria e seria pior: variables não são mascaradas, e os
logs de repositório público são públicos. O `url` saiu.

**A suíte de testes dependia de existir um `.env` na máquina.** `env.ts` valida
o ambiente na importação e chama `process.exit(1)` — certo em produção, fatal
num teste: o Vitest morre inteiro. `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` e
`COOKIE_SECRET` não têm padrão e o setup só forçava `DATABASE_URL`. Localmente
passava porque o `.env` estava lá; no runner, 92 casos viravam "skipped".
Agora o `setup.ts` define os três.

### Portas

| Item | Situação |
|---|---|
| SSH (porta 22) | aberta |
| Porta 1700 (frontend) | **no ar** |
| Porta 1701 (API) | **no ar** |
| MySQL (porta 3306) | acessível de fora — deveria ser fechada (§4.4) |

---

## 4. Antes do primeiro deploy de verdade

Estes pontos continuam abertos e valem mais que a conveniência de publicar hoje
(detalhe em [`PLANO.md`](PLANO.md) §11):

1. **Rotacionar a senha.** A mesma senha serve o MySQL e o `root` do servidor.
   Duas senhas distintas, novas, só nos secrets do GitHub.
2. **Parar de usar `root` para deploy.** Um usuário no grupo `docker`, sem
   `sudo` irrestrito: se o CI for comprometido, o dano fica no app.
3. **Usuário MySQL dedicado**, com privilégio só no schema `aircharter`.
4. **Fechar a 3306 para o mundo.** As migrations rodam de dentro do container,
   então o acesso externo pode ser bloqueado por completo.
5. **HTTPS.** Hoje o deploy expõe HTTP puro em `:1700`, e por isso o cookie de
   refresh sai sem a flag `Secure` (`secure: isHttps`, derivado de
   `WEB_BASE_URL`) — o que significa que a sessão trafega em claro. Um proxy com
   TLS (Caddy ou nginx com Let's Encrypt) na frente resolve, e a flag volta
   sozinha assim que `WEB_BASE_URL` virar `https://`: não há chave para lembrar
   de virar.

---

## 5. Dois defeitos que só a produção encontrou

Ambos derrubados no commit que registrou esta seção. Nenhum dos dois aparecia no
CI, e nenhum dos dois derrubou o processo — o `docker ps` mostrava
`Up (healthy)`, `/api/health` e `/api/ready` respondiam 200, e o deploy ficou
verde enquanto o sistema estava inutilizável.

**A sessão não sobrevivia a uma recarga.** `refreshCookieOptions` usava
`secure: isProduction`. Em produção isso é `true`, e o navegador **descarta em
silêncio** um cookie `Secure` recebido por HTTP. O `acm_refresh` nunca era
gravado; `POST /api/auth/refresh` respondia 401 para sempre; a tela ficava em
"Restaurando sessão…" e voltava para o login. Do lado do servidor não havia erro
nenhum: o login era 200 e o `Set-Cookie` saía correto. Só o navegador sabia.
`NODE_ENV` descreve o modo de execução, não o protocolo da porta — quem responde
"é HTTPS?" é `WEB_BASE_URL`.

**Todo `GET /api/notifications` respondia 500.** A migration que acrescenta
`cadastro_pendente` ao ENUM foi aplicada **direto no banco de produção pela
máquina local**, e o código que conhece esse valor não tinha sido publicado. Uma
linha com o valor novo foi gravada em seguida (também pela máquina local), e o
Prisma Client da imagem no ar passou a estufar em toda leitura:
`Value 'cadastro_pendente' not found in enum 'NotificationType'`.

A causa comum dos dois é a mesma, e é ela que vale corrigir: **o `.env` de
desenvolvimento aponta `DATABASE_URL` para o banco de PRODUÇÃO.** Enquanto isso
for verdade, `npm run prisma:migrate` migra a produção e `npm run dev` grava na
produção — o banco anda na frente da imagem publicada, que é exatamente a ordem
que quebra. Migration de produção tem um caminho só: o entrypoint da API, depois
do build, com o código que a entende já dentro da imagem.

O healthcheck do deploy não pega nada disso porque só pergunta se o processo
subiu e se o banco responde. Uma verificação que fizesse login e lesse uma rota
autenticada teria pegado os dois.

---

## 6. Deploy blue-green

Desde a introdução do `docker/deploy.sh`, **publicar não derruba o sistema**. A
versão nova sobe ao lado da atual, é testada, e só então passa a receber o
tráfego. Quem está com a tela aberta vê o card **"Nova versão disponível"** e
atualiza quando quiser.

### 6.1 Topologia no servidor

```
:1700 / :1701 ──▶ aircharter-edge (nginx) ──▶ vaga ativa ──┬─ web-blue  + api-blue
                                                          └─ web-green + api-green
```

- **Borda** (`docker/edge/nginx.conf`): o único container com porta pública.
  Não tem versão; repassa para a vaga escrita em `edge/state/active-slot.conf`.
  `/api` vai direto para a API da vaga, o resto para o web da vaga.
- **Vagas** `blue` e `green`: mesmas imagens, tags diferentes (em `slots.env`).
  As duas montam o mesmo volume de documentos.

### 6.2 O que o `deploy.sh deploy <tag>` faz

1. Baixa as imagens da tag e sobe **a API na vaga parada** — as migrations rodam
   no entrypoint dela. Espera ficar saudável (se o container reiniciar sozinho,
   falha na hora e mostra o log).
2. Sobe o **web da vaga parada** e espera ficar saudável.
3. **Testa a vaga nova por dentro**, antes de qualquer usuário chegar nela:
   `version.json` e `/api/health` na versão certa, `/api/ready` (banco), página
   inicial e — com `SMOKE_EMAIL`/`SMOKE_PASSWORD` — **login e três rotas
   autenticadas**. É a verificação que teria pegado os dois defeitos da §5.
4. **Troca a borda** (`nginx -s reload`: gracioso, as requisições em andamento
   terminam na vaga antiga) e confirma pela borda que a versão nova é a servida.
5. Espera 30 s e **para** a vaga antiga, sem remover — ela fica pronta para o
   rollback.

Falhou em 1, 2 ou 3 → a vaga nova é parada, o job fica vermelho e **a versão no
ar continua intacta**.

### 6.3 Rollback

**Actions → Rollback → Run workflow** (digitando `ROLLBACK`), ou no servidor:
`./deploy.sh rollback`. Religa a vaga anterior, testa, e devolve a borda para
ela em segundos. Rodar de novo desfaz o rollback. `./deploy.sh status` mostra a
vaga ativa e as tags.

Só existe versão para voltar enquanto a vaga anterior não foi reaproveitada: um
deploy que **falhou** usou essa vaga, e aí o rollback fica indisponível até o
próximo deploy bem-sucedido.

### 6.4 Card "Nova versão disponível"

A tag da imagem é gravada no bundle (`__APP_VERSION__`) e em `/version.json`,
servido sem cache. A tela consulta esse arquivo a cada minuto e ao voltar o
foco; quando diverge, mostra o card (`apps/web/src/components/UpdatePrompt.tsx`).
**Atualizar** recarrega a página; **Depois** esconde por 15 minutos. Nada
recarrega sozinho, então ninguém perde um formulário pela metade.

Quem não atualiza continua funcionando: o bundle inteiro já está na memória do
navegador (as rotas não são carregadas sob demanda).

### 6.5 Regras que passam a valer

As duas versões convivem por um tempo — a antiga atende enquanto a nova é
testada, e telas abertas seguem na versão antiga até o usuário clicar em
Atualizar. Por isso:

1. **Toda migration precisa ser compatível com a versão anterior.** Ela é
   aplicada pela vaga nova enquanto a antiga ainda está no ar, e o rollback não
   desfaz o banco. Acrescentar coluna/tabela, afrouxar `NOT NULL`, acrescentar
   valor no fim de um ENUM: pode. Apagar, renomear, apertar restrição: em dois
   deploys — primeiro o código para de usar, depois a migration remove.
2. **A API nova precisa aceitar a tela antiga.** Campo novo obrigatório no
   corpo de uma rota quebra quem ainda não atualizou. Novo campo entra como
   opcional; a exigência vem num deploy seguinte.
3. **Jobs rodam nas duas vagas durante a sobreposição.** Hoje isso é seguro:
   todos são idempotentes e a fila de e-mail reivindica cada mensagem com um
   `updateMany` atômico. Job novo precisa manter essa propriedade.

### 6.6 Conta do teste de login (recomendado)

Cadastre os secrets `SMOKE_EMAIL` e `SMOKE_PASSWORD` no GitHub com uma conta
**dedicada** (qualquer papel serve — as rotas testadas só exigem estar logado),
que **já tenha trocado a senha provisória** (senão `/api/notifications`
responde 403 e o deploy é barrado). Sem os secrets o deploy funciona, mas pula
o teste de login e avisa no log.

### 6.7 Primeira execução (transição)

O primeiro deploy com o `deploy.sh` encontra o deploy antigo
(`aircharter-api`/`aircharter-web`) ocupando as portas. A vaga nova sobe e é
testada normalmente; só depois os containers antigos são removidos e a borda
assume as portas. **É a única vez com interrupção — alguns segundos.** Daí em
diante, nenhuma.
