#!/usr/bin/env bash
# ============================================================================
#  Cadastra os Secrets e Variables de Actions do projeto no repositório GitHub.
#
#  Equivalente POSIX de setup-github-secrets.ps1 (para Linux, macOS ou Git Bash).
#
#  Pré-requisitos:
#    1. gh CLI instalado  -> https://cli.github.com
#    2. gh auth login     (escopo `repo`)
#    3. Permissão de admin no repositório
#
#  Uso:
#    ./scripts/setup-github-secrets.sh
#    ENVIRONMENT=production ./scripts/setup-github-secrets.sh
#    DRY_RUN=1 ./scripts/setup-github-secrets.sh
#    ROTATE_APP_SECRETS=1 ./scripts/setup-github-secrets.sh
#
#  Nenhum valor de segredo é impresso. Os segredos da aplicação (JWT, cookie,
#  encryption) são gerados aqui e só existem no cofre do GitHub.
# ============================================================================
set -euo pipefail

REPO="${REPO:-rodrigolessa1980/Sistema-de-controle-de-Voos}"
ENV_FILE="${ENV_FILE:-$(dirname "$0")/../.env}"
ENVIRONMENT="${ENVIRONMENT:-}"
DRY_RUN="${DRY_RUN:-0}"
ROTATE_APP_SECRETS="${ROTATE_APP_SECRETS:-0}"

# ------------------------------------------------------------ pré-requisitos
command -v gh >/dev/null 2>&1 || {
  echo "erro: gh CLI não encontrado. Instale em https://cli.github.com" >&2
  exit 1
}

gh auth status >/dev/null || {
  echo "erro: gh não está autenticado. Rode: gh auth login" >&2
  exit 1
}

[ -f "$ENV_FILE" ] || {
  echo "erro: .env não encontrado em $ENV_FILE" >&2
  exit 1
}

echo "Repositório: $REPO"
[ -n "$ENVIRONMENT" ] && echo "Environment: $ENVIRONMENT"
echo

