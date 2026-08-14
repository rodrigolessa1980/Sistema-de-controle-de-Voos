/**
 * Operações — cobertura de todas as rotas de negócio.
 *
 * Um único arquivo porque a montagem (migrations, papéis, permissões, quatro
 * usuários com bcrypt) custa caro contra um MySQL remoto e é compartilhada.
 *
 * Cada bloco corresponde a um módulo da API.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  auth,
  createUser,
  futureWindow,
  makeAircraft,
  makeClient,
  makeTariff,
  migrateTestDatabase,
  prisma,
  resetAll,
  resetData,
  seedStructure,
  TODAY_ISO,
  type TestUser,
} from './setup';

let app: FastifyInstance;
let op: TestUser;
let fin: TestUser;
let cli: TestUser;
let clientId: string;

beforeAll(async () => {
  migrateTestDatabase();
  const { buildApp } = await import('../src/app');
  app = await buildApp();
  await app.ready();
  await seedStructure();

  await resetAll();
  const client = await makeClient({ name: 'Cliente Fixture' });
  clientId = client.id;

  op = await createUser(app, 'operacional');
  fin = await createUser(app, 'financeiro');
  cli = await createUser(app, 'cliente', { clientId });
}, 180_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetData([clientId]);
});

/**
 * Atalhos de requisição.
 *
 * O `payload` entra sempre — `{}` quando não há corpo — em vez de um spread
 * condicional. O spread produzia uma união de tipos que nenhuma sobrecarga do
 * `inject` aceitava, e um corpo vazio é inofensivo num GET ou DELETE.
 */
const get = (user: TestUser, url: string) =>
  app.inject({ method: 'GET', url, headers: auth(user) });

const post = (user: TestUser, url: string, payload: object = {}) =>
  app.inject({ method: 'POST', url, headers: auth(user), payload });

const patch = (user: TestUser, url: string, payload: object) =>
  app.inject({ method: 'PATCH', url, headers: auth(user), payload });

const del = (user: TestUser, url: string) =>
  app.inject({ method: 'DELETE', url, headers: auth(user) });

// ============================================================================
//  AUTENTICAÇÃO
// ============================================================================

describe('autenticação', () => {
  it('devolve o perfil e as permissões em /me', async () => {
    const response = await get(op, '/api/auth/me');
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.role).toBe('operacional');
    expect(body.permissions).toContain('trip:create');
    expect(body.permissions).not.toContain('payment:settle');
  });

  it('recusa e-mail inexistente e senha errada com a MESMA mensagem', async () => {
    const inexistente = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nao-existe@teste.local', password: 'QualquerCoisa1' },
    });
    const senhaErrada = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: op.email, password: 'SenhaErrada123' },
    });

    expect(inexistente.statusCode).toBe(401);
    expect(senhaErrada.statusCode).toBe(401);
    // Mensagens iguais: enumerar usuários válidos é informação que não se dá.
    expect(inexistente.json()).toEqual(senhaErrada.json());
  });

  it('o login entrega cookie httpOnly de refresh', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: op.email, password: 'SenhaDeTeste123' },
    });

    const cookie = response.headers['set-cookie'];
    const raw = Array.isArray(cookie) ? cookie.join(';') : String(cookie);
    expect(raw).toContain('acm_refresh=');
    expect(raw).toContain('HttpOnly');
  });

  /**
   * A flag `Secure` segue o PROTOCOLO de `WEB_BASE_URL`, não o `NODE_ENV`.
   *
   * Este teste existe por causa de uma queda em produção: com `secure` amarrado
   * em `isProduction`, o servidor mandava `Set-Cookie: ...; Secure` por HTTP, o
   * navegador descartava o cookie sem avisar ninguém, e `POST /auth/refresh`
   * respondia 401 para sempre — a sessão morria na primeira recarga e a tela
   * ficava em "Restaurando sessão…" antes de voltar para o login.
   *
   * Nada disso aparecia no log do servidor: do lado dele, o login foi 200 e o
   * cookie foi enviado. Só o navegador sabia. Por isso a asserção é no header, e
   * não numa constante de configuração — é o header que o navegador julga.
   *
   * O ambiente de teste roda com o `WEB_BASE_URL` padrão (`http://localhost:1700`),
   * que é o mesmo caso da produção de hoje.
   */
  it('o cookie de refresh não vem Secure quando o site é HTTP', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: op.email, password: 'SenhaDeTeste123' },
    });

    const cookie = response.headers['set-cookie'];
    const raw = Array.isArray(cookie) ? cookie.join(';') : String(cookie);

    expect(process.env['WEB_BASE_URL'] ?? 'http://localhost:1700').toMatch(/^http:\/\//);
    expect(raw).toContain('acm_refresh=');
    expect(raw).not.toContain('Secure');
  });

  it('o refresh é rotativo: o token usado é revogado', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: op.email, password: 'SenhaDeTeste123' },
    });

    const cookies = login.cookies.find((c) => c.name === 'acm_refresh');
    expect(cookies).toBeDefined();

    const primeiro = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { acm_refresh: cookies?.value ?? '' },
    });
    expect(primeiro.statusCode).toBe(200);

    // Reapresentar o token já usado derruba a sessão.
    const reuso = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { acm_refresh: cookies?.value ?? '' },
    });
    expect(reuso.statusCode).toBe(401);
  });

  /**
   * A troca segue a MESMA regra do cadastro, que hoje não exige tamanho nem
   * composição (`passwordSchema` em @acm/shared).
   *
   * O caso continua aqui, invertido, em vez de ter sido apagado: as duas rotas
   * compartilham o schema justamente para não divergirem, e uma delas voltar a
   * apertar sozinha é o defeito que este teste pega. Quem se cadastra com uma
   * senha que a troca depois recusa só descobre isso na hora de trocar.
   */
  it('aceita senha curta na troca, igual ao cadastro', async () => {
    const response = await post(op, '/api/auth/change-password', {
      currentPassword: 'SenhaDeTeste123',
      newPassword: 'x',
    });
    expect(response.statusCode).toBe(200);

    // A senha nova vale de verdade: entrar com ela é o que prova.
    const entrada = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: op.email, password: 'x' },
    });
    expect(entrada.statusCode).toBe(200);

    /**
     * Devolve a senha ao valor de origem antes de sair.
     *
     * `op` é criado UMA vez no `beforeAll` e compartilhado por todo o arquivo —
     * `resetData` limpa dados operacionais, não usuários. Deixar a senha trocada
     * faria os casos seguintes falharem por um motivo que nada tem a ver com o
     * que eles testam, e a suíte acusaria o defeito errado.
     */
    const restaura = await post(op, '/api/auth/change-password', {
      currentPassword: 'x',
      newPassword: 'SenhaDeTeste123',
    });
    expect(restaura.statusCode).toBe(200);
  });

  it('rejeita senha nova vazia na troca', async () => {
    const response = await post(op, '/api/auth/change-password', {
      currentPassword: 'SenhaDeTeste123',
      newPassword: '',
    });
    expect(response.statusCode).toBe(422);
  });

  it('rejeita a troca quando a senha atual está errada', async () => {
    const response = await post(op, '/api/auth/change-password', {
      currentPassword: 'ErradaDemais1',
      newPassword: 'NovaSenhaForte123',
    });
    expect(response.statusCode).toBe(400);
  });
});

