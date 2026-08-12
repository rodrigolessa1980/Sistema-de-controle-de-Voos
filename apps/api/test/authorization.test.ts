/**
 * Autorização — a matriz inteira, rota por rota.
 *
 * Este é o teste mais importante do repositório. Ele percorre TODAS as rotas de
 * escrita e leitura e confirma, para cada perfil, se o acesso é liberado ou
 * negado. Um `ROLE_PERMISSIONS` alterado por engano quebra aqui.
 *
 * A checagem é de STATUS, não de conteúdo: o que importa é 403 vs "não-403".
 * Um 404 ou 422 significa que a autorização passou — o que é exatamente o que o
 * teste quer distinguir.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  auth,
  createUser,
  makeClient,
  migrateTestDatabase,
  prisma,
  resetAll,
  resetData,
  seedStructure,
  type TestUser,
} from './setup';

let app: FastifyInstance;
let operacional: TestUser;
let financeiro: TestUser;
let cliente: TestUser;
let admin: TestUser;
let clientId: string;

beforeAll(async () => {
  migrateTestDatabase();
  const { buildApp } = await import('../src/app');
  app = await buildApp();
  await app.ready();
  await seedStructure();

  // Usuários criados UMA vez: cada login custa um bcrypt e várias idas ao
  // banco remoto. Recriá-los por teste levava a suíte a minutos.
  await resetAll();
  const client = await makeClient();
  clientId = client.id;

  operacional = await createUser(app, 'operacional');
  financeiro = await createUser(app, 'financeiro');
  cliente = await createUser(app, 'cliente', { clientId });
  admin = await createUser(app, 'admin');
}, 180_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Só os dados operacionais: os usuários e o cliente-fixture permanecem.
  await resetData([clientId]);
});

/** `true` quando a autorização barrou. */
async function forbidden(
  user: TestUser,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload: object = {},
): Promise<boolean> {
  const response = await app.inject({ method, url, headers: auth(user), payload });
  return response.statusCode === 403;
}

describe('sem autenticação', () => {
  it('toda rota protegida responde 401', async () => {
    const rotas = [
      ['GET', '/api/trips'],
      ['GET', '/api/clients'],
      ['GET', '/api/aircraft'],
      ['GET', '/api/charges'],
      ['GET', '/api/changes'],
      ['GET', '/api/dashboard/operacional'],
      ['POST', '/api/trips'],
    ] as const;

    for (const [method, url] of rotas) {
      const response = await app.inject({ method, url });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('health e ready ficam abertos — o orquestrador precisa deles', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/ready' })).statusCode).toBe(200);
  });

  it('token inválido é recusado', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/trips',
      headers: { authorization: 'Bearer nao-e-um-token' },
    });
    expect(response.statusCode).toBe(401);
  });
});

// ============================================================================
//  LIMITE 1 — o Operacional não dá baixa
// ============================================================================

describe('limite 1 — o Operacional NÃO toca no financeiro', () => {
  it('não registra pagamento nem dá baixa', async () => {
    expect(await forbidden(operacional, 'POST', '/api/charges/qualquer/payments', {})).toBe(true);
    expect(await forbidden(operacional, 'POST', '/api/charges/qualquer/settle', {})).toBe(true);
    expect(await forbidden(operacional, 'POST', '/api/payments/qualquer/reverse', {})).toBe(true);
    expect(await forbidden(operacional, 'GET', '/api/payments')).toBe(true);
  });

  it('não cria cobrança', async () => {
    expect(await forbidden(operacional, 'POST', '/api/charges', {})).toBe(true);
  });

  it('não vê o painel nem o relatório financeiro', async () => {
    expect(await forbidden(operacional, 'GET', '/api/dashboard/financeiro')).toBe(true);
    expect(await forbidden(operacional, 'GET', '/api/reports/financial')).toBe(true);
  });

  it('MAS lê cobrança — precisa ver a pendência antes de agendar', async () => {
    expect(await forbidden(operacional, 'GET', '/api/charges')).toBe(false);
  });
});

// ============================================================================
//  LIMITE 2 — o Financeiro não altera viagens
// ============================================================================

