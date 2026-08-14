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

      // ---- erros que o próprio Fastify já classificou
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

      /**
       * Qualquer outro 4xx do Fastify sai como 4xx, não como 500.
       *
       * Antes, só o 429 era reconhecido: `FST_ERR_CTP_INVALID_MEDIA_TYPE` (415),
       * `FST_ERR_CTP_EMPTY_JSON_BODY` (400) e o 413 de upload grande caíam no
       * ramo "desconhecido" e o cliente recebia **500 "Erro interno. A operação
       * foi registrada."** — uma mensagem que manda procurar defeito no servidor
       * quando quem errou foi a requisição. De quebra, cada um desses ia para o
       * log em nível `error`, misturando engano de cliente com incidente de
       * verdade e estragando qualquer alarme baseado em taxa de erro.
       *
       * O `code` do Fastify vai junto porque é ele que diz o que houve
       * (`FST_ERR_CTP_*`); a `message` dessas classes descreve a requisição, não
       * o interior do sistema, então pode ser repassada.
       *
       * Nível `warn`, não `error`: é sinal de cliente mal-comportado, e vale
       * enxergar sem virar incidente.
       */
      if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
        const code =
          typeof error === 'object' && error !== null && 'code' in error
            ? String(error.code)
            : 'BAD_REQUEST';

        request.log.warn({ err: error, statusCode }, 'requisição recusada pelo Fastify');

        void reply.status(statusCode).send({
          error: {
            code,
            message: error instanceof Error && error.message !== '' ? error.message : 'Requisição inválida.',
          },
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