// ============================================================================
//  AERONAVES
// ============================================================================

describe('aeronaves', () => {
  const nova = {
    prefix: 'pt-abc',
    kind: 'aviao',
    model: 'Phenom 300E',
    manufacturer: 'Embraer',
    capacity: 9,
    cruiseSpeed: 860,
    status: 'disponivel',
  };

  it('cria, lê, atualiza e remove', async () => {
    const criada = await post(op, '/api/aircraft', nova);
    expect(criada.statusCode).toBe(201);

    const body = criada.json();
    // O contrato normaliza para maiúsculas.
    expect(body.prefix).toBe('PT-ABC');

    const lida = await get(op, `/api/aircraft/${body.id}`);
    expect(lida.statusCode).toBe(200);

    const alterada = await patch(op, `/api/aircraft/${body.id}`, { status: 'manutencao' });
    expect(alterada.json<{ status: string }>().status).toBe('manutencao');

    const removida = await del(op, `/api/aircraft/${body.id}`);
    expect(removida.statusCode).toBe(200);

    // Remoção é LÓGICA: a linha continua no banco, some das listas.
    const depois = await get(op, `/api/aircraft/${body.id}`);
    expect(depois.statusCode).toBe(404);

    const ainda = await prisma.aircraft.findUnique({ where: { id: body.id } });
    expect(ainda?.deletedAt).not.toBeNull();
  });

  it('recusa prefixo duplicado', async () => {
    await post(op, '/api/aircraft', nova);
    const duplicada = await post(op, '/api/aircraft', nova);
    expect(duplicada.statusCode).toBe(409);
  });

  it('recusa campos obrigatórios faltando', async () => {
    const response = await post(op, '/api/aircraft', { prefix: 'PT-XYZ' });
    expect(response.statusCode).toBe(422);
  });

  it('não remove aeronave com voo futuro agendado', async () => {
    const aircraft = await makeAircraft();
    const { departureAt, returnAt } = futureWindow();

    await prisma.trip.create({
      data: {
        code: 'VOO-8001',
        clientId,
        aircraftId: aircraft.id,
        origin: 'A',
        destination: 'B',
        departureAt: new Date(departureAt),
        returnAt: new Date(returnAt),
        passengers: 1,
        status: 'confirmada',
      },
    });

    const response = await del(op, `/api/aircraft/${aircraft.id}`);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'CONFLICT' } });
  });

  it('filtra por busca', async () => {
    await makeAircraft({ prefix: 'PT-AAA' });
    await makeAircraft({ prefix: 'PT-BBB' });

    const response = await get(op, '/api/aircraft?q=AAA');
    const body = response.json<{ items: { prefix: string }[] }>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.prefix).toBe('PT-AAA');
  });
});

// ============================================================================
//  TARIFAS
// ============================================================================

