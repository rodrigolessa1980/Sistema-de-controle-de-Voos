/**
 * Autocadastro e liberação de acesso.
 *
 * O que precisa ficar provado aqui é a garantia central do fluxo: abrir um
 * formulário público de cadastro NÃO abre o sistema. Entre o cadastro e o
 * primeiro login existe uma decisão humana, e nenhum caminho pula essa decisão.
 *
 * O caso que mais importa é o do "quase": senha certa, conta existente, e ainda
 * assim sem sessão — porque `status` é `pendente`. É o único jeito de saber que a
 * conta pendente não vira acesso por acidente.
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
  TEST_PASSWORD,
  type TestUser,
} from './setup';

let app: FastifyInstance;
let admin: TestUser;
let operacional: TestUser;
let cliente: TestUser;
let clientId: string;

const SENHA = 'SenhaNova2026';

beforeAll(async () => {
  migrateTestDatabase();
  const { buildApp } = await import('../src/app');
  app = await buildApp();
  await app.ready();
  await seedStructure();

  await resetAll();
  const client = await makeClient();
  clientId = client.id;

  admin = await createUser(app, 'admin');
  operacional = await createUser(app, 'operacional');
  // O usuário de portal existe para o cliente-fixture NÃO ser recolhido pela
  // limpeza (que apaga cliente sem usuário) — ver o comentário em `resetData`.
  cliente = await createUser(app, 'cliente', { clientId });
}, 180_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetData([clientId]);

  /**
   * Fora os usuários que os casos anteriores criaram.
   *
   * Sem isto, o e-mail do teste anterior ainda existe e o `register` seguinte
   * cairia no caminho "e-mail já cadastrado" — o caso passaria a testar outra
   * coisa. Os clientes que só existiam por causa desses usuários saem no passo
   * seguinte, já que a limpeza de `resetData` rodou antes de eles ficarem órfãos.
   */
  await prisma.user.deleteMany({
    where: { id: { notIn: [admin.id, operacional.id, cliente.id] } },
  });
  await prisma.client.deleteMany({ where: { users: { none: {} } } });
});

/** Cadastra alguém e devolve o e-mail usado. */
async function register(
  overrides: Partial<{ name: string; email: string; password: string }> = {},
): Promise<{ email: string; status: number }> {
  const email = overrides.email ?? `novo-${Math.random().toString(36).slice(2, 10)}@teste.local`;

  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: overrides.name ?? 'Pessoa Nova',
      email,
      password: overrides.password ?? SENHA,
    },
  });

  return { email, status: response.statusCode };
}

const login = (email: string, password = SENHA) =>
  app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });

describe('cadastro pela tela de login', () => {
  it('cria a conta como pendente, sem papel de acesso efetivo', async () => {
    const { email, status } = await register({ name: 'Maria Souza' });
    expect(status).toBe(200);

    const created = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: {
        name: true,
        status: true,
        clientId: true,
        mustChangePassword: true,
        role: { select: { key: true } },
      },
    });

    expect(created.status).toBe('pendente');
    expect(created.name).toBe('Maria Souza');
    // Papel de menor alcance e sem vínculo: mesmo que a conta escapasse ativa, o
    // escopo por linha trataria `clientId` nulo como "não vê nada".
    expect(created.role.key).toBe('cliente');
    expect(created.clientId).toBeNull();
    // Senha escolhida pela pessoa: não há nada de provisório a trocar.
    expect(created.mustChangePassword).toBe(false);
  });

  it('a senha é gravada como hash, nunca em texto', async () => {
    const { email } = await register();
    const { passwordHash } = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { passwordHash: true },
    });

    expect(passwordHash).not.toBe(SENHA);
    expect(passwordHash.startsWith('$2')).toBe(true);
  });

  it('recusa senha fraca sem criar nada', async () => {
    const { email, status } = await register({ password: 'curta1' });

    expect(status).toBe(422);
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it('e-mail já cadastrado responde igual e não cria segundo usuário', async () => {
    const { email } = await register();

    const repeat = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'Outra Pessoa', email, password: 'OutraSenha2026' },
    });

    // Mesma resposta do cadastro novo: a rota pública não conta a estranho quem
    // tem conta no sistema.
    expect(repeat.statusCode).toBe(200);
    expect(await prisma.user.count({ where: { email } })).toBe(1);

    // E o cadastro original fica intacto — nem o nome nem a senha são
    // sobrescritos por quem chutou o e-mail.
    const kept = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { name: true },
    });
    expect(kept.name).toBe('Pessoa Nova');
  });

  it('e-mail de usuário JÁ ATIVO não derruba nem altera a conta dele', async () => {
    const repeat = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'Impostor', email: admin.email, password: 'SenhaQualquer2026' },
    });

    expect(repeat.statusCode).toBe(200);

    const untouched = await prisma.user.findUniqueOrThrow({
      where: { email: admin.email },
      select: { status: true, name: true, role: { select: { key: true } } },
    });
    expect(untouched.status).toBe('ativo');
    expect(untouched.role.key).toBe('admin');
    expect(untouched.name).not.toBe('Impostor');

    // O admin continua entrando com a senha dele.
    expect((await login(admin.email, TEST_PASSWORD)).statusCode).toBe(200);
  });
});

