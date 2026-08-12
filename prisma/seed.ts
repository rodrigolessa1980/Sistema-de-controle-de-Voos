/**
 * Seed do banco — SOMENTE dados estruturais.
 *
 *   npm run seed
 *
 * Cria o que o sistema precisa para funcionar e nada além disso:
 *   - papéis e permissões (a matriz de `@acm/shared`);
 *   - o registro único de configurações;
 *   - as sequências de código (VOO / SOL / COB);
 *   - o usuário administrador inicial.
 *
 * NÃO existe dado de demonstração aqui. Aeronave, cliente, tarifa, viagem,
 * solicitação e cobrança são cadastrados pela aplicação, pelas pessoas que
 * operam o sistema. Um seed que inventa frota e cliente cria um estado que
 * ninguém sabe se é real, e mais cedo ou mais tarde alguém fatura em cima dele.
 *
 * É idempotente: rodar de novo atualiza a matriz de permissões e não duplica
 * nada.
 */

import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  permissionParts,
  ROLE_KEYS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  type Permission,
  type RoleKey,
} from '@acm/shared';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

const ROUNDS = Number(process.env.BCRYPT_ROUNDS ?? 12);

// ============================================================================
//  1. PAPÉIS E PERMISSÕES
// ============================================================================

async function seedAuthorization(): Promise<Map<RoleKey, string>> {
  console.log('· papéis e permissões');

  for (const key of ALL_PERMISSIONS) {
    const { resource, action } = permissionParts(key);
    await prisma.permission.upsert({
      where: { key },
      create: { key, resource, action, description: PERMISSIONS[key] },
      update: { resource, action, description: PERMISSIONS[key] },
    });
  }

  const permissionIds = new Map(
    (await prisma.permission.findMany({ select: { id: true, key: true } })).map((p) => [
      p.key as Permission,
      p.id,
    ]),
  );

  // Permissão que saiu do catálogo tem que sair do banco também, senão um papel
  // continua carregando acesso que o código já não reconhece.
  const orphans = [...permissionIds.keys()].filter((key) => !ALL_PERMISSIONS.includes(key));
  if (orphans.length > 0) {
    await prisma.permission.deleteMany({ where: { key: { in: orphans } } });
    console.log(`  ${orphans.length} permissão(ões) obsoleta(s) removida(s)`);
  }

  const roleIds = new Map<RoleKey, string>();

  for (const key of ROLE_KEYS) {
    const role = await prisma.role.upsert({
      where: { key },
      create: { key, name: ROLE_LABELS[key], isSystem: true },
      update: { name: ROLE_LABELS[key], isSystem: true },
      select: { id: true },
    });
    roleIds.set(key, role.id);

    const wanted = ROLE_PERMISSIONS[key];

    // Substitui o vínculo inteiro: remover uma permissão do código a remove do
    // banco no próximo seed. Sem isso, a matriz só cresceria.
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: wanted
        .map((permKey) => permissionIds.get(permKey))
        .filter((id): id is string => id !== undefined)
        .map((permissionId) => ({ roleId: role.id, permissionId })),
      skipDuplicates: true,
    });

    console.log(`  ${key.padEnd(12)} ${wanted.length} permissões`);
  }

  return roleIds;
}

// ============================================================================
//  2. CONFIGURAÇÕES E SEQUÊNCIAS
// ============================================================================

async function seedSettings(): Promise<void> {
  console.log('· configurações e sequências de código');

  await prisma.settings.upsert({
    where: { id: 'singleton' },
    create: {
      id: 'singleton',
      companyName: process.env.COMPANY_NAME ?? 'Air Charter Manager',
      contactEmail: process.env.COMPANY_EMAIL ?? 'operacoes@aircharter.com.br',
      timezone: process.env.TZ ?? 'America/Sao_Paulo',
      marginMinutes: 45,
      dueSoonDays: 15,
      documentRetentionDays: 365,
      notifyOnNewRequest: true,
    },
    // Não sobrescreve: quem alterou pela tela de Configurações mandou mais que
    // o seed.
    update: {},
  });

  const sequences = [
    { key: 'trip', prefix: 'VOO', current: 1000 },
    { key: 'request', prefix: 'SOL', current: 1000 },
    { key: 'charge', prefix: 'COB', current: 1000 },
  ];

  for (const seq of sequences) {
    await prisma.codeSequence.upsert({
      where: { key: seq.key },
      create: { ...seq, padding: 4 },
      // `current` NÃO é atualizado: regredir a numeração colidiria com códigos
      // já emitidos.
      update: { prefix: seq.prefix },
    });
  }
}

// ============================================================================
//  3. ADMINISTRADOR INICIAL
// ============================================================================

async function seedAdmin(roleIds: Map<RoleKey, string>): Promise<void> {
  console.log('· usuário administrador');

  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  // Sem senha padrão no código. Um `?? 'admin123'` aqui viraria a porta de
  // entrada de qualquer instalação que esquecesse de configurar o ambiente.
  if (!email || !password) {
    throw new Error(
      'ADMIN_EMAIL e ADMIN_PASSWORD são obrigatórios no ambiente para criar o administrador.',
    );
  }

  if (password.length < 10) {
    throw new Error('ADMIN_PASSWORD precisa de pelo menos 10 caracteres.');
  }

  const adminRoleId = roleIds.get('admin');
  if (adminRoleId === undefined) throw new Error('papel admin não foi criado');

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });

  if (existing) {
    // Já existe: só garante o papel. A senha NÃO é redefinida — rodar o seed
    // não pode desfazer a troca de senha de quem já usa o sistema.
    await prisma.user.update({ where: { email }, data: { roleId: adminRoleId } });
    console.log(`  ${email} (já existia — papel confirmado, senha preservada)`);
    return;
  }

  await prisma.user.create({
    data: {
      email,
      name: 'Administrador',
      passwordHash: await hash(password, ROUNDS),
      roleId: adminRoleId,
      // A senha vinda do ambiente é provisória por definição.
      mustChangePassword: true,
    },
  });

  console.log(`  ${email} (criado — troca de senha obrigatória no primeiro acesso)`);
}

// ============================================================================
//  MAIN
// ============================================================================

async function main(): Promise<void> {
  console.log('\nSeed do Air Charter Manager (estrutural)\n');

  const roleIds = await seedAuthorization();
  await seedSettings();
  await seedAdmin(roleIds);

  const [clients, aircraft, trips, charges] = await Promise.all([
    prisma.client.count(),
    prisma.aircraft.count(),
    prisma.trip.count(),
    prisma.charge.count(),
  ]);

  console.log('\nSeed concluído.');
  console.log(
    `Dados operacionais no banco: ${clients} clientes · ${aircraft} aeronaves · ` +
      `${trips} viagens · ${charges} cobranças.\n`,
  );
}

main()
  .catch((error: unknown) => {
    console.error('\nSeed falhou:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
