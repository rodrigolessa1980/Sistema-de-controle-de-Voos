/**
 * Change feed — o endpoint que o polling de 10 segundos consulta.
 *
 * Uma requisição a cada 10s por usuário, independente de quantas telas estejam
 * abertas. Se nada mudou, a resposta é `{ seq, reset: false, changes: [] }` —
 * dezenas de bytes, resolvidos por índice.
 *
 * Comparado com o caminho ingênuo (cada tela rebuscando sua lista a cada 10s),
 * isto troca N requisições com o dataset inteiro por 1 requisição com o delta.
 *
 * A rota é deliberadamente barata: nenhum JOIN, nenhum DTO, só `entity` + `id` +
 * `action`. Quem decide o que recarregar é o cache do frontend.
 */

import {
  CHANGE_ENTITIES,
  changesQuerySchema,
  changesResponseSchema,
  type ChangeEntity,
  type ChangesResponse,
} from '@acm/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { env } from '../env';
import { prisma } from '../lib/prisma';
import { isClientRole, requireAuth, requireUser } from '../plugins/rbac';

export async function changesRoutes(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.get(
    '/',
    {
      preValidation: requireAuth,
      schema: { querystring: changesQuerySchema, response: { 200: changesResponseSchema } },
      config: {
        // ~6 req/min é o esperado do polling; o teto dá folga para reconexão.
        rateLimit: { max: 30, timeWindow: '1 minute' },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const since = request.query.since;

      /**
       * Escopo de visibilidade.
       *
       * Cliente vê eventos sem escopo (mudança interna que afeta a todos) e os
       * do próprio `clientId`. Nunca os de outro cliente — senão o feed
       * revelaria, pela simples existência de um evento, que há atividade de
       * terceiros.
       */
      const scopeWhere = isClientRole(user)
        ? { OR: [{ clientScopeId: null }, { clientScopeId: user.clientId ?? '__never__' }] }
        : {};

      // Primeira chamada: devolve só o topo da sequência, sem histórico. Não faz
      // sentido mandar um delta para quem acabou de carregar tudo.
      if (since === undefined) {
        const latest = await prisma.changeFeed.findFirst({
          where: scopeWhere,
          select: { seq: true },
          orderBy: { seq: 'desc' },
        });

        const response: ChangesResponse = {
          seq: (latest?.seq ?? 0n).toString(),
          reset: false,
          changes: [],
        };
        return response;
      }

      const cursor = BigInt(since);

      /**
       * Cursor antigo demais.
       *
       * O feed é podado a cada hora (retenção de 24h). Se o cursor do cliente é
       * anterior ao evento mais antigo que ainda existe, houve um buraco: o
       * delta seria incompleto e daria a impressão falsa de estar em dia. Nesse
       * caso pedimos recarga total.
       */
      const oldest = await prisma.changeFeed.findFirst({
        select: { seq: true },
        orderBy: { seq: 'asc' },
      });

      if (oldest && cursor > 0n && cursor < oldest.seq - 1n) {
        const latest = await prisma.changeFeed.findFirst({
          select: { seq: true },
          orderBy: { seq: 'desc' },
        });

        const response: ChangesResponse = {
          seq: (latest?.seq ?? 0n).toString(),
          reset: true,
          changes: [],
        };
        return response;
      }

      const rows = await prisma.changeFeed.findMany({
        where: { seq: { gt: cursor }, ...scopeWhere },
        select: { seq: true, entity: true, entityId: true, action: true },
        orderBy: { seq: 'asc' },
        take: env.CHANGE_FEED_PAGE_SIZE,
      });

      const lastSeq = rows.at(-1)?.seq ?? cursor;

      /**
       * Deduplica por (entidade, id, ação).
       *
       * Dez pagamentos na mesma cobrança em 10 segundos geram dez eventos, mas o
       * frontend só precisa invalidar aquela cobrança uma vez.
       */
      const seen = new Set<string>();
      const changes: ChangesResponse['changes'] = [];

      // `entity` é VARCHAR no banco (o feed precisa aceitar entidades novas sem
      // migration), então a união só é reconstruída aqui, filtrando o que não
      // pertence ao contrato — um valor desconhecido é ignorado, não quebra o
      // polling de todo mundo.
      const known = new Set<string>(CHANGE_ENTITIES);

      for (const row of rows) {
        if (!known.has(row.entity)) continue;

        const key = `${row.entity}:${row.entityId}:${row.action}`;
        if (seen.has(key)) continue;
        seen.add(key);

        changes.push({
          entity: row.entity as ChangeEntity,
          entityId: row.entityId,
          action: row.action,
        });
      }

      const response: ChangesResponse = {
        seq: lastSeq.toString(),
        // Página cheia significa que pode ter mais: o cliente volta já com o
        // novo cursor, sem esperar os 10 segundos.
        reset: false,
        changes,
      };
      return response;
    },
  );
}
