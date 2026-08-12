/**
 * Cria o banco `aircharter` caso não exista.
 *
 * Idempotente (`IF NOT EXISTS`) e não toca em nenhum outro schema. Conecta em
 * `information_schema` porque `CREATE DATABASE` é comando de servidor, não de
 * banco — e o banco de destino ainda não existe.
 */
import { PrismaClient } from '@prisma/client';

const target = process.env.MYSQL_DATABASE ?? 'aircharter';
if (!/^[A-Za-z0-9_]+$/.test(target)) {
  console.error(`Nome de banco inválido: ${target}`);
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL ausente');
  process.exit(1);
}

const adminUrl = url.replace(/\/[^/?]+(\?|$)/, '/information_schema$1');
const prisma = new PrismaClient({ datasources: { db: { url: adminUrl } } });

try {
  const existing = await prisma.$queryRawUnsafe(
    'SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
    target,
  );

  if (existing.length > 0) {
    console.log(`banco "${target}" já existe — nada a fazer`);
  } else {
    await prisma.$executeRawUnsafe(
      `CREATE DATABASE \`${target}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    console.log(`banco "${target}" criado (utf8mb4 / utf8mb4_unicode_ci)`);
  }
} catch (e) {
  console.error('ERRO:', String(e.message).split('\n').filter(Boolean).slice(0, 4).join(' | '));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