describe('login antes da liberação', () => {
  it('recusa com a senha CERTA e explica o motivo', async () => {
    const { email } = await register();

    const response = await login(email);

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { message: string } }>().error.message).toMatch(/aguardando/i);
    // Nenhum token, nem cookie de sessão.
    expect(response.body).not.toContain('accessToken');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('com a senha errada cai na mensagem genérica, sem revelar que a conta existe', async () => {
    const { email } = await register();

    const response = await login(email, 'SenhaErrada2026');

    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { message: string } }>().error.message).not.toMatch(
      /aguardando/i,
    );
  });

  it('não emite refresh token utilizável', async () => {
    const { email } = await register();
    await login(email);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe('fila de liberação', () => {
  it('só quem tem user:read enxerga a lista', async () => {
    await register();

    expect((await app.inject({ method: 'GET', url: '/api/users' })).statusCode).toBe(401);

    // Operacional entra em Configurações, mas não libera acesso de ninguém. E o
    // cliente, muito menos: a fila de cadastros é lista de gente.
    for (const outro of [operacional, cliente]) {
      const negado = await app.inject({ method: 'GET', url: '/api/users', headers: auth(outro) });
      expect(negado.statusCode, outro.email).toBe(403);
    }

    const permitido = await app.inject({
      method: 'GET',
      url: '/api/users',
      headers: auth(admin),
    });
    expect(permitido.statusCode).toBe(200);
  });

  it('a listagem nunca devolve o hash da senha', async () => {
    await register();

    const response = await app.inject({
      method: 'GET',
      url: '/api/users?status=pendente',
      headers: auth(admin),
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('passwordHash');
    expect(response.body).not.toContain('$2b$');
  });

  it('filtra por status e conta o total', async () => {
    await register();
    await register();

    const response = await app.inject({
      method: 'GET',
      url: '/api/users?status=pendente',
      headers: auth(admin),
    });

    const body = response.json<{ items: { status: string }[]; total: number }>();
    expect(body.total).toBe(2);
    expect(body.items.every((item) => item.status === 'pendente')).toBe(true);
  });
});

describe('liberação pelo administrador', () => {
  /** Cadastra e devolve o id da linha pendente. */
  async function pendingUser(): Promise<{ id: string; email: string }> {
    const { email } = await register();
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });
    return { id: user.id, email };
  }

  const approve = (id: string, payload: object, actor: TestUser = admin) =>
    app.inject({ method: 'POST', url: `/api/users/${id}/approve`, headers: auth(actor), payload });

  it('libera como operacional e o login passa a funcionar', async () => {
    const { id, email } = await pendingUser();

    const response = await approve(id, { role: 'operacional' });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ role: string; status: string }>()).toMatchObject({
      role: 'operacional',
      status: 'ativo',
    });

    const entrada = await login(email);
    expect(entrada.statusCode).toBe(200);

    // E as permissões que chegam na sessão são as do papel concedido, não as do
    // `cliente` que a linha carregava enquanto estava pendente.
    const sessao = entrada.json<{ user: { role: string; permissions: string[] } }>();
    expect(sessao.user.role).toBe('operacional');
    expect(sessao.user.permissions).toContain('trip:create');
    expect(sessao.user.permissions).not.toContain('payment:settle');
  });

  it('papel cliente sem vínculo cria o cadastro do cliente', async () => {
    const { id, email } = await pendingUser();

    const response = await approve(id, { role: 'cliente' });
    expect(response.statusCode).toBe(200);

    const body = response.json<{ clientId: string | null; clientName: string | null }>();
    expect(body.clientId).not.toBeNull();
    expect(body.clientName).toBe('Pessoa Nova');

    const client = await prisma.client.findFirstOrThrow({ where: { email } });
    expect(client.name).toBe('Pessoa Nova');
  });

  it('papel cliente reaproveita cadastro existente com o mesmo e-mail', async () => {
    const existente = await makeClient({ name: 'Cliente Antigo' });
    const { email } = await register({ email: existente.email });
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });

    const response = await approve(user.id, { role: 'cliente' });
    expect(response.statusCode).toBe(200);

    // Um segundo `Client` com o mesmo e-mail partiria o histórico do cliente em
    // dois, e o portal mostraria metade.
    expect(response.json<{ clientId: string }>().clientId).toBe(existente.id);
    expect(await prisma.client.count({ where: { email } })).toBe(1);
  });

  it('papel cliente aceita vínculo escolhido pelo administrador', async () => {
    const { id } = await pendingUser();

    const response = await approve(id, { role: 'cliente', clientId });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ clientId: string }>().clientId).toBe(clientId);
  });

  it('recusa vínculo com cliente inexistente', async () => {
    const { id } = await pendingUser();

    expect((await approve(id, { role: 'cliente', clientId: 'nao-existe' })).statusCode).toBe(404);
    // Nada foi ativado pela metade.
    const user = await prisma.user.findUniqueOrThrow({ where: { id }, select: { status: true } });
    expect(user.status).toBe('pendente');
  });

  it('recusa vínculo de cliente em papel interno', async () => {
    const { id } = await pendingUser();

    expect((await approve(id, { role: 'operacional', clientId })).statusCode).toBe(400);
  });

  it('papel inválido é recusado pelo contrato', async () => {
    const { id } = await pendingUser();

    // Não existe caminho para pedir um papel fora do enum — nem "superadmin",
    // nem string arbitrária.
    expect((await approve(id, { role: 'superadmin' })).statusCode).toBe(422);
    expect((await approve(id, {})).statusCode).toBe(422);
  });

  it('operacional não libera ninguém', async () => {
    const { id, email } = await pendingUser();

    expect((await approve(id, { role: 'admin' }, operacional)).statusCode).toBe(403);
    expect((await login(email)).statusCode).toBe(403);
  });

  it('liberar duas vezes é recusado', async () => {
    const { id } = await pendingUser();

    expect((await approve(id, { role: 'financeiro' })).statusCode).toBe(200);

    // Sem isto, um duplo clique poderia trocar o papel de um usuário já ativo
    // por esta rota, que não é feita para isso.
    const segunda = await approve(id, { role: 'admin' });
    expect(segunda.statusCode).toBe(400);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id },
      select: { role: { select: { key: true } } },
    });
    expect(user.role.key).toBe('financeiro');
  });

  it('registra a liberação na auditoria', async () => {
    const { id } = await pendingUser();
    await approve(id, { role: 'operacional' });

    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'user.approve', entityId: id },
    });
    expect(log.userId).toBe(admin.id);
  });
});

