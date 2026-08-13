/**
 * Infraestrutura dos testes de integração.
 *
 * Estes testes batem em um banco MySQL DE VERDADE (`aircharter_test`), não em
 * mock. É deliberado: os pontos que mais podem quebrar neste sistema — a
 * atomicidade das transações, o incremento do código sequencial sob
 * concorrência, o `where` do escopo por linha, as foreign keys — simplesmente
 * não existem num mock. Um teste que passa contra um repositório fingido não
 * diz nada sobre isso.
 *
 * `TEST_DATABASE_URL` aponta para um banco separado. Se ela não estiver
 * definida, os testes falham na hora em vez de tocar no banco de produção.
 */

import { execSync } from 'node:child_process';

import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL'];

if (!TEST_DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL não definida. Os testes de integração exigem um banco separado — ' +
      'rodar contra o banco de produção apagaria dados reais.',
  );
}

if (/\/aircharter(\?|$)/.test(TEST_DATABASE_URL)) {
  throw new Error(
    'TEST_DATABASE_URL aponta para o banco "aircharter" (produção). Use "aircharter_test".',
  );
}

// A app lê `DATABASE_URL`; aqui ela passa a ser a de teste antes de qualquer
// import que instancie o Prisma.
process.env['DATABASE_URL'] = TEST_DATABASE_URL;
process.env['NODE_ENV'] = 'test';
process.env['JOBS_ENABLED'] = 'false';
process.env['MAIL_DRY_RUN'] = 'true';
process.env['BCRYPT_ROUNDS'] = '10'; // 12 deixaria a suíte lenta sem ganho real

/**
 * Segredos de teste.
 *
 * `apps/api/src/env.ts` valida o ambiente na importação e chama `process.exit(1)`
 * se faltar alguma coisa — o que é certo em produção e fatal aqui: o Vitest
 * morre inteiro, sem executar um caso sequer.
 *
 * Na máquina de quem desenvolve isso não aparecia, porque o `.env` do projeto
 * estava lá e o `env.ts` o carrega sozinho. No runner do CI não existe `.env`, e
 * a suíte inteira caía. Uma suíte que só roda onde por acaso existe um `.env`
 * não é uma suíte — é uma coincidência.
 *
 * Os valores são fixos e obviamente falsos de propósito: teste não deve nem
 * poder assinar um token que valha fora dali.
 */
process.env['JWT_ACCESS_SECRET'] = 'segredo-de-teste-para-access-token-nao-use-em-producao';
process.env['JWT_REFRESH_SECRET'] = 'segredo-de-teste-para-refresh-token-nao-use-em-producao';
process.env['COOKIE_SECRET'] = 'segredo-de-teste-para-cookie';

export const prisma = new PrismaClient({
  datasources: { db: { url: TEST_DATABASE_URL } },
});

/** Aplica as migrations no banco de teste. Idempotente. */
export function migrateTestDatabase(): void {
  execSync('npx prisma migrate deploy --schema prisma/schema.prisma', {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
    cwd: process.cwd(),
  });
}

/**
 * Zera os DADOS OPERACIONAIS entre os testes.
 *
 * Ordem: filho antes de pai, senão a foreign key barra.
 *
 * Usuários, clientes-fixture, papéis, permissões, configurações e sequências
 * NÃO são apagados: recriá-los a cada teste custa quatro hashes bcrypt e quatro
 * logins contra um MySQL remoto, e era isso que fazia a suíte levar minutos.
 * Eles são criados uma vez, no `beforeAll`.
 */
