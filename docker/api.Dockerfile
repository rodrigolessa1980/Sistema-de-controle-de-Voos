# =============================================================================
#  API — Fastify + Prisma
#
#  Multi-stage: as dependências de build (typescript, tsx, devDeps) não entram
#  na imagem final. O runtime leva só `dist/`, os node_modules de produção e o
#  engine do Prisma.
# =============================================================================

# ---------------------------------------------------------------- 1. deps
FROM node:22-alpine AS deps
WORKDIR /app

# Só os manifestos primeiro: enquanto eles não mudam, esta camada vem do cache
# e o `npm ci` não roda de novo a cada alteração de código.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN npm ci --ignore-scripts

# ---------------------------------------------------------------- 2. build
FROM node:22-alpine AS build
WORKDIR /app

# Traz a árvore de dependências inteira do estágio anterior.
#
# Copiar só `/app/node_modules` não bastava: o npm decide sozinho o que hoista
# para a raiz e o que fica em `apps/*/node_modules`, e esse layout muda com a
# resolução de versões. Copiar `/app` inteiro é indiferente a essa decisão.
COPY --from=deps /app ./
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY prisma ./prisma

# O client do Prisma precisa existir antes do tsc: o código importa os tipos
# gerados a partir do schema.
RUN npx prisma generate --schema prisma/schema.prisma \
 && npm run build --workspace @acm/shared \
 && npm run build --workspace @acm/api

# Poda as devDependencies do node_modules que vai para a imagem final.
RUN npm prune --omit=dev

# ---------------------------------------------------------------- 3. runtime
FROM node:22-alpine AS runtime
WORKDIR /app

# `openssl` é exigido pelo engine do Prisma no Alpine; `wget` faz o healthcheck.
RUN apk add --no-cache openssl wget tini

ENV NODE_ENV=production
ENV TZ=America/Sao_Paulo
ENV PORT_BACKEND=1701

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/prisma ./prisma
COPY package.json ./
COPY docker/api-entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/entrypoint.sh \
 # Documentos de passageiro são gravados aqui; o volume é montado por cima.
 && mkdir -p /app/storage/documents \
 # Usuário não-root: se a aplicação for comprometida, o atacante não é root.
 && chown -R node:node /app

USER node

EXPOSE 1701

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:1701/api/health || exit 1

# `tini` como PID 1: sem ele, o Node não recebe SIGTERM corretamente e o
# encerramento gracioso (fechar conexões, parar os jobs) nunca acontece.
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "apps/api/dist/server.js"]