describe('recusa pelo administrador', () => {
  it('apaga o cadastro e libera o e-mail para nova tentativa', async () => {
    const { email } = await register();
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/users/${user.id}/reject`,
      headers: auth(admin),
    });
    expect(response.statusCode).toBe(200);
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();

    // O e-mail volta a ficar livre: sem isto, uma recusa por engano deixaria a
    // pessoa presa para sempre, porque `register` responde a mesma coisa para
    // e-mail já existente.
    const segunda = await register({ email });
    expect(segunda.status).toBe(200);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });

  it('guarda quem era na auditoria, mesmo com a linha apagada', async () => {
    const { email } = await register();
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });

    await app.inject({
      method: 'POST',
      url: `/api/users/${user.id}/reject`,
      headers: auth(admin),
    });

    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'user.reject', entityId: user.id },
    });
    expect(JSON.stringify(log.before)).toContain(email);
  });

  it('não recusa usuário já ativo', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/users/${operacional.id}/reject`,
      headers: auth(admin),
    });

    expect(response.statusCode).toBe(400);
    expect(await prisma.user.findUnique({ where: { id: operacional.id } })).not.toBeNull();
  });

  it('operacional não recusa ninguém', async () => {
    const { email } = await register();
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/users/${user.id}/reject`,
      headers: auth(operacional),
    });

    expect(response.statusCode).toBe(403);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
  });
});
