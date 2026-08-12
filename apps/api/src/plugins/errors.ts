/**
 * Handler global de erro.
 *
 * Regra: o cliente recebe `{ error: { code, message } }` e nada mais. Stack
 * trace, SQL e nome de coluna ficam no log do servidor. Um 500 nunca revela a
 * estrutura interna.
 */

import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';

import { isProduction } from '../env';
import { AppError } from '../lib/errors';
import { Prisma } from '../lib/prisma';

export const errorsPlugin = fp(
  function errorsPlugin(app: FastifyInstance, _opts: unknown, done: () => void) {
    app.setNotFoundHandler((request, reply) => {
      void reply.status(404).send({
        error: {
          code: 'NOT_FOUND',
          message: `Rota não encontrada: ${request.method} ${request.url}`,
        },
      });
    });

    app.setErrorHandler((error, request, reply) => {
      // ---- validação de entrada (Zod) -> 422 com o caminho de cada campo
      if (hasZodFastifySchemaValidationErrors(error)) {
        void reply.status(422).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Dados inválidos.',
            details: error.validation.map((issue) => ({
              path: issue.params.issue.path.join('.'),
              message: issue.params.issue.message,
            })),
          },
        });
        return;
      }

      // ---- serialização de saída: é bug nosso, não do cliente
      if (isResponseSerializationError(error)) {
        request.log.error(
          { err: error, route: error.method ? `${error.method} ${error.url}` : undefined },
          'resposta não bate com o schema declarado',
        );
        void reply.status(500).send({
          error: { code: 'INTERNAL', message: 'Erro interno ao montar a resposta.' },
        });
        return;
      }

      // ---- erros de domínio
      if (error instanceof AppError) {
        if (error.statusCode >= 500) request.log.error({ err: error }, error.message);
        else request.log.info({ code: error.code, msg: error.message }, 'erro de domínio');

        void reply.status(error.statusCode).send({
          error: {
            code: error.code,
            message: error.message,
            ...(error.details === undefined ? {} : { details: error.details }),
          },
        });
        return;
      }

      // ---- Prisma
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        request.log.warn({ err: error, code: error.code }, 'erro do Prisma');

        if (error.code === 'P2002') {
          const target = error.meta?.['target'];
          const field = Array.isArray(target)
            ? target.join(', ')
            : typeof target === 'string'
              ? target
              : 'campo';
          void reply.status(409).send({
            error: { code: 'CONFLICT', message: `Já existe um registro com este ${field}.` },
          });
          return;
        }

        if (error.code === 'P2025') {
          void reply.status(404).send({
            error: { code: 'NOT_FOUND', message: 'Registro não encontrado.' },
          });
          return;
        }

        if (error.code === 'P2003') {
          void reply.status(409).send({
            error: {
              code: 'CONFLICT',
              message: 'Existe outro registro vinculado a este. Remova o vínculo primeiro.',
            },
          });
          return;
        }
      }

      // ---- rate limit do @fastify/rate-limit
      // O erro chega como `unknown` sob `useUnknownInCatchVariables`; narrowing
      // explícito em vez de cast, para não presumir formato de erro alheio.
      const statusCode =
        typeof error === 'object' && error !== null && 'statusCode' in error
          ? error.statusCode
          : undefined;

      if (statusCode === 429) {
        void reply.status(429).send({
          error: { code: 'RATE_LIMITED', message: 'Muitas requisições. Tente em instantes.' },
        });
        return;
      }

      // ---- desconhecido
      request.log.error({ err: error }, 'erro não tratado');
      void reply.status(500).send({
        error: {
          code: 'INTERNAL',
          message: isProduction
            ? 'Erro interno. A operação foi registrada.'
            : error instanceof Error && error.message !== ''
              ? error.message
              : 'Erro interno.',
        },
      });
    });

    done();
  },
  { name: 'acm-errors' },
);
