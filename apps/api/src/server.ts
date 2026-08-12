/**
 * Ponto de entrada do backend.
 *
 * Responsável só por: subir a app, agendar os jobs e desligar com graça.
 * A montagem em si está em `app.ts`, para que os testes usem `app.inject()` sem
 * abrir porta.
 */

import { buildApp } from './app';
import { env } from './env';
import { startJobs } from './jobs';
import { disconnect, prisma } from './lib/prisma';

async function main(): Promise<void> {
  const app = await buildApp();

  // Falha rápido se o banco não responde: melhor o container não subir do que
  // subir e devolver 500 em toda requisição.
  try {
    await prisma.$queryRaw`SELECT 1`;
    app.log.info('conexão com o MySQL verificada');
  } catch (error) {
    app.log.fatal({ err: error }, 'não foi possível conectar ao banco de dados');
    process.exit(1);
  }

  const tasks = startJobs(app.log);

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    app.log.info({ signal }, 'encerrando');

    // Ordem importa: para de agendar, deixa as requisições em voo terminarem,
    // e só então fecha o pool do banco.
    for (const task of tasks) task.stop();

    try {
      await app.close();
      await disconnect();
      app.log.info('encerrado com sucesso');
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'falha ao encerrar');
      process.exit(1);
    }
  };

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }

  process.on('unhandledRejection', (reason) => {
    app.log.error({ err: reason }, 'promise rejeitada sem tratamento');
  });

  process.on('uncaughtException', (error) => {
    app.log.fatal({ err: error }, 'exceção não capturada');
    void shutdown('uncaughtException');
  });

  await app.listen({ port: env.PORT_BACKEND, host: '0.0.0.0' });
  app.log.info(
    { port: env.PORT_BACKEND, env: env.NODE_ENV, pollIntervalMs: env.POLL_INTERVAL_MS },
    'API no ar',
  );
}

void main();
