# Estado da implementação

Complemento do [`PLANO.md`](PLANO.md) com o que efetivamente ficou pronto.

O sistema foi construído e verificado contra o MySQL de **produção**
(`aircharter`, MySQL 8.0.42). O que segue é o placar
honesto — o que roda, o que está bloqueado e o que descobri no caminho.

---

## 1. Fases

| Fase | Situação |
|---|---|
| **0 · Fundação** | Monorepo npm, TypeScript strict, ESLint com zero warning, Vitest, Dockerfiles, workflows |
| **1 · Dados** | Migration aplicada — 23 tabelas criadas. Seed **só estrutural**: papéis, permissões, configurações e o administrador |
| **2 · Auth/RBAC** | Login, autocadastro com liberação pelo admin, refresh rotativo, `requirePermission`, escopo por linha, DTO por perfil |
| **3 · Operacional** | 6 telas · `check-availability` · cálculo de tarifa · conversão de solicitação |
| **4 · Financeiro** | 5 telas · cobrança · pagamento · baixa · estorno · relatórios |
| **5 · Cliente** | 6 telas · upload de documento · disponibilidade mascarada |
| **6 · Tempo real** | `ChangeFeed` · `GET /api/changes` · polling de 10s · sino · fila de e-mail · 6 jobs |
| **7 · Produção** | **No ar.** Chaves cadastradas, CI e Deploy verdes, healthchecks e login verificados. Falta HTTPS, rotação de senhas e o required reviewer |

Números: 23 tabelas, 16 módulos de API, ~54 rotas, 19 telas, 52 permissões,
**194 testes** (69 unitários + 25 de autorização + 70 de operações + 30 de
cadastro e liberação de acesso). Bundle do frontend: 258 kB (61 kB gzip).

---

## 2. Verificado em execução, contra o banco real

Não são testes com mock — são chamadas HTTP contra a API conectada ao MySQL.

### Os três limites do `HANDOFF.md`

| Verificação | Resultado |
|---|---|
| Operacional tentando dar baixa (`POST /charges/:id/settle`) | **403** |
| Financeiro tentando criar viagem (`POST /trips`) | **403** |
| Cliente pedindo a frota (`GET /aircraft`) | **403** |
| Cliente pedindo tarifas | **403** |
| Cliente pedindo a agenda completa | **403** |
| Cliente pedindo relatório financeiro | **403** |
| Cliente pedindo o cadastro de OUTRO cliente | **403** |
| Cliente pedindo o próprio cadastro | **200** |

### Autocadastro e liberação de acesso

Formulário público na tela de login (nome, e-mail e senha) + fila de liberação em
**Configurações → Permissões**. 25 casos em `registration.test.ts`:

| Verificação | Resultado |
|---|---|
| Cadastro pela tela de login | conta criada com `status: pendente` |
| Login em conta pendente **com a senha certa** | **403**, nenhum token, nenhum cookie |
| Login em conta pendente com a senha errada | **401** com a mensagem genérica |
| E-mail já cadastrado tentando se cadastrar | **200 igual**, nada gravado, conta original intacta |
| Operacional / Financeiro / Cliente lendo `GET /users` | **403** |
| Operacional tentando liberar alguém como `admin` | **403** |
| Papel fora do enum (`superadmin`) | **422** antes de qualquer escrita |
| Admin liberando como Operacional | **200** · login passa a funcionar com as permissões do papel |
| Liberar o mesmo cadastro duas vezes | **400** · o papel concedido não muda |
| Liberar como Cliente sem vínculo | cria o cadastro do cliente |
| Liberar como Cliente com e-mail de cliente existente | reaproveita o cadastro, não duplica |
| Recusar | linha apagada, e-mail livre para novo cadastro, auditoria preservada |

### O sino avisa e leva até a fila

| Verificação | Resultado |
|---|---|
| Cadastro novo | aviso `cadastro_pendente` para quem tem `user:update` |
| Operacional / Financeiro / Cliente | **não** recebem o aviso |
| Corpo do aviso | nome e e-mail de quem pediu |
| Destino do clique | `/operacional/configuracoes?aba=permissoes` |
| Cliente clicando um aviso qualquer | nunca cai em rota interna (`notificationPath`) |
| Liberar ou recusar | aviso marcado como lido, **inclusive dos outros admins** |
| Aviso de cadastro recusado | sobrevive ao delete do usuário (histórico do sino) |

### DTO por perfil

A viagem `VOO-2044` devolvida ao cliente `cl-3` traz exatamente 13 campos:
`id, code, clientId, client, origin, destination, departureAt, returnAt,
passengers, notes, status, pax, createdAt`.

**Nenhum** campo de frota ou tarifa. A mesma viagem, pedida pelo operacional,
traz `aircraft: PR-HLX`, `internalTariff: 8500.00`, `flightHours: 5.7`,
`commercialValue: 96000.00`.

### Regras de negócio

