# Regras do sistema

Complemento do [`PLANO.md`](PLANO.md) com as duas regras estruturais decididas
nesta rodada e como elas são aplicadas.

---

## 1. O front exige exatamente o que o back exige

### O problema

Se o formulário tem regra própria ("nome com 2+ caracteres") e o servidor tem
outra ("`min(2)` depois de `trim`"), elas divergem no primeiro ajuste que alguém
fizer só de um lado. O usuário preenche algo que parece válido, clica em salvar
e leva 422 — sem saber por quê, porque a mensagem do servidor não está ligada a
nenhum campo da tela.

### A solução

`apps/web/src/lib/form.ts` expõe `validateBody(schema, body)`, que roda
`schema.safeParse` antes de enviar. O `schema` é **o mesmo objeto Zod** de
`@acm/shared` que a rota do Fastify declara em `schema.body`. Não é uma cópia da
regra: é a regra.

```ts
const result = validateBody(createTripBodySchema, raw);

if (!result.ok) {
  setErrors(result.errors); // { origin: 'Informe a origem' }
  return; // a requisição nem sai do navegador
}

save.mutate(raw);
```

Se passa no front, passa no back.

### O que só o servidor sabe

Conflito de agenda, e-mail já cadastrado, cliente com pendência — regras que
dependem do banco e não cabem num schema. Elas voltam no `details` do 422 e
`setServerErrors` as mapeia para o mesmo `FieldErrors`:

```ts
onError: (error) => {
  if (error instanceof ApiRequestError) setServerErrors(error.details);
  notifyError(error);
};
```

O campo errado fica destacado nos dois casos, não só num toast.

### Onde está ligado

| Formulário | Contrato |
| --- | --- |
| Viagem | `createTripBodySchema` / `updateTripBodySchema` |
| Cliente | `createClientBodySchema` / `updateClientBodySchema` |
| Aeronave | `createAircraftBodySchema` / `updateAircraftBodySchema` |
| Tarifa | `createTariffBodySchema` / `updateTariffBodySchema` |
| Cobrança | `createChargeBodySchema` |
| Pagamento | `createPaymentBodySchema` |
| Solicitação de voo | `createFlightRequestBodySchema` |

### O que isto NÃO é

**O front não é a barreira de segurança.** Qualquer pessoa abre o console e
manda o que quiser. O servidor continua validando tudo, e os testes de
integração provam isso batendo direto na API com corpo inválido — sem passar
pela tela.

O ganho é de experiência: uma requisição que o back vai recusar não sai mais do
navegador, e quando o servidor recusa por uma regra própria, o motivo aparece no
campo certo.

---

## 2. Nenhum dado inventado

### A regra

O sistema nasce vazio. Não existe aeronave, cliente, tarifa nem viagem de
exemplo. `npm run seed` cria apenas o que a aplicação precisa para funcionar:

- papéis e permissões (a matriz de `@acm/shared`);
- o registro único de configurações;
- as sequências de código (VOO / SOL / COB);
- o usuário administrador.

### Por quê

O motivo é operacional, não estético. Um seed que inventa frota e cliente cria
um estado que ninguém sabe se é real. Meses depois, alguém emite uma cobrança em
cima de uma tarifa que foi escrita como exemplo — e não há como distinguir,
olhando o banco, o que veio da operação e o que veio do seed.

Havia um sintoma concreto disso: os valores de exemplo do protótipo **não batiam
com a própria fórmula dele** (ver [`STATUS.md`](STATUS.md) §4). Um dado assim,
carregado por padrão, é uma armadilha esperando alguém.

### Consequências

- `npm run seed` não aceita mais `--demo`; a flag deixou de existir;
- **não há senha padrão no código.** Sem `ADMIN_EMAIL` e `ADMIN_PASSWORD` no
  ambiente, o seed falha em vez de criar um acesso previsível;
- rodar o seed de novo **não redefine** a senha de quem já usa o sistema;
- os arquivos do protótipo saíram do repositório (recuperáveis em `a38f83b`);
- o banco de produção foi expurgado: 10 clientes, 4 aeronaves, 4 tarifas, 9
  viagens, 6 solicitações, 6 cobranças, 8 pagamentos e 3 usuários de teste.

### A exceção: `seed:demo`

Depois desta regra ficar de pé, os dados do protótipo foram recarregados a
pedido, para dar o que ver nas telas. Isso **não** revoga a regra — muda onde
ela é aplicada:

- o `seed.ts`, que roda em toda instalação, continua estritamente estrutural;
- os dados fictícios vivem num arquivo separado, `prisma/seed-demo.ts`, que
  exige `--confirm` e recusa rodar se já houver cliente no banco;
- ele não recalcula nada por conta própria: grava os fatos e chama
  `recalculateCharge`, `refreshClientAggregates` e o job `refreshOverdueCharges`
  — as mesmas funções da API. Um seed que reimplementa a regra financeira é um
  segundo lugar para a regra divergir.

`flightHours` das viagens fica **nulo**, de propósito. O protótipo não
registrava, e calcular pela fórmula produziria um número que não explica o
`estimatedValue` gravado ao lado (a divergência da [`STATUS.md`](STATUS.md) §4).
Nulo é honesto; número inventado, não.

Os documentos de identificação dos passageiros também não vieram: no protótipo
eram um SVG de exemplo embutido, e um placeholder no lugar sugeriria que existe
algo verificado ali.

### Como limpar de novo

```bash
node scripts/purge-operational-data.mjs            # dry-run: só mostra
node scripts/purge-operational-data.mjs --confirm  # apaga de verdade
```

Preserva papéis, permissões, configurações, sequências e o admin. Imprime o
inventário do que vai apagar antes de tocar em qualquer coisa, e em terminal
interativo pede o nome do banco como segunda confirmação.

### Nos testes

Os testes de integração criam o que precisam em um banco separado
(`aircharter_test`) e limpam entre os casos. `apps/api/test/setup.ts` recusa
rodar se `TEST_DATABASE_URL` apontar para `aircharter` — o banco de produção
nunca é tocado por teste.

---

## 3. Credenciais

Nenhuma credencial, senha, chave ou IP de servidor aparece em arquivo rastreado
pelo git. A verificação é reproduzível:

```bash
git ls-files --cached --others --exclude-standard | while read -r f; do
  [ -f "$f" ] && grep -lE "SUA_SENHA|SEU_IP" "$f"
done
```

O `.gitignore` cobre `.env`, `.env.*` (menos `.env.example`), `*.env`,
`secrets/`, `*.pem`, `*.key`, chaves SSH, `.npmrc` e `.netrc`.

Os segredos de produção vivem nos GitHub Secrets, cadastrados por
`scripts/setup-github-secrets.ps1` — que os **gera na hora** e não imprime nem
grava nenhum valor.
