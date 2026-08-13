/**
 * Montagem da aplicação Fastify.
 *
 * Separado de `server.ts` para que os testes possam construir a app e usar
 * `app.inject()` sem abrir porta de rede.
 */

import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import { env, isProduction, isTest } from './env';
import { prisma } from './lib/prisma';
import { errorsPlugin } from './plugins/errors';
import { rbacPlugin } from './plugins/rbac';

import { aircraftRoutes } from './modules/aircraft';
import { authRoutes } from './modules/auth';
import { availabilityRoutes } from './modules/availability';
import { changesRoutes } from './modules/changes';
import { chargeRoutes } from './modules/charge';
import { clientRoutes } from './modules/client';
import { dashboardRoutes } from './modules/dashboard';
import { documentRoutes } from './modules/document';
import { notificationRoutes } from './modules/notification';
import { chargePaymentRoutes, paymentRoutes } from './modules/payment';
import { reportRoutes } from './modules/report';
import { requestRoutes } from './modules/request';
import { settingsRoutes } from './modules/settings';
import { tariffRoutes } from './modules/tariff';
import { tripRoutes } from './modules/trip';
import { userRoutes } from './modules/user';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: isTest
      ? false
      : {
          level: env.LOG_LEVEL,
          ...(isProduction
            ? {}
            : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }),
          // Nunca logar credencial nem token, mesmo em debug.
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body.password',
              'req.body.currentPassword',
              'req.body.newPassword',
              'res.headers["set-cookie"]',
            ],
            censor: '[REDACTED]',
          },
        },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
    disableRequestLogging: isTest,
  }).withTypeProvider<ZodTypeProvider>();

  // Zod como validador e serializador de todas as rotas.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(errorsPlugin);

  await app.register(cors, {
    origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : [env.WEB_BASE_URL],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(cookie, { secret: env.COOKIE_SECRET });

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    // Por usuário quando autenticado; por IP quando não.
    keyGenerator: (request) => request.user?.id ?? request.ip,
    // O polling de 10s são ~6 req/min por usuário; o teto global cobre com folga.
    //
    // Na suíte de integração o limite é desligado: dezenas de logins em
    // segundos são o comportamento normal de um teste, não força bruta, e o
    // 429 mascararia o que cada caso realmente quer verificar. O limite em si é
    // testado à parte, com a app construída fora do modo de teste.
    allowList: () => isTest,
  });

  await app.register(multipart, {
    limits: { fileSize: env.UPLOAD_MAX_BYTES, files: 1, fields: 10 },
  });

  await app.register(rbacPlugin);

  // ------------------------------------------------------------------- saúde
  app.get('/api/health', async () => ({ status: 'ok', uptime: Math.round(process.uptime()) }));

  app.get('/api/ready', async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ready' };
    } catch {
      void reply.status(503);
      return { status: 'unavailable' };
    }
  });

  // ------------------------------------------------------------------- rotas
  await app.register(
    async (api) => {
      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(aircraftRoutes, { prefix: '/aircraft' });
      await api.register(tariffRoutes, { prefix: '/tariffs' });
      await api.register(clientRoutes, { prefix: '/clients' });
      await api.register(tripRoutes, { prefix: '/trips' });
      await api.register(requestRoutes, { prefix: '/requests' });
      await api.register(chargeRoutes, { prefix: '/charges' });
      // Pagamento e baixa moram sob /charges/:id — o recurso pai é a cobrança —
      // mas exigem permissões que o operacional não tem.
      await api.register(chargePaymentRoutes, { prefix: '/charges' });
      await api.register(paymentRoutes, { prefix: '/payments' });
      await api.register(availabilityRoutes, { prefix: '/availability' });
      await api.register(dashboardRoutes, { prefix: '/dashboard' });
      await api.register(reportRoutes, { prefix: '/reports' });
      await api.register(documentRoutes, { prefix: '/documents' });
      await api.register(notificationRoutes, { prefix: '/notifications' });
      await api.register(settingsRoutes, { prefix: '/settings' });
      await api.register(userRoutes, { prefix: '/users' });
      await api.register(changesRoutes, { prefix: '/changes' });
    },
    { prefix: '/api' },
  );

  return app;
}