describe('tarifas', () => {
  it('calcula o total no SERVIDOR, ignorando o que o cliente mandar', async () => {
    const aircraft = await makeAircraft();

    const response = await post(op, '/api/tariffs', {
      aircraftId: aircraft.id,
      costFuel: '3500',
      costFlightHour: '3000',
      costFees: '1000',
      costPilot: '1000',
      startDate: '2026-01-01',
      // `value` nem é aceito pelo contrato — o total é sempre derivado.
      value: '999999',
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<{ value: string }>().value).toBe('8500.00');
  });

  it('recusa tarifa com todos os custos zerados', async () => {
    const aircraft = await makeAircraft();
    const response = await post(op, '/api/tariffs', {
      aircraftId: aircraft.id,
      startDate: '2026-01-01',
    });
    expect(response.statusCode).toBe(422);
  });

  it('recusa data final antes da inicial', async () => {
    const aircraft = await makeAircraft();
    const response = await post(op, '/api/tariffs', {
      aircraftId: aircraft.id,
      costFlightHour: '1000',
      startDate: '2026-06-01',
      endDate: '2026-01-01',
    });
    expect(response.statusCode).toBe(422);
  });

  it('recalcula o total ao editar um custo', async () => {
    const aircraft = await makeAircraft();
    const tariff = await makeTariff(aircraft.id, 10_000);

    const response = await patch(op, `/api/tariffs/${tariff.id}`, { costFuel: '5000' });
    // 5000 (novo) + 2500 + 2500 + 2500 dos que ficaram = 12.500
    expect(response.json<{ value: string }>().value).toBe('12500.00');
  });
});

// ============================================================================
//  CLIENTES
// ============================================================================

describe('clientes', () => {
  it('cria e devolve os agregados zerados', async () => {
    const response = await post(op, '/api/clients', {
      name: 'Empresa Nova',
      email: 'contato@empresanova.test',
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.openBalance).toBe('0.00');
    expect(body.financialStatus).toBe('em_dia');
    expect(body.tripCount).toBe(0);
  });

  it('recusa e-mail duplicado', async () => {
    // Os nomes têm de passar no `min(2)` do schema: com 'A' e 'B' os dois
    // cadastros morriam em 422 antes de chegar ao banco, e o teste dizia
    // "não deu 409" por um motivo que nada tinha a ver com duplicidade.
    const primeiro = await post(op, '/api/clients', {
      name: 'Empresa Um',
      email: 'igual@teste.local',
    });
    expect(primeiro.statusCode).toBe(201);

    const segundo = await post(op, '/api/clients', {
      name: 'Empresa Dois',
      email: 'igual@teste.local',
    });
    expect(segundo.statusCode).toBe(409);
  });

  it('recusa e-mail inválido', async () => {
    const response = await post(op, '/api/clients', { name: 'Nome', email: 'nao-e-email' });
    expect(response.statusCode).toBe(422);
  });

  it('o cliente edita o próprio cadastro e recebe o DTO reduzido', async () => {
    const response = await patch(cli, '/api/clients/me', { phone: '(11) 90000-0000' });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.phone).toBe('(11) 90000-0000');
    // Agregados internos não vão para o cliente.
    expect(body).not.toHaveProperty('totalInvoiced');
    expect(body).not.toHaveProperty('overdueBalance');
  });

  it('cria o login do portal com senha provisória e enfileira o e-mail', async () => {
    const response = await post(op, '/api/clients', {
      name: 'Com Portal',
      email: 'portal@teste.local',
      createPortalUser: true,
    });
    expect(response.statusCode).toBe(201);

    const user = await prisma.user.findUnique({ where: { email: 'portal@teste.local' } });
    expect(user?.mustChangePassword).toBe(true);

    const email = await prisma.emailOutbox.findFirst({
      where: { template: 'senha-provisoria' },
    });
    expect(email).not.toBeNull();
    expect(email?.recipients).toContain('portal@teste.local');
  });
});

// ============================================================================
//  VIAGENS
// ============================================================================

describe('viagens', () => {
  async function cenario() {
    const aircraft = await makeAircraft({ cruiseSpeed: 800 });
    await makeTariff(aircraft.id, 10_000);
    return aircraft;
  }

  const corpo = (aircraftId: string, extra: Record<string, unknown> = {}) => ({
    clientId,
    aircraftId,
    origin: 'São Paulo (CGH)',
    destination: 'Rio de Janeiro (SDU)',
    ...futureWindow(),
    distanceKm: 400,
    pax: [{ name: 'Passageiro Um' }],
    ...extra,
  });

  it('agenda com código sequencial e precificação congelada', async () => {
    const aircraft = await cenario();
    const response = await post(op, '/api/trips', corpo(aircraft.id));

    expect(response.statusCode).toBe(201);
    const trip = response.json();

    expect(trip.code).toBe('VOO-1001');
    expect(trip.status).toBe('confirmada'); // nasce confirmada, sem aceite
    expect(trip.internalTariff).toBe('10000.00');
    expect(trip.flightHours).toBe(1); // 2 × 400 ÷ 800
    expect(trip.estimatedValue).toBe('10000.00');
  });

  it('emite códigos em sequência, sem repetir', async () => {
    const aircraft = await cenario();
    const outro = await makeAircraft({ prefix: 'PT-SEQ' });

    const primeira = await post(op, '/api/trips', corpo(aircraft.id));
    const segunda = await post(op, '/api/trips', corpo(outro.id, futureWindow(60)));

    expect(primeira.json<{ code: string }>().code).toBe('VOO-1001');
    expect(segunda.json<{ code: string }>().code).toBe('VOO-1002');
  });

  it('recusa sobreposição na mesma aeronave', async () => {
    const aircraft = await cenario();
    await post(op, '/api/trips', corpo(aircraft.id));

    const conflitante = await post(op, '/api/trips', corpo(aircraft.id));
    expect(conflitante.statusCode).toBe(409);
    expect(conflitante.json()).toMatchObject({
      error: { details: { reason: 'trip' } },
    });
  });

  it('recusa por margem mínima entre voos', async () => {
    const aircraft = await cenario();
    const primeira = futureWindow(35, 4);
    await post(op, '/api/trips', corpo(aircraft.id, primeira));

    // Começa 20 minutos depois do fim — a margem configurada é 45.
    const inicio = new Date(new Date(primeira.returnAt).getTime() + 20 * 60_000);
    const segunda = {
      departureAt: inicio.toISOString(),
      returnAt: new Date(inicio.getTime() + 3_600_000).toISOString(),
    };

    const response = await post(op, '/api/trips', corpo(aircraft.id, segunda));
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { details: { reason: 'margin' } } });
  });

  it('recusa conflito com bloqueio de manutenção', async () => {
    const aircraft = await cenario();
    const janela = futureWindow(40);

    await prisma.aircraftBlock.create({
      data: {
        aircraftId: aircraft.id,
        kind: 'manutencao',
        reason: 'Revisão de 100h',
        startAt: new Date(new Date(janela.departureAt).getTime() - 86_400_000),
        endAt: new Date(new Date(janela.returnAt).getTime() + 86_400_000),
      },
    });

    const response = await post(op, '/api/trips', corpo(aircraft.id, janela));
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { details: { reason: 'block' } } });
  });

  it('recusa data no passado', async () => {
    const aircraft = await cenario();
    const ontem = new Date(Date.now() - 2 * 86_400_000);

    const response = await post(
      op,
      '/api/trips',
      corpo(aircraft.id, {
        departureAt: ontem.toISOString(),
        returnAt: new Date(ontem.getTime() + 3_600_000).toISOString(),
      }),
    );
    expect(response.statusCode).toBe(422);
  });

  it('recusa volta antes da ida', async () => {
    const aircraft = await cenario();
    const janela = futureWindow();

    const response = await post(
      op,
      '/api/trips',
      corpo(aircraft.id, { departureAt: janela.returnAt, returnAt: janela.departureAt }),
    );
    expect(response.statusCode).toBe(422);
  });

  it('exige confirmação quando o cliente tem pendência, e registra a decisão', async () => {
    const aircraft = await cenario();

    await prisma.charge.create({
      data: {
        code: 'COB-9001',
        clientId,
        total: 5000,
        paidAmount: 0,
        balance: 5000,
        dueDate: new Date('2020-01-01T00:00:00.000Z'),
        status: 'vencido',
      },
    });
    await prisma.client.update({
      where: { id: clientId },
      data: { openBalance: 5000, financialStatus: 'vencido' },
    });

    const semConfirmar = await post(op, '/api/trips', corpo(aircraft.id));
    expect(semConfirmar.statusCode).toBe(422);
    expect(semConfirmar.json()).toMatchObject({
      error: { details: { code: 'CLIENT_HAS_DEBT' } },
    });

    const confirmando = await post(op, '/api/trips', corpo(aircraft.id, { acknowledgeDebt: true }));
    expect(confirmando.statusCode).toBe(201);
    expect(confirmando.json<{ scheduledWithDebt: boolean }>().scheduledWithDebt).toBe(true);
  });

  it('check-availability responde livre e ocupado', async () => {
    const aircraft = await cenario();
    const janela = futureWindow(50);

    const livre = await post(op, '/api/trips/check-availability', {
      aircraftId: aircraft.id,
      ...janela,
    });
    expect(livre.json<{ available: boolean }>().available).toBe(true);

    await post(op, '/api/trips', corpo(aircraft.id, janela));

    const ocupado = await post(op, '/api/trips/check-availability', {
      aircraftId: aircraft.id,
      ...janela,
    });
    expect(ocupado.json<{ available: boolean }>().available).toBe(false);
  });

  it('cancela e conclui', async () => {
    const aircraft = await cenario();
    const criada = await post(op, '/api/trips', corpo(aircraft.id));
    const id = criada.json<{ id: string }>().id;

    const concluida = await post(op, `/api/trips/${id}/complete`);
    expect(concluida.json<{ status: string }>().status).toBe('concluida');

    // Concluída não cancela mais.
    const cancelar = await post(op, `/api/trips/${id}/cancel`, { reason: 'teste' });
    expect(cancelar.statusCode).toBe(409);
  });

  it('não edita viagem concluída', async () => {
    const aircraft = await cenario();
    const criada = await post(op, '/api/trips', corpo(aircraft.id));
    const id = criada.json<{ id: string }>().id;

    await post(op, `/api/trips/${id}/complete`);
    const response = await patch(op, `/api/trips/${id}`, { origin: 'Outro' });
    expect(response.statusCode).toBe(409);
  });

  it('grava os passageiros em um único insert', async () => {
    const aircraft = await cenario();
    const response = await post(
      op,
      '/api/trips',
      corpo(aircraft.id, {
        pax: [{ name: 'Primeiro Passageiro' }, { name: 'Segundo Passageiro' }],
      }),
    );

    const trip = response.json();
    expect(trip.passengers).toBe(2);
    expect(trip.pax).toHaveLength(2);
  });

  it('a prévia de tarifa devolve o cálculo sem criar nada', async () => {
    const aircraft = await cenario();
    const response = await get(
      op,
      `/api/trips/pricing-preview?aircraftId=${aircraft.id}&distanceKm=400`,
    );

    const body = response.json();
    expect(body.hours).toBe(1);
    expect(body.estimatedValue).toBe('10000.00');
    expect(await prisma.trip.count()).toBe(0);
  });
});

