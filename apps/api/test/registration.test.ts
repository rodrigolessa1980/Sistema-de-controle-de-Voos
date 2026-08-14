/**
 * Autocadastro e papel de acesso.
 *
 * O cadastro público entra DIRETO, como Cliente — não há fila de liberação, nem
 * confirmação por e-mail, nem exigência de senha forte (decisão de produto).
 *
 * Isso desloca a garantia central, mas não a remove: o que precisa ficar provado
 * aqui é que o formulário público não é um caminho para GANHAR ALCANCE. Quem se
 * cadastra recebe `cliente`, o papel de menor alcance, com escopo fechado no
 * próprio `clientId` — e nenhum campo do corpo da requisição muda isso.
 *
 * O caso que mais importa passou a ser o do "atalho": mandar `role: 'admin'` no
 * cadastro e continuar saindo de lá como cliente.
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

/**
 * Uma conta PENDENTE, do jeito que o autocadastro a criava antes de o cadastro
 * passar a entrar direto.
 *
 * O fluxo de liberacao nao foi removido: contas pendentes gravadas antes da
 * mudanca continuam existindo em producao, e `approve`/`reject` sao o que as
 * resolve. Como `/auth/register` nao produz mais esse estado, o cenario passa a
 * ser montado aqui, pelo banco - que e de onde ele vem na vida real.
 */
async function criarPendente(
  overrides: Partial<{ name: string; email: string }> = {},
): Promise<{ id: string; email: string }> {
  const email =
    overrides.email ?? `pendente-${Math.random().toString(36).slice(2, 10)}@teste.local`;
  const name = overrides.name ?? 'Pessoa Nova';

  const { hash } = await import('bcryptjs');
  const papel = await prisma.role.findUniqueOrThrow({ where: { key: 'cliente' } });

  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash: await hash(SENHA, 10),
      roleId: papel.id,
      status: 'pendente',
      mustChangePassword: false,
    },
    select: { id: true },
  });

  const admins = await prisma.user.findMany({
    where: { status: 'ativo', deletedAt: null, role: { key: 'admin' } },
    select: { id: true },
  });

  await prisma.notification.createMany({
    data: admins.map((a) => ({
      userId: a.id,
      type: 'cadastro_pendente' as const,
      title: 'Novo cadastro aguardando liberacao',
      body: `${name} - ${email}`,
      entity: 'user',
      entityId: user.id,
    })),
  });

  return { id: user.id, email };
}

