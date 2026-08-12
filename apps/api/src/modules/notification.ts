/**
 * Notificações — dá função ao sino que no protótipo era só decorativo
 * (`Header` tinha o ícone e o pontinho vermelho fixo).
 *
 * É o "aviso no sistema" que o Rodrigo pediu junto com o e-mail
 * (docs/PLANO.md §13).
 */

import { idParamSchema, notificationListSchema, okSchema } from '@acm/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '../lib/prisma';
import { requireAuth, requireUser } from '../plugins/rbac';

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.get(
    '/',
    {
      preValidation: requireAuth,
      schema: {
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(50).default(20),
          unreadOnly: z.coerce.boolean().default(false),
        }),
        response: { 200: notificationListSchema },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { limit, unreadOnly } = request.query;

      // A notificação é sempre do próprio usuário — não há rota que leia a de
      // outro, para nenhum perfil.
      const [items, unread] = await Promise.all([
        prisma.notification.findMany({
          where: { userId: user.id, ...(unreadOnly ? { readAt: null } : {}) },
          select: {
            id: true,
            type: true,
            title: true,
            body: true,
            entity: true,
            entityId: true,
            readAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
        prisma.notification.count({ where: { userId: user.id, readAt: null } }),
      ]);

      return {
        items: items.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          entity: n.entity,
          entityId: n.entityId,
          readAt: n.readAt === null ? null : n.readAt.toISOString(),
          createdAt: n.createdAt.toISOString(),
        })),
        unread,
      };
    },
  );

  route.post(
    '/:id/read',
    { preValidation: requireAuth, schema: { params: idParamSchema, response: { 200: okSchema } } },
    async (request) => {
      const user = requireUser(request);

      // `updateMany` com o userId no where: ler a notificação de outro usuário
      // simplesmente não afeta nenhuma linha, sem precisar de checagem extra.
      await prisma.notification.updateMany({
        where: { id: request.params.id, userId: user.id, readAt: null },
        data: { readAt: new Date() },
      });

      return { ok: true } as const;
    },
  );

  route.post(
    '/read-all',
    { preValidation: requireAuth, schema: { response: { 200: okSchema } } },
    async (request) => {
      const user = requireUser(request);
      await prisma.notification.updateMany({
        where: { userId: user.id, readAt: null },
        data: { readAt: new Date() },
      });
      return { ok: true } as const;
    },
  );
}