// ============================================================================
//  SOLICITAÇÕES
// ============================================================================

describe('solicitações de voo', () => {
  const corpo = (extra: Record<string, unknown> = {}) => ({
    origin: 'Belo Horizonte (PLU)',
    destination: 'Vitória (VIX)',
    ...futureWindow(),
    pax: [{ name: 'Passageiro Um', documentFileId: null }],
    ...extra,
  });

  async function comDocumento() {
    const doc = await prisma.documentFile.create({
      data: {
        storageKey: `teste/${Math.random().toString(36).slice(2)}.png`,
        originalName: 'doc.png',
        mimeType: 'image/png',
        sizeBytes: 100,
      },
    });
    return doc.id;
  }

  it('exige documento de TODO passageiro', async () => {
    const response = await post(cli, '/api/requests', corpo());
    expect(response.statusCode).toBe(422);
    expect(response.body).toContain('documento');
  });

  it('cria com documento e dispara e-mail + notificação na mesma transação', async () => {
    const documentFileId = await comDocumento();
    const response = await post(
      cli,
      '/api/requests',
      corpo({ pax: [{ name: 'Passageiro Um', documentFileId }] }),
    );

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.code).toBe('SOL-1001');
    expect(body.status).toBe('aguardando_analise');

    // Canal 1: e-mail enfileirado, com destinatário resolvido por permissão.
    const email = await prisma.emailOutbox.findFirst({
      where: { dedupeKey: `request.created:${body.id}` },
    });
    expect(email).not.toBeNull();
    expect(email?.recipients).toContain(op.email);

    // Canal 2: aviso no sino de quem aprova.
    const notificacao = await prisma.notification.findFirst({
      where: { userId: op.id, type: 'solicitacao_nova' },
    });
    expect(notificacao).not.toBeNull();
  });

  it('o e-mail NÃO carrega documento de passageiro', async () => {
    const documentFileId = await comDocumento();
    await post(cli, '/api/requests', corpo({ pax: [{ name: 'Fulano Silva', documentFileId }] }));

    const email = await prisma.emailOutbox.findFirstOrThrow({
      where: { template: 'solicitacao-nova' },
    });
    const payload = JSON.stringify(email.payload);

    expect(payload).not.toContain(documentFileId);
    expect(payload).not.toContain('storageKey');
  });

  it('marca em análise, e depois não deixa marcar de novo', async () => {
    const documentFileId = await comDocumento();
    const criada = await post(
      cli,
      '/api/requests',
      corpo({ pax: [{ name: 'Passageiro Um', documentFileId }] }),
    );
    const id = criada.json<{ id: string }>().id;

    expect((await post(op, `/api/requests/${id}/review`)).statusCode).toBe(200);
    expect((await post(op, `/api/requests/${id}/review`)).statusCode).toBe(409);
  });

  it('recusa com motivo e notifica o cliente', async () => {
    const documentFileId = await comDocumento();
    const criada = await post(
      cli,
      '/api/requests',
      corpo({ pax: [{ name: 'Passageiro Um', documentFileId }] }),
    );
    const id = criada.json<{ id: string }>().id;

    const response = await post(op, `/api/requests/${id}/reject`, {
      reason: 'Sem aeronave disponível na data.',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('recusada');
    expect(body.rejectionReason).toContain('Sem aeronave');

    const aviso = await prisma.notification.findFirst({
      where: { userId: cli.id, type: 'solicitacao_recusada' },
    });
    expect(aviso).not.toBeNull();
  });

  it('converte em viagem e marca a solicitação como convertida', async () => {
    const documentFileId = await comDocumento();
    const aircraft = await makeAircraft();
    await makeTariff(aircraft.id);

    const janela = futureWindow(55);
    const criada = await post(
      cli,
      '/api/requests',
      corpo({ ...janela, pax: [{ name: 'Passageiro Um', documentFileId }] }),
    );
    const requestId = criada.json<{ id: string }>().id;

    const viagem = await post(op, '/api/trips', {
      clientId,
      aircraftId: aircraft.id,
      origin: 'Belo Horizonte (PLU)',
      destination: 'Vitória (VIX)',
      ...janela,
      pax: [{ name: 'Passageiro Um', documentFileId }],
      requestId,
    });

    expect(viagem.statusCode).toBe(201);

    const solicitacao = await prisma.flightRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(solicitacao.status).toBe('convertida');
    expect(solicitacao.tripId).toBe(viagem.json<{ id: string }>().id);
  });
});

// ============================================================================
//  FINANCEIRO
// ============================================================================

describe('cobranças e pagamentos', () => {
  const novaCobranca = (extra: Record<string, unknown> = {}) => ({
    clientId,
    total: '10000.00',
    dueDate: '2027-01-15',
    ...extra,
  });

  it('cria com saldo igual ao total', async () => {
    const response = await post(fin, '/api/charges', novaCobranca());
    expect(response.statusCode).toBe(201);

    const body = response.json();
    expect(body.code).toBe('COB-1001');
    expect(body.balance).toBe('10000.00');
    expect(body.status).toBe('pendente');
  });

  it('recusa valor zero', async () => {
    const response = await post(fin, '/api/charges', novaCobranca({ total: '0' }));
    expect(response.statusCode).toBe(400);
  });

  it('recusa viagem de outro cliente', async () => {
    const outro = await makeClient();
    const aircraft = await makeAircraft();
    const janela = futureWindow();

    const trip = await prisma.trip.create({
      data: {
        code: 'VOO-7001',
        clientId: outro.id,
        aircraftId: aircraft.id,
        origin: 'A',
        destination: 'B',
        departureAt: new Date(janela.departureAt),
        returnAt: new Date(janela.returnAt),
        passengers: 1,
        status: 'confirmada',
      },
    });

    const response = await post(fin, '/api/charges', novaCobranca({ tripId: trip.id }));
    expect(response.statusCode).toBe(400);
  });

  it('pagamento parcial atualiza saldo, status e o agregado do cliente', async () => {
    const criada = await post(fin, '/api/charges', novaCobranca());
    const id = criada.json<{ id: string }>().id;

    const response = await post(fin, `/api/charges/${id}/payments`, {
      amount: '4000.00',
      paidAt: TODAY_ISO(),
      method: 'pix',
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.paidAmount).toBe('4000.00');
    expect(body.balance).toBe('6000.00');
    expect(body.status).toBe('parcial');

    const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
    expect(client.openBalance.toFixed(2)).toBe('6000.00');
    expect(client.financialStatus).toBe('pendente');
  });

  it('recusa pagamento acima do saldo', async () => {
    const criada = await post(fin, '/api/charges', novaCobranca());
    const id = criada.json<{ id: string }>().id;

    const response = await post(fin, `/api/charges/${id}/payments`, {
      amount: '15000.00',
      paidAt: TODAY_ISO(),
      method: 'pix',
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('exceder');
  });

  it('a baixa quita o saldo inteiro em um comando', async () => {
    const criada = await post(fin, '/api/charges', novaCobranca());
    const id = criada.json<{ id: string }>().id;

    await post(fin, `/api/charges/${id}/payments`, {
      amount: '3000.00',
      paidAt: TODAY_ISO(),
      method: 'pix',
    });

    const response = await post(fin, `/api/charges/${id}/settle`, {
      paidAt: TODAY_ISO(),
      method: 'transferencia',
    });

    const body = response.json();
    expect(body.balance).toBe('0.00');
    expect(body.status).toBe('pago');
    expect(body.payments).toHaveLength(2);

    const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
    expect(client.financialStatus).toBe('em_dia');
  });

  it('não dá baixa em cobrança já quitada', async () => {
    const criada = await post(fin, '/api/charges', novaCobranca());
    const id = criada.json<{ id: string }>().id;

    await post(fin, `/api/charges/${id}/settle`, { paidAt: TODAY_ISO(), method: 'pix' });
    const segunda = await post(fin, `/api/charges/${id}/settle`, {
      paidAt: TODAY_ISO(),
      method: 'pix',
    });

    expect(segunda.statusCode).toBe(409);
  });

  it('o estorno recalcula do zero e devolve o saldo', async () => {
    const criada = await post(fin, '/api/charges', novaCobranca());
    const chargeId = criada.json<{ id: string }>().id;

    const pago = await post(fin, `/api/charges/${chargeId}/payments`, {
      amount: '10000.00',
      paidAt: TODAY_ISO(),
      method: 'pix',
    });
    const paymentId = pago.json<{ payments: { id: string }[] }>().payments[0]?.id ?? '';

    const response = await post(fin, `/api/payments/${paymentId}/reverse`, {
      reason: 'Pagamento não compensou.',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.balance).toBe('10000.00');
    expect(body.status).toBe('pendente');
  });

  it('não estorna duas vezes o mesmo pagamento', async () => {
    const criada = await post(fin, '/api/charges', novaCobranca());
    const chargeId = criada.json<{ id: string }>().id;

    const pago = await post(fin, `/api/charges/${chargeId}/payments`, {
      amount: '1000.00',
      paidAt: TODAY_ISO(),
      method: 'pix',
    });
    const paymentId = pago.json<{ payments: { id: string }[] }>().payments[0]?.id ?? '';

    await post(fin, `/api/payments/${paymentId}/reverse`, { reason: 'primeiro' });
    const segunda = await post(fin, `/api/payments/${paymentId}/reverse`, { reason: 'segundo' });

    expect(segunda.statusCode).toBe(409);
  });

  it('o histórico de pagamentos traz cliente e código da cobrança', async () => {
    const criada = await post(fin, '/api/charges', novaCobranca());
    const id = criada.json<{ id: string }>().id;
    await post(fin, `/api/charges/${id}/payments`, {
      amount: '500.00',
      paidAt: TODAY_ISO(),
      method: 'boleto',
    });

    const response = await get(fin, '/api/payments');
    const body = response.json();

    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.clientName).toBe('Cliente Fixture');
    expect(body.items[0]?.chargeCode).toBe('COB-1001');
  });
});

// ============================================================================
//  DISPONIBILIDADE
// ============================================================================

describe('disponibilidade', () => {
  const janela = () => {
    const from = new Date(Date.now() + 20 * 86_400_000);
    const to = new Date(from.getTime() + 10 * 86_400_000);
    return `from=${from.toISOString()}&to=${to.toISOString()}`;
  };

  it('a agenda interna traz cliente e aeronave', async () => {
    const aircraft = await makeAircraft({ prefix: 'PT-AGD' });
    const j = futureWindow(22);

    await prisma.trip.create({
      data: {
        code: 'VOO-6001',
        clientId,
        aircraftId: aircraft.id,
        origin: 'A',
        destination: 'B',
        departureAt: new Date(j.departureAt),
        returnAt: new Date(j.returnAt),
        passengers: 1,
        status: 'confirmada',
      },
    });

    const response = await get(op, `/api/availability/calendar?${janela()}`);
    const body = response.json();

    expect(body.events).toHaveLength(1);
    expect(body.events[0]?.clientName).toBe('Cliente Fixture');
    expect(body.events[0]?.aircraftPrefix).toBe('PT-AGD');
  });

  it('o calendário do cliente é mascarado: só o status do dia', async () => {
    const aircraft = await makeAircraft();
    const j = futureWindow(22);

    await prisma.trip.create({
      data: {
        code: 'VOO-6002',
        clientId,
        aircraftId: aircraft.id,
        origin: 'Confidencial',
        destination: 'Sigiloso',
        departureAt: new Date(j.departureAt),
        returnAt: new Date(j.returnAt),
        passengers: 1,
        status: 'confirmada',
      },
    });

    const response = await get(cli, `/api/availability/days?${janela()}`);
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.days.length).toBeGreaterThan(0);
    expect(Object.keys(body.days[0] ?? {})).toEqual(['date', 'status']);

    // Nenhum detalhe operacional vaza no payload.
    expect(response.body).not.toContain('Confidencial');
    expect(response.body).not.toContain(aircraft.prefix);
  });

  it('recusa janela maior que o teto', async () => {
    const from = new Date();
    const to = new Date(from.getTime() + 200 * 86_400_000);
    const response = await get(
      op,
      `/api/availability/calendar?from=${from.toISOString()}&to=${to.toISOString()}`,
    );
    expect(response.statusCode).toBe(400);
  });

  it('cria e remove bloqueio', async () => {
    const aircraft = await makeAircraft();
    const j = futureWindow(25);

    const criado = await post(op, '/api/availability/blocks', {
      aircraftId: aircraft.id,
      kind: 'manutencao',
      reason: 'Revisão de 100h',
      startAt: j.departureAt,
      endAt: j.returnAt,
    });

    expect(criado.statusCode).toBe(201);
    const id = criado.json<{ id: string }>().id;

    expect((await del(op, `/api/availability/blocks/${id}`)).statusCode).toBe(200);
    expect(await prisma.aircraftBlock.count()).toBe(0);
  });

  it('recusa bloqueio com fim antes do início', async () => {
    const aircraft = await makeAircraft();
    const j = futureWindow(25);

    const response = await post(op, '/api/availability/blocks', {
      aircraftId: aircraft.id,
      kind: 'bloqueio',
      reason: 'Invertido',
      startAt: j.returnAt,
      endAt: j.departureAt,
    });
    expect(response.statusCode).toBe(422);
  });
});

// ============================================================================
//  PAINÉIS E RELATÓRIOS
// ============================================================================

describe('painéis e relatórios', () => {
  it('o painel operacional soma tudo em uma chamada', async () => {
    const aircraft = await makeAircraft();
    const j = futureWindow(30);

    await prisma.trip.create({
      data: {
        code: 'VOO-5001',
        clientId,
        aircraftId: aircraft.id,
        origin: 'A',
        destination: 'B',
        departureAt: new Date(j.departureAt),
        returnAt: new Date(j.returnAt),
        passengers: 1,
        status: 'confirmada',
      },
    });

    const response = await get(op, '/api/dashboard/operacional');
    const body = response.json();

    expect(body.upcomingTrips).toBe(1);
    expect(body.totalAircraft).toBe(1);
    expect(body.nextTrips).toHaveLength(1);
  });

  it('o painel financeiro agrega valores', async () => {
    await post(fin, '/api/charges', { clientId, total: '5000.00', dueDate: '2027-03-01' });

    const response = await get(fin, '/api/dashboard/financeiro');
    const body = response.json<{ totalReceivable: string }>();
    expect(body.totalReceivable).toBe('5000.00');
  });

  it('o painel do cliente traz o próprio saldo', async () => {
    await post(fin, '/api/charges', { clientId, total: '2500.00', dueDate: '2027-03-01' });

    const response = await get(cli, '/api/dashboard/cliente');
    const body = response.json();
    expect(body.openBalance).toBe('2500.00');
    expect(body.clientName).toBe('Cliente Fixture');
  });

  it('o relatório financeiro agrupa por status e por mês', async () => {
    const criada = await post(fin, '/api/charges', {
      clientId,
      total: '8000.00',
      dueDate: '2027-04-01',
    });
    const id = criada.json<{ id: string }>().id;
    await post(fin, `/api/charges/${id}/payments`, {
      amount: '3000.00',
      paidAt: TODAY_ISO(),
      method: 'pix',
    });

    const response = await get(fin, '/api/reports/financial');
    // Conferir o status antes do corpo: sem isto, um 500 aparecia como
    // "expected undefined to be '8000.00'" e escondia a causa real.
    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(body.totalInvoiced).toBe('8000.00');
    expect(body.totalReceived).toBe('3000.00');
    expect(body.byStatus).toContainEqual({ status: 'parcial', count: 1 });
    expect(body.monthlyReceipts.length).toBeGreaterThan(0);
    expect(body.topDebtors[0]?.balance).toBe('5000.00');
  });
});

// ============================================================================
//  CHANGE FEED E NOTIFICAÇÕES
// ============================================================================

describe('change feed', () => {
  it('a primeira chamada devolve só o topo, sem histórico', async () => {
    const response = await get(op, '/api/changes');
    const body = response.json();

    expect(body.reset).toBe(false);
    expect(body.changes).toHaveLength(0);
  });

  it('devolve o delta e nada mais', async () => {
    const inicial = await get(op, '/api/changes');
    const cursor = inicial.json<{ seq: string }>().seq;

    await post(op, '/api/clients', { name: 'Novo Cliente', email: 'novo@teste.local' });

    const delta = await get(op, `/api/changes?since=${cursor}`);
    const body = delta.json();

    expect(body.changes).toContainEqual(
      expect.objectContaining({ entity: 'client', action: 'created' }),
    );
  });

  it('resposta vazia quando nada mudou', async () => {
    const inicial = await get(op, '/api/changes');
    const cursor = inicial.json<{ seq: string }>().seq;

    const response = await get(op, `/api/changes?since=${cursor}`);
    const body = response.json<{ changes: unknown[] }>();

    expect(body.changes).toHaveLength(0);
    // A resposta precisa ser barata: é o que roda a cada 10 segundos.
    expect(response.body.length).toBeLessThan(120);
  });

  it('o cliente NÃO recebe evento de outro cliente', async () => {
    const inicial = await get(cli, '/api/changes');
    const cursor = inicial.json<{ seq: string }>().seq;

    const outro = await makeClient();
    await post(fin, '/api/charges', {
      clientId: outro.id,
      total: '1000.00',
      dueDate: '2027-05-01',
    });

    const response = await get(cli, `/api/changes?since=${cursor}`);
    const body = response.json<{ changes: unknown[] }>();
    expect(body.changes).toHaveLength(0);
  });

  it('o cliente RECEBE evento do próprio', async () => {
    const inicial = await get(cli, '/api/changes');
    const cursor = inicial.json<{ seq: string }>().seq;

    await post(fin, '/api/charges', { clientId, total: '1000.00', dueDate: '2027-05-01' });

    const response = await get(cli, `/api/changes?since=${cursor}`);
    const body = response.json<{ changes: { entity: string }[] }>();
    expect(body.changes.some((c) => c.entity === 'charge')).toBe(true);
  });
});

describe('notificações', () => {
  it('lista as próprias e marca como lida', async () => {
    await prisma.notification.create({
      data: { userId: op.id, type: 'solicitacao_nova', title: 'Teste' },
    });

    const lista = await get(op, '/api/notifications');
    const body = lista.json();
    expect(body.unread).toBe(1);

    await post(op, `/api/notifications/${body.items[0]?.id ?? ''}/read`);

    const depois = await get(op, '/api/notifications');
    expect(depois.json<{ unread: number }>().unread).toBe(0);
  });

  it('não marca como lida a notificação de outro usuário', async () => {
    const notificacao = await prisma.notification.create({
      data: { userId: op.id, type: 'solicitacao_nova', title: 'Do operacional' },
    });

    // A rota responde ok, mas o `where` inclui o userId — nada é afetado.
    await post(fin, `/api/notifications/${notificacao.id}/read`);

    const ainda = await prisma.notification.findUniqueOrThrow({ where: { id: notificacao.id } });
    expect(ainda.readAt).toBeNull();
  });
});

// ============================================================================
//  CONFIGURAÇÕES
// ============================================================================

describe('configurações', () => {
  it('lê e altera a margem entre voos', async () => {
    const antes = await get(op, '/api/settings');
    expect(antes.json<{ marginMinutes: number }>().marginMinutes).toBe(45);

    const alterada = await patch(op, '/api/settings', { marginMinutes: 90 });
    expect(alterada.json<{ marginMinutes: number }>().marginMinutes).toBe(90);

    // E passa a valer na verificação de conflito.
    const aircraft = await makeAircraft();
    await makeTariff(aircraft.id);
    const primeira = futureWindow(70, 3);

    // Origem e destino com 2+ caracteres: o schema exige `min(2)`. Com 'A' e
    // 'B' esta viagem nem era criada (422), a agenda ficava de fato livre e o
    // teste acusava a margem por uma falha que não tinha nada a ver com ela.
    const criada = await post(op, '/api/trips', {
      clientId,
      aircraftId: aircraft.id,
      origin: 'Congonhas',
      destination: 'Santos Dumont',
      ...primeira,
      pax: [{ name: 'Passageiro Um' }],
    });
    expect(criada.statusCode).toBe(201);

    // 60 minutos depois do fim: passaria com margem 45, não passa com 90.
    const inicio = new Date(new Date(primeira.returnAt).getTime() + 60 * 60_000);
    const response = await post(op, '/api/trips/check-availability', {
      aircraftId: aircraft.id,
      departureAt: inicio.toISOString(),
      returnAt: new Date(inicio.getTime() + 3_600_000).toISOString(),
    });

    const body = response.json();
    expect(body.available).toBe(false);
    expect(body.reason).toBe('margin');

    await patch(op, '/api/settings', { marginMinutes: 45 });
  });

  it('recusa margem negativa', async () => {
    const response = await patch(op, '/api/settings', { marginMinutes: -10 });
    expect(response.statusCode).toBe(422);
  });
});
