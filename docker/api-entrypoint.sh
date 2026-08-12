#!/bin/sh
# =============================================================================
#  Entrypoint da API.
#
#  Aplica as migrations ANTES de subir o servidor. Se a migration falhar, o
#  container morre e o deploy falha — que é o comportamento desejado: subir a
#  aplicação com o schema desatualizado produz erro em runtime, mais difícil de
#  diagnosticar do que um deploy que não completa.
# =============================================================================
set -eu

echo "[entrypoint] aplicando migrations..."
npx prisma migrate deploy --schema prisma/schema.prisma

echo "[entrypoint] migrations aplicadas; iniciando a API"
exec "$@"