export async function resetData(keepClientIds: readonly string[] = []): Promise<void> {
  await prisma.passenger.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.charge.deleteMany();
  await prisma.flightRequest.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.aircraftBlock.deleteMany();
  await prisma.tariff.deleteMany();
  await prisma.documentFile.deleteMany();
  await prisma.aircraft.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.emailOutbox.deleteMany();
  await prisma.changeFeed.deleteMany();
  await prisma.auditLog.deleteMany();
  /**
   * Apaga só o cliente que NÃO tem usuário vinculado.
   *
   * É a regra que resolve o problema de ordem entre arquivos de teste: o
   * cliente-fixture de qualquer suíte sempre tem um usuário de portal apontando
   * para ele, então nunca é apagado por engano — nem por outra suíte rodando
   * depois. E como `users.client_id` é a única foreign key que impede o delete,
   * a condição é exatamente a de segurança.
   *
   * Uma lista explícita de ids não bastava: cada arquivo conhece só o próprio
   * cliente, e apagava o dos outros.
   */
  await prisma.client.deleteMany({ where: { users: { none: {} } } });

  /**
   * Zera os agregados denormalizados dos clientes que ficaram.
   *
   * Sem isto, um teste que marca o cliente como `vencido` contamina todos os
   * seguintes: apagar as cobranças não desfaz `financialStatus` nem
   * `openBalance`, porque são colunas, não cálculo em tempo de leitura. O
   * próximo teste que tentasse agendar levaria 422 de pendência financeira sem
   * ter criado nenhuma cobrança.
   */
  {
    await prisma.client.updateMany({
      ...(keepClientIds.length > 0 ? { where: { id: { in: [...keepClientIds] } } } : {}),
      data: {
        openBalance: 0,
        overdueBalance: 0,
        totalInvoiced: 0,
        totalPaid: 0,
        financialStatus: 'em_dia',
        tripCount: 0,
      },
    });
  }

  /**
   * Devolve as configurações ao padrão.
   *
   * `Settings` é uma linha só, criada uma vez no `seedStructure` — nada a
   * apagar, e por isso ela escapava do reset. O teste que altera a margem para
   * 90 minutos deixava esse valor gravado, e a rodada SEGUINTE começava com 90:
   * o próprio teste falhava ao conferir o padrão, e todos os testes de conflito
   * de agenda passavam a medir com uma margem que ninguém pediu.
   *
   * Estado que sobrevive à suíte é pior que teste que falha — ele faz o
   * resultado depender de quantas vezes a suíte já rodou.
   */
  await prisma.settings.updateMany({
    data: {
      marginMinutes: 45,
      dueSoonDays: 15,
      documentRetentionDays: 365,
      notifyOnNewRequest: true,
      notifyExtraEmails: null,
    },
  });

  await prisma.codeSequence.updateMany({ data: { current: 1000 } });
}

/**
 * Reset TOTAL — usuários inclusive. Só para o `beforeAll` de cada arquivo.
 *
 * Os arquivos de teste rodam em série no mesmo processo e compartilham o banco.
 * Sem apagar os usuários do arquivo anterior, o `deleteMany` de clientes esbarra
 * na foreign key `users.client_id` e o `beforeAll` inteiro falha — levando todos
 * os casos do arquivo para "skipped".
 *
 * Ordem: usuários antes de clientes, sempre.
 */
export async function resetAll(): Promise<void> {
  await resetData();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
  await prisma.client.deleteMany();
}

/** Cria papéis, permissões, configurações e sequências. Roda uma vez. */
export async function seedStructure(): Promise<void> {
  const {
    ALL_PERMISSIONS,
    PERMISSIONS,
    permissionParts,
    ROLE_KEYS,
    ROLE_LABELS,
    ROLE_PERMISSIONS,
  } = await import('@acm/shared');

  for (const key of ALL_PERMISSIONS) {
    const { resource, action } = permissionParts(key);
    await prisma.permission.upsert({
      where: { key },
      create: { key, resource, action, description: PERMISSIONS[key] },
      update: {},
    });
  }

  const permissionIds = new Map(
    (await prisma.permission.findMany({ select: { id: true, key: true } })).map((p) => [
      p.key,
      p.id,
    ]),
  );

  for (const key of ROLE_KEYS) {
    const role = await prisma.role.upsert({
      where: { key },
      create: { key, name: ROLE_LABELS[key], isSystem: true },
      update: {},
      select: { id: true },
    });

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: ROLE_PERMISSIONS[key]
        .map((permKey) => permissionIds.get(permKey))
        .filter((id): id is string => id !== undefined)
        .map((permissionId) => ({ roleId: role.id, permissionId })),
      skipDuplicates: true,
    });
  }

  await prisma.settings.upsert({
    where: { id: 'singleton' },
    create: {
      id: 'singleton',
      companyName: 'ACM Teste',
      contactEmail: 'teste@aircharter.local',
      timezone: 'America/Sao_Paulo',
      marginMinutes: 45,
      dueSoonDays: 15,
      documentRetentionDays: 365,
      notifyOnNewRequest: true,
    },
    update: {},
  });

  for (const seq of [
    { key: 'trip', prefix: 'VOO' },
    { key: 'request', prefix: 'SOL' },
    { key: 'charge', prefix: 'COB' },
  ]) {
    await prisma.codeSequence.upsert({
      where: { key: seq.key },
      create: { ...seq, current: 1000, padding: 4 },
      update: {},
    });
  }
}