describe('limite 2 — o Financeiro NÃO altera a operação', () => {
  it('não cria, edita, cancela nem conclui viagem', async () => {
    expect(await forbidden(financeiro, 'POST', '/api/trips', {})).toBe(true);
    expect(await forbidden(financeiro, 'PATCH', '/api/trips/qualquer', {})).toBe(true);
    expect(await forbidden(financeiro, 'POST', '/api/trips/qualquer/cancel', {})).toBe(true);
    expect(await forbidden(financeiro, 'POST', '/api/trips/qualquer/complete')).toBe(true);
  });

  it('não mexe em frota nem em tarifa', async () => {
    expect(await forbidden(financeiro, 'GET', '/api/aircraft')).toBe(true);
    expect(await forbidden(financeiro, 'POST', '/api/aircraft', {})).toBe(true);
    expect(await forbidden(financeiro, 'GET', '/api/tariffs')).toBe(true);
    expect(await forbidden(financeiro, 'POST', '/api/tariffs', {})).toBe(true);
  });

  it('não analisa solicitação', async () => {
    expect(await forbidden(financeiro, 'GET', '/api/requests')).toBe(true);
    expect(await forbidden(financeiro, 'POST', '/api/requests/qualquer/review')).toBe(true);
    expect(await forbidden(financeiro, 'POST', '/api/requests/qualquer/reject', {})).toBe(true);
  });

  it('não altera configurações', async () => {
    expect(await forbidden(financeiro, 'PATCH', '/api/settings', {})).toBe(true);
  });

  it('MAS lê viagem, cria cobrança e dá baixa — é a função dele', async () => {
    expect(await forbidden(financeiro, 'GET', '/api/trips')).toBe(false);
    expect(await forbidden(financeiro, 'POST', '/api/charges', {})).toBe(false);
    expect(await forbidden(financeiro, 'GET', '/api/payments')).toBe(false);
    expect(await forbidden(financeiro, 'GET', '/api/reports/financial')).toBe(false);
  });
});

// ============================================================================
//  LIMITE 3 — o Cliente só vê o próprio, e nunca a frota
// ============================================================================

describe('limite 3 — o Cliente é confinado aos próprios dados', () => {
  it('não vê frota, tarifa nem agenda completa', async () => {
    expect(await forbidden(cliente, 'GET', '/api/aircraft')).toBe(true);
    expect(await forbidden(cliente, 'GET', '/api/tariffs')).toBe(true);
    expect(
      await forbidden(
        cliente,
        'GET',
        '/api/availability/calendar?from=2026-01-01T00:00:00Z&to=2026-01-15T00:00:00Z',
      ),
    ).toBe(true);
    expect(
      await forbidden(
        cliente,
        'GET',
        '/api/availability/blocks?from=2026-01-01T00:00:00Z&to=2026-01-15T00:00:00Z',
      ),
    ).toBe(true);
  });

  it('não vê relatório financeiro nem pagamentos', async () => {
    expect(await forbidden(cliente, 'GET', '/api/reports/financial')).toBe(true);
    expect(await forbidden(cliente, 'GET', '/api/payments')).toBe(true);
  });

  it('não vê painel de outro perfil', async () => {
    expect(await forbidden(cliente, 'GET', '/api/dashboard/operacional')).toBe(true);
    expect(await forbidden(cliente, 'GET', '/api/dashboard/financeiro')).toBe(true);
  });

  it('não cria viagem nem cobrança', async () => {
    expect(await forbidden(cliente, 'POST', '/api/trips', {})).toBe(true);
    expect(await forbidden(cliente, 'POST', '/api/charges', {})).toBe(true);
  });

  it('não lê a lista completa de clientes', async () => {
    expect(await forbidden(cliente, 'GET', '/api/clients')).toBe(true);
  });

  it('não alcança o cadastro de OUTRO cliente', async () => {
    const outro = await makeClient();
    const response = await app.inject({
      method: 'GET',
      url: `/api/clients/${outro.id}`,
      headers: auth(cliente),
    });
    expect(response.statusCode).toBe(403);
  });

  it('MAS alcança o próprio cadastro, solicitações e disponibilidade mascarada', async () => {
    expect(await forbidden(cliente, 'GET', `/api/clients/${clientId}`)).toBe(false);
    expect(await forbidden(cliente, 'GET', '/api/clients/me')).toBe(false);
    expect(await forbidden(cliente, 'GET', '/api/requests')).toBe(false);
    expect(await forbidden(cliente, 'GET', '/api/dashboard/cliente')).toBe(false);
    expect(
      await forbidden(
        cliente,
        'GET',
        '/api/availability/days?from=2026-01-01T00:00:00Z&to=2026-01-15T00:00:00Z',
      ),
    ).toBe(false);
  });
});

// ============================================================================
//  ESCOPO POR LINHA
// ============================================================================

describe('escopo por linha — o cliente não enxerga dado alheio nas listagens', () => {
  it('a lista de viagens traz apenas as próprias', async () => {
    const outroCliente = await makeClient();
    const aircraft = await prisma.aircraft.create({
      data: {
        prefix: 'PT-ESC',
        kind: 'aviao',
        model: 'X',
        manufacturer: 'Y',
        capacity: 4,
        cruiseSpeed: 700,
      },
    });

    const base = new Date(Date.now() + 40 * 86_400_000);
    for (const [index, owner] of [clientId, outroCliente.id].entries()) {
      await prisma.trip.create({
        data: {
          code: `VOO-90${index}`,
          clientId: owner,
          aircraftId: aircraft.id,
          origin: 'A',
          destination: 'B',
          departureAt: new Date(base.getTime() + index * 86_400_000),
          returnAt: new Date(base.getTime() + index * 86_400_000 + 3_600_000),
          passengers: 1,
          status: 'confirmada',
        },
      });
    }

    const response = await app.inject({
      method: 'GET',
      url: '/api/trips',
      headers: auth(cliente),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ items: { clientId: string }[] }>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.clientId).toBe(clientId);
  });

  it('a lista de cobranças traz apenas as próprias', async () => {
    const outroCliente = await makeClient();

    for (const [index, owner] of [clientId, outroCliente.id].entries()) {
      await prisma.charge.create({
        data: {
          code: `COB-90${index}`,
          clientId: owner,
          total: 1000,
          paidAmount: 0,
          balance: 1000,
          dueDate: new Date('2026-12-01T00:00:00.000Z'),
          status: 'pendente',
        },
      });
    }

    const response = await app.inject({
      method: 'GET',
      url: '/api/charges',
      headers: auth(cliente),
    });

    const body = response.json<{ items: { clientId: string }[] }>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.clientId).toBe(clientId);
  });
});

