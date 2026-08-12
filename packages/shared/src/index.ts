/**
 * `@acm/shared` — o que API e web têm em comum.
 *
 * Regra do pacote: nada aqui pode importar `@prisma/client`, `fastify`, `react`
 * ou qualquer API de plataforma. É código puro, roda nos dois lados, e é o que
 * garante que backend e frontend não divirjam nas regras de negócio.
 */

export * as Money from './money';

export * from './contracts';
export * from './dates';
export * from './domain';
export * from './enums';
export * from './labels';
export * from './permissions';