# ---------------------------------------------------------------- ler o .env
env_get() {
  local key="$1" fallback="${2-}"
  local val
  val="$(sed -n "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*\(.*\)$/\1/p" "$ENV_FILE" | tail -n1)"
  val="${val%\"}"; val="${val#\"}"
  val="${val%\'}"; val="${val#\'}"
  val="$(printf '%s' "$val" | sed -e 's/[[:space:]]*$//')"
  if [ -z "$val" ]; then
    if [ $# -ge 2 ]; then printf '%s' "$fallback"; return 0; fi
    echo "erro: variável '$key' ausente ou vazia no .env" >&2
    exit 1
  fi
  printf '%s' "$val"
}

MYSQL_HOST="$(env_get MYSQL_HOST)"
MYSQL_PORT="$(env_get MYSQL_PORT 3306)"
MYSQL_USER="$(env_get MYSQL_USER)"
MYSQL_PASSWORD="$(env_get MYSQL_PASSWORD)"
MYSQL_DATABASE="$(env_get MYSQL_DATABASE)"

SERVER_HOST="$(env_get SERVER_HOST)"
SERVER_USER="$(env_get SERVER_USER)"
SERVER_PASSWORD="$(env_get SERVER_PASSWORD)"

PORT_FRONTEND="$(env_get porta_frontend 1700)"
PORT_BACKEND="$(env_get porta_backend 1701)"

# Provedor de e-mail: obrigatório para o aviso de nova solicitação (PLANO.md §13).
# Enquanto não houver provedor contratado, MAIL_API_KEY fica vazia e o secret
# não é cadastrado.
MAIL_API_KEY="$(env_get MAIL_API_KEY '')"
MAIL_PROVIDER="$(env_get MAIL_PROVIDER 'resend')"
MAIL_FROM="$(env_get MAIL_FROM '')"
MAIL_FROM_NAME="$(env_get MAIL_FROM_NAME 'Air Charter Manager')"
MAIL_REPLY_TO="$(env_get MAIL_REPLY_TO '')"

# ------------------------------------------------------- montar a DATABASE_URL
# Percent-encode: '@', ':', '/', '#' e '?' quebram a URL de conexão do Prisma.
urlencode() {
  local s="$1" out='' c
  for (( i = 0; i < ${#s}; i++ )); do
    c="${s:i:1}"
    case "$c" in
      [a-zA-Z0-9.~_-]) out+="$c" ;;
      *) out+="$(printf '%%%02X' "'$c")" ;;
    esac
  done
  printf '%s' "$out"
}

DATABASE_URL="mysql://$(urlencode "$MYSQL_USER"):$(urlencode "$MYSQL_PASSWORD")@${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_DATABASE}?connection_limit=10&pool_timeout=20&connect_timeout=10"

# ---------------------------------------------- gerar os segredos da aplicação
rand_urlsafe() { openssl rand -base64 "$1" | tr '+/' '-_' | tr -d '=\n'; }
rand_hex()     { openssl rand -hex "$1" | tr -d '\n'; }

JWT_ACCESS_SECRET="$(rand_urlsafe 48)"
JWT_REFRESH_SECRET="$(rand_urlsafe 48)"
COOKIE_SECRET="$(rand_urlsafe 32)"
ENCRYPTION_KEY="$(rand_hex 32)"

# ------------------------------------------------------------------- envio
GH_SCOPE=()
[ -n "$ENVIRONMENT" ] && GH_SCOPE=(--env "$ENVIRONMENT")

EXISTING="$(gh secret list --repo "$REPO" "${GH_SCOPE[@]}" --json name -q '.[].name' 2>/dev/null || true)"

# Trocar estes invalida todas as sessões ativas.
APP_SECRETS=" JWT_ACCESS_SECRET JWT_REFRESH_SECRET COOKIE_SECRET ENCRYPTION_KEY "

set_secret() {
  local name="$1" value="$2"

  if [[ "$APP_SECRETS" == *" $name "* ]] \
     && printf '%s\n' "$EXISTING" | grep -qx "$name" \
     && [ "$ROTATE_APP_SECRETS" != "1" ]; then
    echo "  = $name (já existe, preservado)"
    return 0
  fi

  if [ "$DRY_RUN" = "1" ]; then
    echo "  ~ $name (dry-run)"
    return 0
  fi

  printf '%s' "$value" | gh secret set "$name" --repo "$REPO" "${GH_SCOPE[@]}" >/dev/null
  echo "  + $name"
}

set_variable() {
  local name="$1" value="$2"
  if [ "$DRY_RUN" = "1" ]; then
    echo "  ~ $name = $value (dry-run)"
    return 0
  fi
  gh variable set "$name" --repo "$REPO" "${GH_SCOPE[@]}" --body "$value" >/dev/null
  echo "  + $name = $value"
}

echo "Secrets:"
set_secret MYSQL_HOST         "$MYSQL_HOST"
set_secret MYSQL_PORT         "$MYSQL_PORT"
set_secret MYSQL_USER         "$MYSQL_USER"
set_secret MYSQL_PASSWORD     "$MYSQL_PASSWORD"
set_secret MYSQL_DATABASE     "$MYSQL_DATABASE"
set_secret DATABASE_URL       "$DATABASE_URL"
set_secret SERVER_HOST        "$SERVER_HOST"
set_secret SERVER_USER        "$SERVER_USER"
set_secret SERVER_PASSWORD    "$SERVER_PASSWORD"
set_secret JWT_ACCESS_SECRET  "$JWT_ACCESS_SECRET"
set_secret JWT_REFRESH_SECRET "$JWT_REFRESH_SECRET"
set_secret COOKIE_SECRET      "$COOKIE_SECRET"
set_secret ENCRYPTION_KEY     "$ENCRYPTION_KEY"

if [ -n "$MAIL_API_KEY" ]; then
  set_secret MAIL_API_KEY "$MAIL_API_KEY"
else
  echo "  ! MAIL_API_KEY vazia no .env: provedor de e-mail ainda não definido."
  echo "    O aviso de nova solicitação depende dela. Ver docs/PLANO.md §13.3."
fi

echo
echo "Variables:"
set_variable PORT_FRONTEND    "$PORT_FRONTEND"
set_variable PORT_BACKEND     "$PORT_BACKEND"
set_variable SERVER_APP_DIR   "/opt/aircharter"
set_variable POLL_INTERVAL_MS "10000"
set_variable TZ               "America/Sao_Paulo"
set_variable NODE_ENV         "production"
set_variable MAIL_PROVIDER    "$MAIL_PROVIDER"
set_variable MAIL_FROM_NAME   "$MAIL_FROM_NAME"

# Endereços só entram se preenchidos. `if` explícito em vez de `[ ... ] && cmd`:
# sob `set -e`, um AND-OR list que falha na última linha do script faria o script
# sair com código 1 sem nenhum erro real ter ocorrido.
if [ -n "$MAIL_FROM" ]; then
  set_variable MAIL_FROM "$MAIL_FROM"
fi
if [ -n "$MAIL_REPLY_TO" ]; then
  set_variable MAIL_REPLY_TO "$MAIL_REPLY_TO"
fi

echo
echo "Confira em: https://github.com/$REPO/settings/secrets/actions"
echo
echo "Lembrete de segurança: a senha do MySQL e a senha de root do servidor são"
echo "a MESMA hoje. Rotacione as duas e use um usuário de deploy não-root."