// ============================================================================
//  DTO POR PERFIL
// ============================================================================

describe('DTO por perfil — o cliente nunca recebe frota nem tarifa', () => {
  it('a viagem do cliente sai sem NENHUM campo interno', async () => {
    const aircraft = await prisma.aircraft.create({
      data: {
        prefix: 'PT-DTO',
        kind: 'aviao',
        model: 'Confidencial',
        manufacturer: 'Secreta',
        capacity: 6,
        cruiseSpeed: 800,
      },
    });

    const window = new Date(Date.now() + 45 * 86_400_000);
    await prisma.trip.create({
      data: {
        code: 'VOO-DTO1',
        clientId,
        aircraftId: aircraft.id,
        origin: 'São Paulo',
        destination: 'Rio de Janeiro',
        departureAt: window,
        returnAt: new Date(window.getTime() + 7_200_000),
        passengers: 2,
        status: 'confirmada',
        internalTariff: 12_000,
        flightHours: 2.5,
        estimatedValue: 30_000,
        commercialValue: 33_000,
        distanceKm: 400,
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/trips',
      headers: auth(cliente),
    });

    const body = response.json<{ items: Record<string, unknown>[] }>();
    const trip = body.items[0];
    expect(trip).toBeDefined();

    for (const campo of [
      'aircraft',
      'aircraftId',
      'internalTariff',
      'estimatedValue',
      'commercialValue',
      'tariffId',
      'flightHours',
      'distanceKm',
      'scheduledWithDebt',
    ]) {
      expect(trip, `o cliente NÃO pode receber "${campo}"`).not.toHaveProperty(campo);
    }

    // E o texto do payload inteiro não pode conter o prefixo da aeronave.
    expect(response.body).not.toContain('PT-DTO');
    expect(response.body).not.toContain('Confidencial');
  });

  it('o operacional recebe os mesmos campos internos', async () => {
    const aircraft = await prisma.aircraft.create({
      data: {
        prefix: 'PT-INT',
        kind: 'aviao',
        model: 'Visível',
        manufacturer: 'Interna',
        capacity: 6,
        cruiseSpeed: 800,
      },
    });

    const window = new Date(Date.now() + 46 * 86_400_000);
    await prisma.trip.create({
      data: {
        code: 'VOO-INT1',
        clientId,
        aircraftId: aircraft.id,
        origin: 'A',
        destination: 'B',
        departureAt: window,
        returnAt: new Date(window.getTime() + 7_200_000),
        passengers: 2,
        status: 'confirmada',
        internalTariff: 12_000,
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/trips',
      headers: auth(operacional),
    });

    const body = response.json<{ items: Record<string, unknown>[] }>();
    expect(body.items[0]).toHaveProperty('aircraft');
    expect(body.items[0]).toHaveProperty('internalTariff');
    expect(response.body).toContain('PT-INT');
  });
});

// ============================================================================
//  ADMIN
// ============================================================================

describe('admin', () => {
  it('alcança tudo', async () => {
    const rotas = [
      '/api/aircraft',
      '/api/tariffs',
      '/api/clients',
      '/api/trips',
      '/api/requests',
      '/api/charges',
      '/api/payments',
      '/api/settings',
      '/api/reports/financial',
      '/api/dashboard/operacional',
      '/api/dashboard/financeiro',
    ];

    for (const url of rotas) {
      const response = await app.inject({ method: 'GET', url, headers: auth(admin) });
      expect(response.statusCode, url).not.toBe(403);
    }
  });
});

// ============================================================================
//  AUTORIZAÇÃO ANTES DA VALIDAÇÃO
// ============================================================================

describe('ordem do ciclo de vida', () => {
  it('quem não tem permissão recebe 403, não 422 — o schema não é revelado', async () => {
    // Corpo propositalmente inválido: se a validação rodasse antes da
    // autorização, a resposta seria 422 com os campos exigidos pela rota.
    const response = await app.inject({
      method: 'POST',
      url: '/api/trips',
      headers: auth(financeiro),
      payload: {},
    });

    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain('clientId');
  });
});
