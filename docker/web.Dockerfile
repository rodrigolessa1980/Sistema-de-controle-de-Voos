# =============================================================================
#  Web — React + Vite servido por nginx
#
#  O build gera estáticos; o runtime é só nginx. A imagem final não tem Node,
#  então não há superfície de execução de JavaScript no servidor web.
# =============================================================================

# ---------------------------------------------------------------- 1. deps
FROM node:22-alpine AS deps
WORKDIR /app

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
COPY apps/web ./apps/web

RUN npm run build --workspace @acm/web

# ---------------------------------------------------------------- 3. runtime
FROM nginx:1.27-alpine AS runtime

ENV TZ=America/Sao_Paulo

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
