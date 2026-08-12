# HANDOFF técnico — conectar o banco de dados

Este é um protótipo **frontend-only**. Todo o estado vive em memória (React) e é
persistido no `localStorage`. Para plugar um backend real, o trabalho é
substituir a camada de dados (leitura/escrita) por chamadas de API, mantendo as
mesmas regras de negócio.

## Onde está a camada de dados (arquivo `src/index.html`)

Tudo está em um único `<script type="text/babel">`. Pontos de interesse:

- `seed()` → objeto inicial com todos os dados mockados (a "carga" do banco).
- `const STORE_KEY = 'acm-html-v4'` e `loadDb()` → leitura do `localStorage`.
- `function App()` → guarda o estado `db` e persiste em `localStorage` via
  `useEffect(... JSON.stringify(db) ...)`.
- `const actions = useMemo(() => ({ ... }))` dentro de `App` → **todas as
  mutações** (addTrip, updateTrip, setTripStatus, addClient, addRequest,
  setRequestStatus, addAircraft, updateAircraft, removeAircraft, addTariff,
  updateTariff, addCharge, addPayment, updateSettings). **É aqui que se troca
  `setDb(...)` por `fetch('/api/...')`.**
- Selectors/regras puras (reaproveitar no backend): `paid`, `balance`,
  `chStatus`, `clientBalance`, `clientFin`, `checkConflict` (conflito de agenda +
  margem entre voos), e o cálculo de tarifa dentro de `TripForm`
  (distância × velocidade → horas de voo → valor).

### Estratégia de migração sugerida
1. Criar a API e o schema (abaixo).
2. Trocar `loadDb()` por um carregamento inicial via API (ou carregar por
   recurso, sob demanda).
3. Trocar cada função de `actions` por `POST/PUT/PATCH/DELETE` correspondentes.
4. Remover a persistência em `localStorage` (o `useEffect` que salva `db`).
5. Mover as regras (`chStatus`, `checkConflict`, cálculo de tarifa) para o
   servidor como fonte de verdade (o frontend pode manter cópia para UX).

## Modelo de dados (entidades e campos)

> Enums em `snake_case` conforme usados no código.

### aircraft (aeronave)
`id, prefix, kind (aviao|helicoptero), model, manufacturer, capacity:int,
cruiseSpeed:int (km/h), status (disponivel|em_voo|manutencao|indisponivel)`

### client (cliente)
`id, name, phone, email, document, company`

### tariff (tarifa)
`id, aircraftId→aircraft, value:number (total por hora = soma dos custos),
costs { combustivel, horaVoo, taxas, despesaPiloto } (números, R$/h),
unit (por_hora|por_trecho|diaria), startDate:date, endDate:date?, active:bool`

### trip (viagem)
`id, code (VOO-xxxx), clientId→client, aircraftId→aircraft,
origin, destination, departureAt:datetime, returnAt:datetime,
distanceKm:number?, passengers:int,
pax: [ { id, name, doc (dataURL da foto do documento) } ],
notes?, status (confirmada|recusada|em_andamento|concluida|cancelada),
internalTariff:number, estimatedValue:number, commercialValue:number`

> Observação: `pax[].doc` hoje é uma imagem em base64 (dataURL). No backend,
> troque por upload de arquivo (S3/afins) e guarde a URL. Documentos são de
> passageiros — trate como dado sensível (LGPD).

### flight_request (solicitação de voo — feita pelo Cliente)
`id, code (SOL-xxxx), clientId→client, origin, destination,
departureAt, returnAt, passengers:int, pax: [ { id, name, doc } ],
notes?, status (aguardando_analise|em_analise|convertida|recusada)`

### charge (cobrança)
`id, code (COB-xxxx), clientId→client, tripId→trip?, total:number, dueDate:date,
payments: [ { id, amount:number, date:date, method (pix|transferencia|boleto|cartao|dinheiro), note? } ]`

### aircraft_block (bloqueio/manutenção)
`id, aircraftId→aircraft, kind (manutencao|bloqueio), reason, startAt, endAt`

### settings
`companyName, contactEmail, timezone, marginMinutes:int`

## Regras de negócio a manter no servidor

- **Status financeiro da cobrança** (`chStatus`): `pago` se pago ≥ total;
  `parcial` se pago > 0 e não vencido; `vencido` se vencido e saldo > 0;
  `pendente` caso contrário. `saldo = max(0, total − somaPagamentos)`.
- **Situação do cliente** (`clientFin`): `vencido` se tem alguma cobrança vencida;
  `pendente` se tem saldo em aberto; senão `em_dia`.
- **Conflito de agenda** (`checkConflict`): a mesma aeronave não pode ter dois
  compromissos sobrepostos (voos + bloqueios), respeitando também a
  **margem mínima entre voos** (`settings.marginMinutes`). Fórmula de
  sobreposição: `inicioA < fimB && fimA > inicioB`.
- **Cálculo de tarifa**: `horasVoo = 2 × distanceKm ÷ cruiseSpeed` (ida e volta);
  `valorEstimado = tarifa.value × horasVoo`. `commercialValue` é editável pelo
  Operacional.
- **Fluxo de agendamento**: o **Operacional agenda direto** (viagem nasce
  `confirmada`, sem aprovação). O **Cliente solicita** (cria `flight_request`);
  o Operacional aprova agendando (a solicitação vira `convertida`).
- **Permissões**: Operacional cria/edita viagens e não dá baixa; Financeiro dá
  baixa/registra pagamentos e não altera viagens; Cliente nunca vê aeronave,
  prefixo, modelo, tipo nem tarifa interna, e só enxerga os próprios dados.

## Sugestão de endpoints (REST)

```
GET/POST/PATCH/DELETE  /aircraft
GET/POST/PATCH         /clients
GET/POST/PATCH         /tariffs
GET/POST/PATCH         /trips           (POST agenda direto = confirmada)
GET/POST/PATCH         /requests        (cliente cria; PATCH muda status)
GET/POST               /charges
POST                   /charges/:id/payments   (pagamento parcial/total/baixa)
GET/PATCH              /settings
POST                   /trips/check-availability   (roda checkConflict no server)
```

Autenticação real (login por perfil) substitui o seletor "Visualizar como".