describe('cadastro pela tela de login', () => {
  it('cria a conta ATIVA, como cliente e já com cadastro de cliente vinculado', async () => {
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
        client: { select: { name: true, email: true } },
      },
    });

    expect(created.status).toBe('ativo');
    expect(created.name).toBe('Maria Souza');
    expect(created.role.key).toBe('cliente');
    // Senha escolhida pela pessoa: não há nada de provisório a trocar.
    expect(created.mustChangePassword).toBe(false);

    /**
     * O vínculo é o que faz a conta valer alguma coisa.
     *
     * `clientId` nulo com papel cliente significa escopo que não casa com linha
     * nenhuma: a pessoa entra e toda tela vem vazia, o que na prática é pior que
     * não entrar, porque parece defeito do sistema.
     */
    expect(created.clientId).not.toBeNull();
    expect(created.client?.email).toBe(email);
    expect(created.client?.name).toBe('Maria Souza');
  });

  it('entra no sistema logo depois de se cadastrar', async () => {
    const { email } = await register();

    const response = await login(email);
    expect(response.statusCode).toBe(200);

    const body = response.json<{ user: { role: string; clientId: string | null } }>();
    expect(body.user.role).toBe('cliente');
    expect(body.user.clientId).not.toBeNull();
  });

  it('reaproveita o cliente que já existe com o mesmo e-mail', async () => {
    const existente = await makeClient({ name: 'Cliente Antigo', email: 'antigo@teste.local' });

    const { email } = await register({ email: 'antigo@teste.local', name: 'Nome do Cadastro' });
    expect(email).toBe('antigo@teste.local');

    const created = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { clientId: true },
    });

    // O mesmo cadastro, não um segundo: duplicar partiria o histórico de viagens
    // e cobranças em dois, e o portal mostraria metade.
    expect(created.clientId).toBe(existente.id);
    expect(await prisma.client.count({ where: { email: 'antigo@teste.local' } })).toBe(1);
  });

  it('não concede papel pedido no corpo da requisição', async () => {
    const email = `atalho-${Math.random().toString(36).slice(2, 10)}@teste.local`;

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'Pessoa Esperta', email, password: SENHA, role: 'admin' },
    });
    expect(response.statusCode).toBe(200);

    const created = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { role: { select: { key: true } } },
    });

    // O campo não existe no schema da rota; se um dia passar a existir, este
    // caso quebra antes de virar escalada de privilégio em produção.
    expect(created.role.key).toBe('cliente');
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

  /**
   * Senha curta e sem número é ACEITA — por decisão de produto, o cadastro é
   * aberto na home e qualquer atrito ali custa cliente.
   *
   * O caso está aqui em vez de simplesmente ter sido apagado porque a regra
   * afrouxada é uma escolha, não um esquecimento: se alguém reapertar o
   * `passwordSchema` sem querer, isto acusa.
   */
  it('aceita senha curta e sem número', async () => {
    const { email, status } = await register({ password: 'a' });

    expect(status).toBe(200);
    expect(await prisma.user.findUnique({ where: { email } })).not.toBeNull();

    const entrada = await login(email, 'a');
    expect(entrada.statusCode).toBe(200);
  });

  it('recusa senha vazia', async () => {
    const { email, status } = await register({ password: '' });

    // Senha vazia não é senha fraca: é conta sem senha, e o login dela passaria
    // com o campo em branco.
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

describe('login de conta pendente (legado)', () => {
  it('recusa com a senha CERTA e explica o motivo', async () => {
    const { email } = await criarPendente();

    const response = await login(email);

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { message: string } }>().error.message).toMatch(/aguardando/i);
    // Nenhum token, nem cookie de sessão.
    expect(response.body).not.toContain('accessToken');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('com a senha errada cai na mensagem genérica, sem revelar que a conta existe', async () => {
    const { email } = await criarPendente();

    const response = await login(email, 'SenhaErrada2026');

    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { message: string } }>().error.message).not.toMatch(
      /aguardando/i,
    );
  });

  it('não emite refresh token utilizável', async () => {
    const { email } = await criarPendente();
    await login(email);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe('aviso no sino', () => {
  /** O sino de um usuário, como o front o lê. */
  const bell = (user: TestUser) =>
    app.inject({ method: 'GET', url: '/api/notifications', headers: auth(user) });

  it('avisa quem administra, e só quem administra', async () => {
    const { email } = await register({ name: 'Ana Ribeiro' });

    const doAdmin = (await bell(admin)).json<{
      items: { type: string; title: string; body: string | null }[];
      unread: number;
    }>();
    const aviso = doAdmin.items.find((i) => i.type === 'cliente_cadastrado');

    expect(aviso).toBeDefined();
    expect(doAdmin.unread).toBeGreaterThan(0);
    // O corpo diz QUEM pediu: sem isso o admin tem de abrir a fila só para saber
    // se o aviso interessa.
    expect(aviso?.body).toContain('Ana Ribeiro');
    expect(aviso?.body).toContain(email);

    // O destinatário é escolhido por permissão (`user:update`), não por papel.
    // Operacional e cliente não podem liberar, então não são avisados.
    for (const outro of [operacional, cliente]) {
      const itens = (await bell(outro)).json<{ items: { type: string }[] }>().items;
      expect(
        itens.some((i) => i.type === 'cliente_cadastrado'),
        outro.email,
      ).toBe(false);
    }
  });

  it('o aviso carrega o destino do clique', async () => {
    const { email } = await register();
    const novo = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });

    const aviso = await prisma.notification.findFirstOrThrow({
      where: { type: 'cliente_cadastrado', userId: admin.id },
      select: { entity: true, entityId: true },
    });

    // `entity` + `entityId` são o que o front traduz em rota (`notificationPath`).
    // Sem eles o aviso é texto morto e a pessoa tem de achar a tela sozinha.
    expect(aviso.entity).toBe('user');
    expect(aviso.entityId).toBe(novo.id);
  });

  it('liberar fecha o aviso', async () => {
    const pendente = await criarPendente();

    expect((await bell(admin)).json<{ unread: number }>().unread).toBeGreaterThan(0);

    await app.inject({
      method: 'POST',
      url: `/api/users/${pendente.id}/approve`,
      headers: auth(admin),
      payload: { role: 'operacional' },
    });

    // Badge que continua vermelho depois de o pedido ser resolvido é badge que
    // mente: o admin abre a fila e não encontra nada.
    const naoLidas = await prisma.notification.count({
      where: { type: 'cadastro_pendente', entityId: pendente.id, readAt: null },
    });
    expect(naoLidas).toBe(0);
  });

  it('recusar também fecha o aviso', async () => {
    const pendente = await criarPendente();

    await app.inject({
      method: 'POST',
      url: `/api/users/${pendente.id}/reject`,
      headers: auth(admin),
    });

    const naoLidas = await prisma.notification.count({
      where: { type: 'cadastro_pendente', entityId: pendente.id, readAt: null },
    });
    expect(naoLidas).toBe(0);

    // A notificação sobrevive ao delete do usuário: `entityId` é só VARCHAR, sem
    // foreign key. O histórico do sino não é apagado por uma recusa.
    expect(
      await prisma.notification.count({
        where: { type: 'cadastro_pendente', entityId: pendente.id },
      }),
    ).toBeGreaterThan(0);
  });

  it('um cadastro recusado não deixa aviso pendurado para os outros', async () => {
    // Cenário do segundo administrador: os dois recebem o mesmo aviso, um
    // resolve, e o outro não pode continuar com o pontinho vermelho.
    const segundoAdmin = await createUser(app, 'admin', {
      email: `admin2-${Math.random().toString(36).slice(2, 8)}@teste.local`,
    });

    const pendente = await criarPendente();

    expect(
      await prisma.notification.count({
        where: { type: 'cadastro_pendente', entityId: pendente.id },
      }),
    ).toBe(2);

    await app.inject({
      method: 'POST',
      url: `/api/users/${pendente.id}/approve`,
      headers: auth(admin),
      payload: { role: 'financeiro' },
    });

    expect((await bell(segundoAdmin)).json<{ unread: number }>().unread).toBe(0);
  });
});

describe('fila de liberação', () => {
  it('só quem tem user:read enxerga a lista', async () => {
    await criarPendente();

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
    await criarPendente();

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
    await criarPendente();
    await criarPendente();

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
  /** A linha pendente que a liberação resolve. */
  const pendingUser = criarPendente;

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
    const user = await criarPendente({ email: existente.email });
    const { email } = user;

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
    const user = await criarPendente();
    const { email } = user;

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
    const user = await criarPendente();
    const { email } = user;

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
    const user = await criarPendente();

    const response = await app.inject({
      method: 'POST',
      url: `/api/users/${user.id}/reject`,
      headers: auth(operacional),
    });

    expect(response.statusCode).toBe(403);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
  });
});