| Cenário | Resultado |
|---|---|
| Sobreposição direta com `VOO-2041` | recusado · `reason: trip` |
| Início 20 min após o fim, margem de 45 | recusado · `reason: margin` |
| Janela dentro da manutenção da `ac-3` | recusado · `reason: block` |
| Janela livre | liberado |
| Agendar para cliente com R$ 92.000 vencidos, sem confirmar | **422** com o valor em aberto |
| O mesmo, com `acknowledgeDebt: true` | criada · `VOO-2051` · `scheduledWithDebt: true` |
| Solicitação do cliente sem foto do documento | **422** |

Códigos sequenciais saem do banco (`CodeSequence`), não de contador em memória:
`VOO-2051`, `SOL-1191` foram emitidos em ordem, sem colisão.

### O requisito do Rodrigo — e-mail + aviso no sistema

Solicitação `SOL-1191` criada pelo cliente disparou, **na mesma transação**:

```
fila de e-mail  [pendente] request.created:cmsq9d5q7000mtoq8vpak64tn
                para   : fernanda@aircharter.com.br, admin@aircharter.com.br,
                         operacoes@aircharter.com.br
                assunto: Nova solicitação de voo SOL-1191 — aprovação pendente

sino            [solicitacao_nova] Nova solicitação SOL-1191
                Fernando Tavares · Belo Horizonte (PLU) → Ilheus (IOS)
```

Os destinatários foram **resolvidos por permissão** (`request:review`), não
fixos no código — por isso o admin entrou na lista automaticamente. O worker
processou a fila no ciclo seguinte e marcou `enviado`, com
`providerMessageId: dry-run:...` porque ainda não há provedor.

### Polling de 10 segundos

| Situação | Resposta |
|---|---|
| Primeira chamada (sem cursor) | `seq=3`, 0 mudanças — só o topo, sem histórico |
| Nada mudou | **38 bytes** |
| Após um pagamento | 3 mudanças: `charge:updated`, `payment:created`, `client:updated` |
| Cliente `cl-3` consultando o mesmo intervalo | **0 eventos** (o pagamento era do `cl-1`) |

O isolamento por escopo funciona: o feed não revela nem a existência de
atividade de outro cliente.

### Financeiro

`COB-3301` recebeu R$ 20.000 → `pago: 60.000`, `saldo: 72.000`,
`status: parcial`. `COB-3295` recebeu baixa → `saldo: 0`, `status: pago`, e o
cliente André Nogueira passou de `vencido` para `em_dia` na mesma transação.

---

## 3. Bloqueado por decisão externa

**1. Provedor de e-mail não definido.** Sem `MAIL_API_KEY`, o worker roda em
dry-run: enfileira, registra no log e marca como enviado, mas nada sai. O aviso
da Fernanda só chega de verdade depois de contratar o provedor e publicar
SPF/DKIM no domínio (`PLANO.md` §13.3).

**2. Environment `production` sem proteção — e não é falta de autenticação.**
As 13 chaves e 10 variables **foram cadastradas** (`DEPLOY.md` §2.1). O que
ficou de fora é o environment com *required reviewer*: a API responde

```
PUT /repos/.../environments/production → 403 "Must have admin rights"
```

A conta que publica tem `push: true` e `admin: false`. Só o dono do repositório
cria o environment. Sem ele, o GitHub cria um sozinho no primeiro deploy, **sem
required reviewer** — ou seja, todo push em `main` vai direto para produção.

**3. As decisões em aberto** da §12.1: fuso horário e as unidades de tarifa
`por_trecho` e `diaria`. (A terceira — se o seed de demonstração iria para
produção — deixou de existir: não há mais seed de demonstração.)

---

## 4. Uma divergência que vale conferir antes de faturar

**Os valores de exemplo do protótipo não batem com a fórmula do próprio
protótipo.**

A viagem `VOO-2041` tem 360 km de trecho, Phenom 300E a 860 km/h e tarifa de
R$ 12.000/h. A fórmula do `HANDOFF.md` dá:

```
horas = 2 × 360 ÷ 860 = 0,84 → 0,8 h
valor = 12.000 × 0,8      = R$ 9.600
```

Mas o dado mockado diz `estimatedValue: 120000` — doze vezes mais.

A implementação segue a **fórmula**, porque é ela que o HANDOFF define como
regra de negócio. Só que R$ 9.600 por um São Paulo–Rio ida e volta em jato
executivo está muito abaixo do mercado, o que sugere que a fórmula ignora algo
real: mínimo de horas faturadas, tempo de solo, voo de posicionamento, ou uma
tarifa que não é por hora de voo pura.

Como não existe mais nenhum dado de demonstração, não há valor literal em lugar
nenhum: toda viagem criada usa a fórmula. **Vale confirmar com o Rodrigo antes de
emitir cobrança por esse cálculo** — se a fórmula estiver incompleta, o erro sai
em nota fiscal.

---

## 5. Correções de rota durante a construção

Coisas que quebraram na verificação e o que foi feito:

**Autorização rodava depois da validação do corpo.** Com `preHandler`, quem não
tinha permissão recebia 422 com os detalhes de validação — o schema da rota era
revelado a quem não podia usá-la. Movido para `preValidation`, que roda antes.

**Transação de agendamento estourava o timeout.** O padrão do Prisma é 5s,
calibrado para banco local; com o MySQL remoto, as ~13 idas ao banco passavam
disso e a viagem falhava com "Transaction already closed", sem nada de errado no
domínio. As leituras de validação saíram da transação (a verificação de conflito
ficou dentro, que é onde precisa ser atômica) e o timeout subiu para 20s.

**Bundle de 996 kB.** `import * as Lucide` arrastava a biblioteca de ícones
inteira. Trocado por imports nomeados: 242 kB.

**Ordem do seed.** O usuário do portal tem FK para `Client`, e os usuários eram
criados antes dos clientes.

**Duas versões do Vite no monorepo** (5 pela dependência do Vitest, 6 no app),
que davam conflito de tipos no `vite.config.ts`. Unificadas na 6.

**O relatório financeiro devolvia 500 — e o teste foi quem achou.** O
`$queryRaw` que agrupa recebimentos por mês estava tipado como
`{ y: number; m: number }`, mas o MySQL devolve `YEAR()` e `MONTH()` como
BIGINT, e o Prisma preserva isso: chegavam `2026n` e `8n`, `bigint`. O
compilador não tinha como perceber — a anotação de tipo de um `$queryRaw` é uma
promessa do programador, não uma verificação. Só o schema Zod de resposta
percebia, em tempo de execução, e aí a rota inteira virava 500.

Não era um caso de borda: bastava existir **um** pagamento no sistema para a
tela de relatórios quebrar. Com o banco vazio o `GROUP BY` não devolve linha
nenhuma, então em homologação passaria despercebido até o primeiro recebimento.
Corrigido com `Number()` na conversão e o tipo declarado como `bigint`, que é a
verdade.

**Três testes vermelhos que eram defeito do teste, não do sistema.** Vale
registrar porque a assinatura se repete:

| Sintoma | Causa |
|---|---|
| "duplicidade de e-mail não dá 409" | os clientes se chamavam `'A'` e `'B'`, reprovavam no `min(2)` do nome e morriam em 422 antes de chegar ao banco |
| "a margem de 90 minutos não é respeitada" | a viagem de apoio tinha `origin: 'A'`, reprovava igual, e a agenda ficava mesmo livre |
| "a margem começa em 90, não em 45" | `Settings` é uma linha só — não há o que apagar, então escapava do reset e o valor gravado por uma rodada contaminava a seguinte |

As duas primeiras passaram a conferir o status da criação antes de julgar o
efeito: um teste que não verifica o próprio cenário acusa a falha errada. A
terceira virou reset explícito das configurações em `resetData`.

---

## 6. O que só a produção encontrou

Dois defeitos que passaram por CI verde, deploy verde e healthcheck verde, e
mesmo assim deixaram o sistema inutilizável. Estão detalhados em
[`DEPLOY.md`](DEPLOY.md) §5; o que vale registrar aqui é o padrão.

**A sessão não sobrevivia a uma recarga.** O cookie de refresh saía com a flag
`Secure` porque a opção estava amarrada em `isProduction`. Produção é HTTP puro,
e o navegador descarta um cookie `Secure` recebido por HTTP **sem dizer nada**.
Resultado: `POST /api/auth/refresh` respondia 401 para sempre, a tela ficava em
"Restaurando sessão…" e voltava para o login. Quem responde "isto é HTTPS?" é
`WEB_BASE_URL`, não `NODE_ENV` — a opção passou a ser `secure: isHttps`.

**Todo `GET /api/notifications` respondia 500.** O ENUM
`NotificationType` ganhou `cadastro_pendente` **direto no banco de produção**,
aplicado pela máquina local, e o código que conhece esse valor ainda não tinha
sido publicado. Uma linha com o valor novo foi gravada em seguida, e o Prisma
Client da imagem no ar passou a estufar em toda leitura.

A causa comum é uma só: **o `.env` de desenvolvimento aponta `DATABASE_URL` para
o banco de PRODUÇÃO.** Enquanto isso for verdade, `npm run prisma:migrate` migra
a produção e `npm run dev` grava na produção — o banco anda na frente da imagem
publicada, que é exatamente a ordem que quebra. Migration de produção tem um
caminho só: o entrypoint da API, com o código que a entende já dentro da imagem.

**O que os dois dizem sobre o healthcheck.** `/api/health` pergunta se o processo
subiu; `/api/ready`, se o banco responde. Nenhum dos dois faz login nem lê uma
rota autenticada — e foi exatamente aí que os dois defeitos moraram. Um passo de
verificação que autenticasse e lesse uma rota real teria pego os dois no deploy,
em vez de deixar o usuário descobrir.
