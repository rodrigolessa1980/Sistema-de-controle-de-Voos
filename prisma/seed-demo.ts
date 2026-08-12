/**
 * Recarrega os dados que existiam no protótipo (`src/index.html`, commit
 * `a38f83b`) dentro do banco real.
 *
 * São exatamente os mesmos registros que apareciam nas telas da primeira
 * versão: 4 aeronaves, 10 clientes, 4 tarifas, 8 viagens, 5 solicitações, 6
 * cobranças com 6 pagamentos e 2 bloqueios de agenda. Nada foi inventado nem
 * arredondado — os valores literais do protótipo estão preservados.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE ARQUIVO É SEPARADO DO `seed.ts`
 *
 * `seed.ts` cria só o estrutural (papéis, permissões, configurações, admin) e
 * roda em qualquer instalação, inclusive produção. Este aqui cria DADO DE
 * NEGÓCIO fictício, e nunca deve rodar sozinho: exige `--confirm` na linha de
 * comando.
 *
 * A distinção importa porque cliente, tarifa e cobrança de demonstração são
 * indistinguíveis dos reais depois de gravados. Quem for usar o sistema para
 * valer precisa apagar tudo antes:
 *
 *     node scripts/purge-operational-data.mjs --confirm
 *
 * ---------------------------------------------------------------------------
 * OS AGREGADOS NÃO SÃO CALCULADOS AQUI
 *
 * `paidAmount`, `balance` e `status` da cobrança, e `openBalance`,
 * `overdueBalance`, `totalInvoiced`, `totalPaid`, `financialStatus` e
 * `tripCount` do cliente são colunas denormalizadas. Em vez de reimplementar a
 * regra — e correr o risco de o seed discordar da aplicação —, este script
 * grava os fatos (cobranças e pagamentos) e depois chama as MESMAS funções que
 * a API usa: `recalculateCharge` e `refreshClientAggregates`.
 *
 * Se a regra de vencido mudar amanhã, os dados semeados mudam junto, sem
 * ninguém precisar lembrar deste arquivo.
 */

import { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';

import { refreshOverdueCharges } from '../apps/api/src/jobs';
import { recalculateCharge, refreshClientAggregates } from '../apps/api/src/lib/aggregates';

const prisma = new PrismaClient();

const confirmar = process.argv.includes('--confirm');
const comPortal = process.argv.includes('--com-portal');

// ============================================================================
//  OS DADOS DO PROTÓTIPO, LITERAIS
// ============================================================================

const AERONAVES = [
  {
    ref: 'ac-1',
    prefix: 'PR-HLX',
    kind: 'helicoptero',
    model: 'AW109 GrandNew',
    manufacturer: 'Leonardo',
    capacity: 6,
    cruiseSpeed: 285,
    status: 'disponivel',
  },
  {
    ref: 'ac-2',
    prefix: 'PT-ABC',
    kind: 'aviao',
    model: 'Phenom 300E',
    manufacturer: 'Embraer',
    capacity: 9,
    cruiseSpeed: 860,
    status: 'em_voo',
  },
  {
    ref: 'ac-3',
    prefix: 'PR-JET',
    kind: 'aviao',
    model: 'Citation CJ4',
    manufacturer: 'Cessna',
    capacity: 8,
    cruiseSpeed: 835,
    status: 'manutencao',
  },
  {
    ref: 'ac-4',
    prefix: 'PP-SKY',
    kind: 'helicoptero',
    model: 'H145',
    manufacturer: 'Airbus',
    capacity: 8,
    cruiseSpeed: 250,
    status: 'disponivel',
  },
] as const;

const CLIENTES = [
  {
    ref: 'cl-1',
    name: 'Ricardo Menezes',
    phone: '(11) 98812-4455',
    email: 'ricardo@grupomz.com.br',
    document: '182.443.900-11',
    company: 'Grupo MZ',
  },
  {
    ref: 'cl-2',
    name: 'Beatriz Almeida',
    phone: '(21) 99745-8820',
    email: 'beatriz@almeidaadv.com.br',
    document: '305.118.220-45',
    company: 'Almeida Advocacia',
  },
  {
    ref: 'cl-3',
    name: 'Fernando Tavares',
    phone: '(31) 98120-3344',
    email: 'fernando@tavares.com',
    document: '411.552.770-09',
    company: 'Agropecuária Tavares',
  },
  {
    ref: 'cl-4',
    name: 'Juliana Prado',
    phone: '(11) 99630-1122',
    email: 'juliana@pradoholding.com',
    document: '228.664.310-77',
    company: 'Prado Holding',
  },
  {
    ref: 'cl-5',
    name: 'Marcos Villela',
    phone: '(41) 98800-5566',
    email: 'marcos@villelaenergia.com.br',
    document: '509.221.884-30',
    company: 'Villela Energia',
  },
  {
    ref: 'cl-6',
    name: 'Camila Rezende',
    phone: '(51) 99123-7788',
    email: 'camila@rezendecorp.com',
    document: '670.334.129-02',
    company: 'Rezende Corp',
  },
  {
    ref: 'cl-7',
    name: 'André Nogueira',
    phone: '(19) 98456-9911',
    email: 'andre@nglogistica.com.br',
    document: '744.910.556-88',
    company: 'NG Logística',
  },
  {
    ref: 'cl-8',
    name: 'Patrícia Lima',
    phone: '(85) 99887-3300',
    email: 'patricia@limaincorp.com',
    document: '155.208.443-19',
    company: 'Lima Incorporadora',
  },
  {
    ref: 'cl-9',
    name: 'Gustavo Peixoto',
    phone: '(11) 98090-4477',
    email: 'gustavo@peixotoinvest.com',
    document: '398.771.002-64',
    company: 'Peixoto Invest',
  },
  {
    ref: 'cl-10',
    name: 'Larissa Fontes',
    phone: '(62) 99341-6655',
    email: 'larissa@fontesagro.com.br',
    document: '820.446.117-53',
    company: 'Fontes Agro',
  },
] as const;

/**
 * As tarifas do protótipo traziam os custos num objeto `costs` com chaves em
 * português (`combustivel`, `horaVoo`, `taxas`, `despesaPiloto`). No banco cada
 * um virou uma coluna própria — o mapeamento está no `schema.prisma`.
 */
const TARIFAS = [
  {
    ref: 'tf-1',
    aeronave: 'ac-1',
    value: 8500,
    costFuel: 3500,
    costFlightHour: 3000,
    costFees: 1000,
    costPilot: 1000,
    unit: 'por_hora',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    active: true,
  },
  {
    ref: 'tf-2',
    aeronave: 'ac-2',
    value: 12000,
    costFuel: 5000,
    costFlightHour: 4000,
    costFees: 1500,
    costPilot: 1500,
    unit: 'por_hora',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    active: true,
  },
  {
    ref: 'tf-3',
    aeronave: 'ac-3',
    value: 11000,
    costFuel: 4500,
    costFlightHour: 3800,
    costFees: 1400,
    costPilot: 1300,
    unit: 'por_hora',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    active: true,
  },
  {
    ref: 'tf-4',
    aeronave: 'ac-4',
    value: 9800,
    costFuel: 4000,
    costFlightHour: 3300,
    costFees: 1300,
    costPilot: 1200,
    unit: 'por_hora',
    startDate: '2026-01-01',
    endDate: null,
    active: true,
  },
] as const;

const VIAGENS = [
  {
    ref: 'tr-1',
    code: 'VOO-2041',
    cliente: 'cl-1',
    aeronave: 'ac-2',
    origin: 'São Paulo (CGH)',
    destination: 'Rio de Janeiro (SDU)',
    departureAt: '2026-08-11T08:00:00',
    returnAt: '2026-08-11T18:00:00',
    passengers: 4,
    notes: 'Cliente prefere embarque antecipado.',
    status: 'confirmada',
    distanceKm: 360,
    internalTariff: 12000,
    estimatedValue: 120000,
    commercialValue: 132000,
  },
  {
    ref: 'tr-2',
    code: 'VOO-2042',
    cliente: 'cl-4',
    aeronave: 'ac-2',
    origin: 'São Paulo (CGH)',
    destination: 'Belo Horizonte (PLU)',
    departureAt: '2026-08-11T14:00:00',
    returnAt: '2026-08-11T21:00:00',
    passengers: 3,
    notes: 'Conflito proposital para teste.',
    status: 'confirmada',
    distanceKm: 490,
    internalTariff: 12000,
    estimatedValue: 84000,
    commercialValue: 90000,
  },
  {
    ref: 'tr-3',
    code: 'VOO-2043',
    cliente: 'cl-6',
    aeronave: 'ac-1',
    origin: 'São Paulo (Faria Lima)',
    destination: 'Campos do Jordão',
    departureAt: '2026-08-11T09:30:00',
    returnAt: '2026-08-11T16:00:00',
    passengers: 5,
    notes: null,
    status: 'confirmada',
    distanceKm: 165,
    internalTariff: 8500,
    estimatedValue: 55250,
    commercialValue: 58000,
  },
  {
    ref: 'tr-4',
    code: 'VOO-2044',
    cliente: 'cl-3',
    aeronave: 'ac-4',
    origin: 'Belo Horizonte (PLU)',
    destination: 'Vitória (VIX)',
    departureAt: '2026-08-15T07:00:00',
    returnAt: '2026-08-16T19:00:00',
    passengers: 4,
    notes: 'Agendada a partir da solicitação SOL-1179.',
    status: 'confirmada',
    distanceKm: 380,
    internalTariff: 9800,
    estimatedValue: 78400,
    commercialValue: 82000,
  },
  {
    ref: 'tr-5',
    code: 'VOO-2045',
    cliente: 'cl-2',
    aeronave: 'ac-1',
    origin: 'Rio de Janeiro (SDU)',
    destination: 'Búzios',
    departureAt: '2026-08-18T10:00:00',
    returnAt: '2026-08-18T20:00:00',
    passengers: 6,
    notes: null,
    status: 'confirmada',
    distanceKm: 150,
    internalTariff: 8500,
    estimatedValue: 85000,
    commercialValue: 89000,
  },
  {
    ref: 'tr-6',
    code: 'VOO-2039',
    cliente: 'cl-8',
    aeronave: 'ac-2',
    origin: 'São Paulo (GRU)',
    destination: 'Brasília (BSB)',
    departureAt: '2026-07-28T06:00:00',
    returnAt: '2026-07-28T22:00:00',
    passengers: 7,
    notes: null,
    status: 'concluida',
    distanceKm: 870,
    internalTariff: 12000,
    estimatedValue: 192000,
    commercialValue: 198000,
  },
  {
    ref: 'tr-7',
    code: 'VOO-2040',
    cliente: 'cl-9',
    aeronave: 'ac-4',
    origin: 'Curitiba (BFH)',
    destination: 'Florianópolis (FLN)',
    departureAt: '2026-08-05T13:00:00',
    returnAt: '2026-08-05T21:00:00',
    passengers: 5,
    notes: null,
    status: 'concluida',
    distanceKm: 250,
    internalTariff: 9800,
    estimatedValue: 78400,
    commercialValue: 80000,
  },
  {
    ref: 'tr-8',
    code: 'VOO-2046',
    cliente: 'cl-7',
    aeronave: 'ac-1',
    origin: 'Goiânia (GYN)',
    destination: 'São Paulo (CGH)',
    departureAt: '2026-08-22T15:00:00',
    returnAt: '2026-08-23T18:00:00',
    passengers: 4,
    notes: null,
    status: 'recusada',
    distanceKm: 810,
    internalTariff: 8500,
    estimatedValue: 93500,
    commercialValue: 96000,
  },
] as const;

const SOLICITACOES = [
  {
    ref: 'rq-1',
    code: 'SOL-1180',
    cliente: 'cl-5',
    origin: 'São Paulo (CGH)',
    destination: 'Angra dos Reis',
    departureAt: '2026-08-20T08:00:00',
    returnAt: '2026-08-21T17:00:00',
    passengers: 4,
    notes: 'Reunião de negócios.',
    status: 'aguardando_analise',
    viagem: null,
    pax: ['Marcos Villela', 'Helena Villela', 'Rafael Costa', 'Sônia Braga'],
  },
  {
    ref: 'rq-2',
    code: 'SOL-1181',
    cliente: 'cl-10',
    origin: 'Goiânia (GYN)',
    destination: 'Caldas Novas',
    departureAt: '2026-08-19T07:30:00',
    returnAt: '2026-08-19T19:00:00',
    passengers: 6,
    notes: null,
    status: 'aguardando_analise',
    viagem: null,
    pax: [],
  },
  {
    // A única já convertida: virou a viagem VOO-2044.
    ref: 'rq-3',
    code: 'SOL-1179',
    cliente: 'cl-3',
    origin: 'Belo Horizonte (PLU)',
    destination: 'Vitória (VIX)',
    departureAt: '2026-08-15T07:00:00',
    returnAt: '2026-08-16T19:00:00',
    passengers: 4,
    notes: null,
    status: 'convertida',
    viagem: 'tr-4',
    pax: [],
  },
  {
    ref: 'rq-4',
    code: 'SOL-1182',
    cliente: 'cl-6',
    origin: 'São Paulo (Faria Lima)',
    destination: 'Ilhabela',
    departureAt: '2026-08-24T09:00:00',
    returnAt: '2026-08-24T18:00:00',
    passengers: 5,
    notes: null,
    status: 'em_analise',
    viagem: null,
    pax: [],
  },
  {
    ref: 'rq-5',
    code: 'SOL-1183',
    cliente: 'cl-2',
    origin: 'Rio de Janeiro (SDU)',
    destination: 'Petrópolis',
    departureAt: '2026-08-27T10:00:00',
    returnAt: '2026-08-27T16:00:00',
    passengers: 3,
    notes: 'Voo panorâmico + almoço.',
    status: 'aguardando_analise',
    viagem: null,
    pax: ['Beatriz Almeida', 'Carlos Almeida', 'Diego Martins'],
  },
] as const;

const COBRANCAS = [
  {
    ref: 'ch-1',
    code: 'COB-3301',
    cliente: 'cl-1',
    viagem: 'tr-1',
    total: 132000,
    dueDate: '2026-07-30',
    pagamentos: [{ amount: 40000, paidAt: '2026-07-15', method: 'pix' }],
  },
  {
    ref: 'ch-2',
    code: 'COB-3302',
    cliente: 'cl-3',
    viagem: 'tr-4',
    total: 82000,
    dueDate: '2026-08-20',
    pagamentos: [{ amount: 30000, paidAt: '2026-08-05', method: 'transferencia' }],
  },
  {
    ref: 'ch-3',
    code: 'COB-3298',
    cliente: 'cl-8',
    viagem: 'tr-6',
    total: 198000,
    dueDate: '2026-08-05',
    pagamentos: [
      { amount: 100000, paidAt: '2026-07-25', method: 'pix' },
      { amount: 98000, paidAt: '2026-08-02', method: 'transferencia' },
    ],
  },
  {
    ref: 'ch-4',
    code: 'COB-3299',
    cliente: 'cl-9',
    viagem: 'tr-7',
    total: 80000,
    dueDate: '2026-08-10',
    pagamentos: [{ amount: 80000, paidAt: '2026-08-06', method: 'boleto' }],
  },
  {
    ref: 'ch-5',
    code: 'COB-3295',
    cliente: 'cl-7',
    viagem: null,
    total: 96000,
    dueDate: '2026-07-25',
    pagamentos: [],
  },
  {
    ref: 'ch-6',
    code: 'COB-3303',
    cliente: 'cl-5',
    viagem: null,
    total: 45000,
    dueDate: '2026-08-28',
    pagamentos: [{ amount: 15000, paidAt: '2026-08-09', method: 'cartao' }],
  },
] as const;

const BLOQUEIOS = [
  {
    aeronave: 'ac-3',
    kind: 'manutencao',
    reason: 'Revisão de 100h',
    startAt: '2026-08-10T00:00:00',
    endAt: '2026-08-14T23:59:00',
  },
  {
    aeronave: 'ac-1',
    kind: 'bloqueio',
    reason: 'Reposicionamento de base',
    startAt: '2026-08-19T06:00:00',
    endAt: '2026-08-19T09:00:00',
  },
] as const;

// ============================================================================

/**
 * As datas do protótipo eram strings locais sem fuso (`2026-08-11T08:00:00`).
 * `new Date()` as interpreta no fuso de quem roda o script, o que faria os
 * horários mudarem conforme a máquina. O sufixo `Z` fixa em UTC: o voo das 08:00
 * é o mesmo voo em qualquer lugar que o script rode.
 */
const dataHora = (s: string): Date => new Date(`${s}Z`);
const data = (s: string): Date => new Date(`${s}T00:00:00Z`);

/**
 * Traduz a referência do protótipo (`cl-3`, `ac-2`) para o id gerado no banco.
 *
 * Explode com o nome da referência se ela não existir. Um `!` do TypeScript
 * silenciaria o problema aqui e ele reapareceria lá na frente como violação de
 * chave estrangeira do MySQL, sem dizer qual dos oitenta e tantos registros
 * apontava para o vazio.
 */
function idDe(mapa: ReadonlyMap<string, string>, referencia: string): string {
  const id = mapa.get(referencia);
  if (id === undefined) {
    throw new Error(`referência desconhecida nos dados do protótipo: ${referencia}`);
  }
  return id;
}

/** Número final de um código do protótipo: `VOO-2046` → 2046. */
function numeroDoCodigo(codigo: string): number {
  const parte = codigo.split('-')[1];
  if (parte === undefined) throw new Error(`código sem numeração: ${codigo}`);
  return Number(parte);
}

/**
 * O job `refreshOverdueCharges` recebe o logger do Fastify, que aqui não existe
 * — este script roda fora do servidor. Ele só registra progresso, então um
 * logger que descarta tudo basta, e a saída do script continua legível.
 */
const descarta = (): void => undefined;
const logSilencioso = {
  info: descarta,
  debug: descarta,
  warn: descarta,
  error: descarta,
  fatal: descarta,
  trace: descarta,
  silent: descarta,
  level: 'silent',
  child: (): FastifyBaseLogger => logSilencioso,
} as unknown as FastifyBaseLogger;

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'] ?? '';
  const banco = /\/([^/?]+)(\?|$)/.exec(url)?.[1] ?? '(desconhecido)';

  console.log('');
  console.log('  Recarregar os dados do protótipo');
  console.log(`  banco de destino: ${banco}`);
  console.log('');

  const jaExiste = await prisma.client.count();
  if (jaExiste > 0) {
    console.log(`  O banco já tem ${jaExiste} cliente(s). Este script não sobrescreve nada.`);
    console.log('  Para recomeçar do zero:');
    console.log('    node scripts/purge-operational-data.mjs --confirm');
    console.log('');
    return;
  }

  console.log('  Vai inserir:');
  console.log(`    ${AERONAVES.length} aeronaves`);
  console.log(`    ${CLIENTES.length} clientes`);
  console.log(`    ${TARIFAS.length} tarifas`);
  console.log(`    ${VIAGENS.length} viagens`);
  console.log(
    `    ${SOLICITACOES.length} solicitações (${SOLICITACOES.reduce((n, r) => n + r.pax.length, 0)} passageiros)`,
  );
  console.log(
    `    ${COBRANCAS.length} cobranças (${COBRANCAS.reduce((n, c) => n + c.pagamentos.length, 0)} pagamentos)`,
  );
  console.log(`    ${BLOQUEIOS.length} bloqueios de agenda`);
  console.log('');

  if (!confirmar) {
    console.log('  SIMULAÇÃO — nada foi gravado.');
    console.log('  Para gravar de verdade:  npm run seed:demo -- --confirm');
    console.log('');
    return;
  }

  // Cada bloco depende do anterior (chaves estrangeiras), então a ordem aqui
  // não é estética: aeronave antes de tarifa, cliente antes de viagem, viagem
  // antes de cobrança.

  const idAeronave = new Map<string, string>();
  for (const a of AERONAVES) {
    const row = await prisma.aircraft.create({
      data: {
        prefix: a.prefix,
        kind: a.kind,
        model: a.model,
        manufacturer: a.manufacturer,
        capacity: a.capacity,
        cruiseSpeed: a.cruiseSpeed,
        status: a.status,
      },
      select: { id: true },
    });
    idAeronave.set(a.ref, row.id);
  }
  console.log(`  aeronaves: ${idAeronave.size}`);

  const idCliente = new Map<string, string>();
  for (const c of CLIENTES) {
    const row = await prisma.client.create({
      data: {
        name: c.name,
        company: c.company,
        document: c.document,
        email: c.email,
        phone: c.phone,
      },
      select: { id: true },
    });
    idCliente.set(c.ref, row.id);
  }
  console.log(`  clientes: ${idCliente.size}`);

  const idTarifa = new Map<string, string>();
  const tarifaDaAeronave = new Map<string, string>();
  for (const t of TARIFAS) {
    const aeronaveId = idDe(idAeronave, t.aeronave);
    const row = await prisma.tariff.create({
      data: {
        aircraftId: aeronaveId,
        value: t.value,
        costFuel: t.costFuel,
        costFlightHour: t.costFlightHour,
        costFees: t.costFees,
        costPilot: t.costPilot,
        unit: t.unit,
        startDate: data(t.startDate),
        endDate: t.endDate === null ? null : data(t.endDate),
        active: t.active,
      },
      select: { id: true },
    });
    idTarifa.set(t.ref, row.id);
    tarifaDaAeronave.set(t.aeronave, row.id);
  }
  console.log(`  tarifas: ${idTarifa.size}`);

  const idViagem = new Map<string, string>();
  for (const v of VIAGENS) {
    const row = await prisma.trip.create({
      data: {
        code: v.code,
        clientId: idDe(idCliente, v.cliente),
        aircraftId: idDe(idAeronave, v.aeronave),
        // Liga a viagem à tarifa vigente da aeronave. O protótipo guardava só o
        // valor (`internalTariff`); a referência permite rastrear DE ONDE veio.
        tariffId: tarifaDaAeronave.get(v.aeronave) ?? null,
        origin: v.origin,
        destination: v.destination,
        departureAt: dataHora(v.departureAt),
        returnAt: dataHora(v.returnAt),
        distanceKm: v.distanceKm,
        passengers: v.passengers,
        notes: v.notes,
        status: v.status,
        internalTariff: v.internalTariff,
        estimatedValue: v.estimatedValue,
        commercialValue: v.commercialValue,
        // `flightHours` fica nulo de propósito. O protótipo não registrava, e
        // calcular pela fórmula produziria um número que NÃO explica o
        // `estimatedValue` gravado ao lado — a divergência descrita em
        // docs/STATUS.md §4. Nulo é honesto; um número inventado, não.
      },
      select: { id: true },
    });
    idViagem.set(v.ref, row.id);
  }
  console.log(`  viagens: ${idViagem.size}`);

  let passageiros = 0;
  for (const s of SOLICITACOES) {
    const row = await prisma.flightRequest.create({
      data: {
        code: s.code,
        clientId: idDe(idCliente, s.cliente),
        origin: s.origin,
        destination: s.destination,
        departureAt: dataHora(s.departureAt),
        returnAt: dataHora(s.returnAt),
        passengers: s.passengers,
        notes: s.notes,
        status: s.status,
        tripId: s.viagem === null ? null : (idViagem.get(s.viagem) ?? null),
      },
      select: { id: true },
    });

    // Os documentos anexados eram um SVG embutido de exemplo — não são trazidos:
    // documento de passageiro é dado sensível (LGPD) e um placeholder no lugar
    // sugeriria que existe algo verificado ali.
    for (const [posicao, nome] of s.pax.entries()) {
      await prisma.passenger.create({
        data: { name: nome, requestId: row.id, position: posicao },
      });
      passageiros++;
    }
  }
  console.log(`  solicitações: ${SOLICITACOES.length} (${passageiros} passageiros)`);

  let pagamentos = 0;
  const idCobranca: string[] = [];
  for (const c of COBRANCAS) {
    const row = await prisma.charge.create({
      data: {
        code: c.code,
        clientId: idDe(idCliente, c.cliente),
        tripId: c.viagem === null ? null : (idViagem.get(c.viagem) ?? null),
        total: c.total,
        dueDate: data(c.dueDate),
      },
      select: { id: true },
    });
    idCobranca.push(row.id);

    for (const p of c.pagamentos) {
      await prisma.payment.create({
        data: {
          chargeId: row.id,
          amount: p.amount,
          paidAt: data(p.paidAt),
          method: p.method,
        },
      });
      pagamentos++;
    }
  }
  console.log(`  cobranças: ${COBRANCAS.length} (${pagamentos} pagamentos)`);

  for (const b of BLOQUEIOS) {
    await prisma.aircraftBlock.create({
      data: {
        aircraftId: idDe(idAeronave, b.aeronave),
        kind: b.kind,
        reason: b.reason,
        startAt: dataHora(b.startAt),
        endAt: dataHora(b.endAt),
      },
    });
  }
  console.log(`  bloqueios: ${BLOQUEIOS.length}`);

  // --------------------------------------------------------------------------
  // Agregados: pelas funções da própria API, não por conta deste script.
  // --------------------------------------------------------------------------

  const agora = new Date();

  for (const chargeId of idCobranca) {
    await recalculateCharge(prisma, chargeId);
  }
  for (const clientId of idCliente.values()) {
    await refreshClientAggregates(prisma, clientId, agora);
  }

  /**
   * `Charge.status` guarda o status que depende só dos valores — `pago`,
   * `parcial`, `pendente`. Virar `vencido` depende do relógio, não de nenhuma
   * mutação, então quem faz isso é o job `refreshOverdueCharges` (docs/PLANO.md
   * §7.2).
   *
   * Chamando o job aqui, o banco já nasce no estado que a aplicação manteria.
   * Sem isto, três cobranças do protótipo (COB-3295, COB-3301 e COB-3302 quando
   * vencer) apareceriam como `pendente`/`parcial` na tela até o job rodar,
   * enquanto o agregado do cliente ao lado já diria `vencido` — duas verdades
   * diferentes na mesma tela.
   */
  const vencidas = await refreshOverdueCharges(logSilencioso);

  console.log(`  agregados recalculados pela própria API (${vencidas} cobrança(s) vencida(s))`);

  // --------------------------------------------------------------------------
  // Sequências de código.
  //
  // Sem isto, a próxima viagem criada pela tela nasceria VOO-1001 e conviveria
  // com a VOO-2046 já gravada — numeração andando para trás. Cada sequência
  // avança para depois do maior código semeado.
  // --------------------------------------------------------------------------

  const maiorCodigo = (codigos: readonly string[]): number =>
    Math.max(...codigos.map(numeroDoCodigo));

  await prisma.codeSequence.update({
    where: { key: 'trip' },
    data: { current: maiorCodigo(VIAGENS.map((v) => v.code)) },
  });
  await prisma.codeSequence.update({
    where: { key: 'request' },
    data: { current: maiorCodigo(SOLICITACOES.map((s) => s.code)) },
  });
  await prisma.codeSequence.update({
    where: { key: 'charge' },
    data: { current: maiorCodigo(COBRANCAS.map((c) => c.code)) },
  });
  console.log('  sequências de código avançadas (VOO/SOL/COB)');

  // --------------------------------------------------------------------------
  // Acesso ao portal do cliente (opcional).
  // --------------------------------------------------------------------------

  if (comPortal) {
    const senha = process.env['DEMO_PORTAL_PASSWORD'];
    if (!senha || senha.length < 10) {
      console.log('');
      console.log('  --com-portal ignorado: defina DEMO_PORTAL_PASSWORD (10+ caracteres).');
      console.log('  Sem senha no ambiente, este script não inventa uma — senha previsível');
      console.log('  em código é como toda instalação acaba com a mesma porta aberta.');
    } else {
      const { hash } = await import('bcryptjs');
      const papel = await prisma.role.findUniqueOrThrow({ where: { key: 'cliente' } });

      // `cl-3` era o cliente que o protótipo usava na visão do portal
      // (`CURRENT_CLIENT_ID`), então é ele que reproduz aquelas telas.
      const cliente = CLIENTES.find((c) => c.ref === 'cl-3');
      if (!cliente) throw new Error('cl-3 não está na lista de clientes do protótipo.');

      await prisma.user.create({
        data: {
          email: cliente.email,
          name: cliente.name,
          passwordHash: await hash(senha, 12),
          roleId: papel.id,
          clientId: idDe(idCliente, 'cl-3'),
          mustChangePassword: true,
        },
      });
      console.log('');
      console.log(`  acesso ao portal criado para ${cliente.email}`);
      console.log('  (troca de senha obrigatória no primeiro acesso)');
    }
  }

  console.log('');
  console.log('  Pronto. Os dados do protótipo estão no banco.');
  console.log('');
  console.log('  Lembrete: isto é dado de DEMONSTRAÇÃO. Antes de operar de verdade:');
  console.log('    node scripts/purge-operational-data.mjs --confirm');
  console.log('');
}

main()
  .catch((erro: unknown) => {
    console.error('');
    console.error('  Falhou:', erro instanceof Error ? erro.message : erro);
    console.error('');
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
