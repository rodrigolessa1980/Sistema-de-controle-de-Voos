/**
 * APAGA TODOS OS DADOS OPERACIONAIS do banco.
 *
 *   node scripts/purge-operational-data.mjs --confirm
 *
 * Remove: clientes, aeronaves, tarifas, viagens, solicitações, passageiros,
 * documentos, cobranças, pagamentos, bloqueios, notificações, fila de e-mail,
 * change feed, auditoria, sessões e todos os usuários que NÃO são o admin.
 *
 * Preserva: papéis, permissões, configurações, sequências de código e o usuário
 * de `ADMIN_EMAIL`.
 *
 * Serve para limpar o banco dos dados de demonstração que o seed antigo
 * carregava. É irreversível: exige `--confirm` e imprime o que vai apagar antes
 * de tocar em qualquer coisa.
 */

import { PrismaClient } from '@prisma/client';
import { createInterface } from 'node:readline/promises';

const CONFIRMED = process.argv.includes('--confirm');
const FORCE = process.argv.includes('--force');

const prisma = new PrismaClient();

/**
 * Ordem importa: filho antes de pai, senão a foreign key barra o delete.
 * `passengers` referencia trips e requests; `payments` referencia charges;
 * `charges` referencia trips e clients.
 */
const TABLES = [
  ['passenger', () => prisma.passenger.deleteMany()],
  ['payment', () => prisma.payment.deleteMany()],
  ['charge', () => prisma.charge.deleteMany()],
  ['flightRequest', () => prisma.flightRequest.deleteMany()],
  ['trip', () => prisma.trip.deleteMany()],
  ['aircraftBlock', () => prisma.aircraftBlock.deleteMany()],
  ['tariff', () => prisma.tariff.deleteMany()],
  ['documentFile', () => prisma.documentFile.deleteMany()],
  ['aircraft', () => prisma.aircraft.deleteMany()],
  ['notification', () => prisma.notification.deleteMany()],
  ['emailOutbox', () => prisma.emailOutbox.deleteMany()],
  ['changeFeed', () => prisma.changeFeed.deleteMany()],
  ['auditLog', () => prisma.auditLog.deleteMany()],
  ['refreshToken', () => prisma.refreshToken.deleteMany()],
];

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    console.error('ADMIN_EMAIL não definido — não sei qual usuário preservar. Abortando.');
    process.exitCode = 1;
    return;
  }

  const database = (await prisma.$queryRawUnsafe('SELECT DATABASE() AS db'))[0].db;

  // Inventário ANTES: sem isso ninguém sabe o que a operação vai destruir.
  const before = {
    clientes: await prisma.client.count(),
    aeronaves: await prisma.aircraft.count(),
    tarifas: await prisma.tariff.count(),
    viagens: await prisma.trip.count(),
    solicitacoes: await prisma.flightRequest.count(),
    cobrancas: await prisma.charge.count(),
    pagamentos: await prisma.payment.count(),
    bloqueios: await prisma.aircraftBlock.count(),
    passageiros: await prisma.passenger.count(),
    documentos: await prisma.documentFile.count(),
    notificacoes: await prisma.notification.count(),
    filaEmail: await prisma.emailOutbox.count(),
    changeFeed: await prisma.changeFeed.count(),
    auditoria: await prisma.auditLog.count(),
  };

  const outrosUsuarios = await prisma.user.findMany({
    where: { email: { not: adminEmail } },
    select: { email: true },
  });

  const total = Object.values(before).reduce((a, b) => a + b, 0) + outrosUsuarios.length;

  console.log(`\nBanco: ${database}`);
  console.log('\nSerá APAGADO:');
  for (const [nome, qtd] of Object.entries(before)) {
    if (qtd > 0) console.log(`  ${String(qtd).padStart(5)}  ${nome}`);
  }
  for (const u of outrosUsuarios) console.log(`      1  usuário ${u.email}`);

  console.log('\nSerá PRESERVADO:');
  console.log(`  ${String(await prisma.role.count()).padStart(5)}  papéis`);
  console.log(`  ${String(await prisma.permission.count()).padStart(5)}  permissões`);
  console.log(`  ${String(await prisma.settings.count()).padStart(5)}  configurações`);
  console.log(`  ${String(await prisma.codeSequence.count()).padStart(5)}  sequências de código`);
  console.log(`      1  usuário ${adminEmail} (admin)`);

  if (total === 0) {
    console.log('\nNada a apagar — o banco já está limpo.\n');
    return;
  }

  if (!CONFIRMED) {
    console.log('\nNada foi apagado. Para executar de verdade:');
    console.log('  node scripts/purge-operational-data.mjs --confirm\n');
    return;
  }

  // Segunda barreira em terminal interativo: `--confirm` sozinho é fácil demais
  // de repetir do histórico do shell.
  if (!FORCE && process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`\nDigite o nome do banco (${database}) para confirmar: `);
    rl.close();
    if (answer.trim() !== database) {
      console.log('Nome não confere. Nada foi apagado.\n');
      return;
    }
  }

  console.log('\nApagando...');
  for (const [nome, fn] of TABLES) {
    const { count } = await fn();
    if (count > 0) console.log(`  ${String(count).padStart(5)}  ${nome}`);
  }

  const { count: usuariosRemovidos } = await prisma.user.deleteMany({
    where: { email: { not: adminEmail } },
  });
  if (usuariosRemovidos > 0) console.log(`  ${String(usuariosRemovidos).padStart(5)}  usuários`);

  // Clientes por ÚLTIMO: `users.client_id` tem foreign key para cá, então
  // enquanto existir um usuário de portal apontando para o cliente, o delete é
  // barrado. Por isso não entra na lista `TABLES` acima.
  const { count: clientesRemovidos } = await prisma.client.deleteMany();
  if (clientesRemovidos > 0) console.log(`  ${String(clientesRemovidos).padStart(5)}  clientes`);

  // Sequências voltam ao início: sem dado, não há código emitido para colidir.
  await prisma.codeSequence.updateMany({ data: { current: 1000 } });
  console.log('        sequências de código reiniciadas em 1000');

  const depois = {
    clientes: await prisma.client.count(),
    aeronaves: await prisma.aircraft.count(),
    viagens: await prisma.trip.count(),
    cobrancas: await prisma.charge.count(),
    usuarios: await prisma.user.count(),
  };

  console.log('\nEstado final:');
  for (const [nome, qtd] of Object.entries(depois)) {
    console.log(`  ${String(qtd).padStart(5)}  ${nome}`);
  }
  console.log('\nBanco limpo. Só dados estruturais e o administrador.\n');
}

main()
  .catch((e) => {
    console.error('\nFalhou:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
