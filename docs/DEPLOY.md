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
push das imagens no GHCR → `sshpass` copia `.env` e `compose.prod.yml` para o
servidor → `docker compose up -d` → healthcheck. Se o healthcheck falhar, o job
falha.

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
5. **HTTPS.** Hoje o deploy expõe HTTP puro em `:1700`. O cookie de refresh sai
   sem a flag `Secure` porque ela quebraria em HTTP — o que significa que a
   sessão trafega em claro. Um proxy com TLS (Caddy ou nginx com Let's Encrypt)
   na frente resolve, e aí `secure: isProduction` passa a valer de fato.
