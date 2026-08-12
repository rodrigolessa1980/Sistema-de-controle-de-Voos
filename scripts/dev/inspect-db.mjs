// Inspeção somente-leitura do banco. Não altera nada.
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
try {
  const db = (await p.$queryRawUnsafe('SELECT DATABASE() AS db'))[0].db;
  const v = (await p.$queryRawUnsafe('SELECT VERSION() AS v'))[0].v;
  const rows = await p.$queryRawUnsafe(
    'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME',
  );
  console.log('banco  :', db);
  console.log('versao :', v);
  console.log('tabelas:', rows.length);
  for (const r of rows) console.log('  -', r.name);
} catch (e) {
  console.log('ERRO:', String(e.message).split('\n').filter(Boolean).slice(0, 3).join(' | '));
  process.exitCode = 1;
} finally {
  await p.$disconnect();
}