// ============================================================================
//  USUÁRIOS E TOKENS
// ============================================================================

export interface TestUser {
  readonly id: string;
  readonly email: string;
  readonly token: string;
  readonly clientId: string | null;
}

/** Senha de todo usuário criado por `createUser`. Exportada para os casos que
 * precisam fazer login de novo — repetir a string em cada arquivo faria um teste
 * quebrar em silêncio no dia em que ela mudar aqui. */
export const TEST_PASSWORD = 'SenhaDeTeste123';

/** Cria um usuário com o papel informado e devolve um access token pronto. */
export async function createUser(
  app: FastifyInstance,
  roleKey: 'operacional' | 'financeiro' | 'cliente' | 'admin',
  options: { clientId?: string; email?: string } = {},
): Promise<TestUser> {
  const { hash } = await import('bcryptjs');

  const email = options.email ?? `${roleKey}-${Date.now().toString(36)}@teste.local`;
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });

  const user = await prisma.user.create({
    data: {
      email,
      name: `Usuário ${roleKey}`,
      passwordHash: await hash(TEST_PASSWORD, 10),
      roleId: role.id,
      clientId: options.clientId ?? null,
      mustChangePassword: false,
    },
    select: { id: true, clientId: true },
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: TEST_PASSWORD },
  });

  if (response.statusCode !== 200) {
    throw new Error(`login de teste falhou (${response.statusCode}): ${response.body}`);
  }

  const body = response.json<{ accessToken: string }>();
  return { id: user.id, email, token: body.accessToken, clientId: user.clientId };
}

/** Header de autorização de um usuário de teste. */
export const auth = (user: TestUser): Record<string, string> => ({
  authorization: `Bearer ${user.token}`,
});

// ============================================================================
//  FÁBRICAS
// ============================================================================
//
// Criam registros direto pelo Prisma, sem passar pela API. São dados de APOIO
// para o cenário do teste, não o que está sendo testado — quando a criação em
// si é o alvo, o teste chama a rota.

export async function makeClient(overrides: Partial<{ name: string; email: string }> = {}) {
  const suffix = Math.random().toString(36).slice(2, 8);
  return prisma.client.create({
    data: {
      name: overrides.name ?? `Cliente ${suffix}`,
      email: overrides.email ?? `cliente-${suffix}@teste.local`,
    },
  });
}

export async function makeAircraft(
  overrides: Partial<{ prefix: string; cruiseSpeed: number }> = {},
) {
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return prisma.aircraft.create({
    data: {
      prefix: overrides.prefix ?? `PT-${suffix}`,
      kind: 'aviao',
      model: 'Modelo Teste',
      manufacturer: 'Fabricante Teste',
      capacity: 8,
      cruiseSpeed: overrides.cruiseSpeed ?? 800,
      status: 'disponivel',
    },
  });
}

export async function makeTariff(aircraftId: string, value = 10_000) {
  const quarter = value / 4;
  return prisma.tariff.create({
    data: {
      aircraftId,
      value,
      costFuel: quarter,
      costFlightHour: quarter,
      costFees: quarter,
      costPilot: quarter,
      unit: 'por_hora',
      startDate: new Date('2020-01-01T00:00:00.000Z'),
      active: true,
    },
  });
}

/** Uma janela de voo no futuro, para não esbarrar na regra de data no passado. */
export function futureWindow(
  daysFromNow = 30,
  hours = 8,
): { departureAt: string; returnAt: string } {
  const start = new Date(Date.now() + daysFromNow * 86_400_000);
  start.setUTCHours(12, 0, 0, 0);
  const end = new Date(start.getTime() + hours * 3_600_000);
  return { departureAt: start.toISOString(), returnAt: end.toISOString() };
}

export const TODAY_ISO = (): string => new Date().toISOString().slice(0, 10);
