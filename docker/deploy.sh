#!/usr/bin/env bash
# =============================================================================
#  Deploy BLUE-GREEN — roda no servidor, em SERVER_APP_DIR.
#
#    deploy.sh deploy <tag>   sobe <tag> na vaga parada, testa e troca
#    deploy.sh rollback       volta para a versão anterior (se ainda existir)
#    deploy.sh status         mostra a vaga ativa e as tags
#
#  Garantia principal: a versão no ar SÓ é tocada depois que a nova passou em
#  todos os testes. Qualquer falha antes da troca derruba apenas a vaga nova e
#  o script sai com erro — os usuários nem percebem.
#
#  Sequência do `deploy`:
#    1. baixa as imagens da tag nova;
#    2. sobe api-<vaga parada> (as migrations rodam no entrypoint) e espera
#       ficar saudável;
#    3. sobe web-<vaga parada> e espera ficar saudável;
#    4. testa a vaga nova por dentro, ponta a ponta: versão servida, /api pelo
#       proxy da vaga, banco, e — se SMOKE_EMAIL/SMOKE_PASSWORD estiverem
#       definidos — login e leitura de rotas autenticadas;
#    5. troca a borda para a vaga nova (`nginx -s reload`, sem derrubar
#       conexão) e confirma pela borda que a versão nova é a servida;
#    6. espera as requisições da vaga antiga terminarem e PARA (não remove)
#       a vaga antiga — ela fica pronta para o `rollback`.
#
#  Variáveis de ambiente:
#    IMAGE_API, IMAGE_WEB   repositório das imagens (obrigatório no deploy)
#    SMOKE_EMAIL, SMOKE_PASSWORD   conta para o teste de login (opcional)
#    HEALTH_TIMEOUT   segundos esperando cada container (padrão 300)
#    DRAIN_SECONDS    segundos antes de parar a vaga antiga (padrão 30)
# =============================================================================
set -euo pipefail

APP_DIR=${APP_DIR:-$(cd "$(dirname "$0")" && pwd)}
cd "$APP_DIR"

STATE_DIR=edge/state
ACTIVE_FILE=$STATE_DIR/active-slot
PREVIOUS_FILE=$STATE_DIR/previous-slot
SLOT_CONF=$STATE_DIR/active-slot.conf
HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-300}
DRAIN_SECONDS=${DRAIN_SECONDS:-30}

# Nomes do deploy antigo (compose sem blue-green). Só existem até a primeira
# execução deste script, que faz a passagem de bastão.
LEGACY_CONTAINERS=(aircharter-web aircharter-api)

COMPOSE=(docker compose --env-file slots.env -f compose.prod.yml)

log() { printf '[deploy] %s\n' "$*"; }
fail() {
  printf '[deploy] ERRO: %s\n' "$*" >&2
  exit 1
}

other_slot() { if [ "$1" = blue ]; then echo green; else echo blue; fi; }
active_slot() { cat "$ACTIVE_FILE" 2>/dev/null || true; }
upper() { printf '%s' "$1" | tr '[:lower:]' '[:upper:]'; }

# ------------------------------------------------------------- slots.env
set_var() {
  local key=$1 value=$2
  touch slots.env
  if grep -q "^${key}=" slots.env; then
    sed -i "s|^${key}=.*|${key}=${value}|" slots.env
  else
    printf '%s=%s\n' "$key" "$value" >>slots.env
  fi
}
get_var() { grep "^$1=" slots.env 2>/dev/null | tail -n 1 | cut -d= -f2- || true; }

# ------------------------------------------------------------- containers
container_exists() { docker inspect "$1" >/dev/null 2>&1; }

wait_healthy() {
  local container=$1 waited=0 status restarts baseline
  # Reinícios de antes desta espera (um container parado guarda os antigos).
  baseline=$(docker inspect -f '{{.RestartCount}}' "$container" 2>/dev/null || echo 0)
  while :; do
    status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || echo ausente)
    restarts=$(docker inspect -f '{{.RestartCount}}' "$container" 2>/dev/null || echo 0)

    if [ "$status" = healthy ]; then
      log "$container saudável (${waited}s)."
      return 0
    fi
    # Reiniciou sozinho = o processo morreu (migration falhou, env inválido...).
    # Esperar o timeout só atrasaria o diagnóstico.
    if [ "$status" = unhealthy ] || [ "$restarts" -gt "$baseline" ] || [ "$status" = ausente ]; then
      break
    fi
    if [ "$waited" -ge "$HEALTH_TIMEOUT" ]; then
      status="$status (timeout de ${HEALTH_TIMEOUT}s)"
      break
    fi
    sleep 5
    waited=$((waited + 5))
  done

  log "$container NÃO ficou saudável — status: $status, reinícios: $restarts."
  log "Últimas linhas do log de $container:"
  docker logs --tail 80 "$container" 2>&1 | sed 's/^/    /' >&2 || true
  return 1
}

stop_slot() {
  "${COMPOSE[@]}" stop "api-$1" "web-$1" >/dev/null 2>&1 || true
}

# ------------------------------------------------------------- teste da vaga
# Tudo roda DENTRO do container web da vaga: as vagas não têm porta pública, e
# passar pelo nginx dela testa também o proxy /api -> api-<vaga>.
in_web() {
  local slot=$1
  shift
  docker exec "aircharter-web-$slot" "$@"
}

json_escape() {
  local s=${1//\\/\\\\}
  s=${s//\"/\\\"}
  printf '%s' "$s"
}

smoke_test() {
  local slot=$1 tag=$2 out

  out=$(in_web "$slot" wget -qO- -T 10 http://127.0.0.1/version.json) ||
    { log "version.json não respondeu."; return 1; }
  [[ "$out" == *"\"$tag\""* ]] ||
    { log "version.json serve '$out', esperado '$tag'."; return 1; }

  out=$(in_web "$slot" wget -qO- -T 10 http://127.0.0.1/api/health) ||
    { log "/api/health não respondeu pelo proxy da vaga."; return 1; }
  [[ "$out" == *"\"$tag\""* ]] ||
    { log "/api/health responde '$out', esperado versão '$tag'."; return 1; }

  in_web "$slot" wget -qO- -T 10 http://127.0.0.1/api/ready >/dev/null ||
    { log "/api/ready falhou: a API não alcança o banco."; return 1; }

  out=$(in_web "$slot" wget -qO- -T 10 http://127.0.0.1/) ||
    { log "A página inicial não respondeu."; return 1; }
  [[ "$out" == *'id="root"'* ]] ||
    { log "A página inicial não é o app."; return 1; }

  if [ -z "${SMOKE_EMAIL:-}" ] || [ -z "${SMOKE_PASSWORD:-}" ]; then
    log "AVISO: SMOKE_EMAIL/SMOKE_PASSWORD não definidos — teste de login pulado."
    log "       Sem ele, um erro que só aparece com usuário logado passa despercebido."
    return 0
  fi

  # O corpo vai por stdin, nunca na linha de comando: a senha não aparece em
  # `ps` no servidor nem no container.
  local body token
  body=$(printf '{"email":"%s","password":"%s"}' \
    "$(json_escape "$SMOKE_EMAIL")" "$(json_escape "$SMOKE_PASSWORD")")
  out=$(printf '%s' "$body" | docker exec -i "aircharter-web-$slot" sh -c \
    'cat > /tmp/smoke.json; wget -qO- -T 15 --header "Content-Type: application/json" --post-file /tmp/smoke.json http://127.0.0.1/api/auth/login; rc=$?; rm -f /tmp/smoke.json; exit $rc') ||
    { log "Login de teste falhou."; return 1; }

  token=$(printf '%s' "$out" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
  [ -n "$token" ] || { log "Login de teste não devolveu accessToken."; return 1; }

  local route
  for route in /api/auth/me /api/notifications /api/changes; do
    TOKEN=$token docker exec -e TOKEN "aircharter-web-$slot" sh -c \
      "wget -qO- -T 15 --header \"Authorization: Bearer \$TOKEN\" http://127.0.0.1$route >/dev/null" ||
      { log "Rota autenticada $route falhou."; return 1; }
  done

  log "Login de teste e rotas autenticadas OK."
}

# ------------------------------------------------------------- troca
ensure_edge() {
  mkdir -p "$STATE_DIR"
  if ! container_exists aircharter-edge || [ "$(docker inspect -f '{{.State.Running}}' aircharter-edge)" != true ]; then
    "${COMPOSE[@]}" up -d --no-deps edge
    sleep 2
  fi
}

switch_to() {
  local slot=$1 tag=$2 previous_conf=""

  mkdir -p "$STATE_DIR"
  [ -f "$SLOT_CONF" ] && previous_conf=$(cat "$SLOT_CONF")

  # Arquivo novo + mv: troca atômica, a borda nunca lê um arquivo pela metade.
  printf 'set $slot %s;\n' "$slot" >"$SLOT_CONF.tmp"
  mv -f "$SLOT_CONF.tmp" "$SLOT_CONF"

  ensure_edge

  if ! docker exec aircharter-edge nginx -t -q; then
    if [ -n "$previous_conf" ]; then printf '%s\n' "$previous_conf" >"$SLOT_CONF"; fi
    fail "Configuração da borda inválida — troca cancelada."
  fi
  docker exec aircharter-edge nginx -s reload

  # Confirma PELA BORDA, que é o caminho do usuário.
  local i out=""
  for i in $(seq 1 10); do
    out=$(docker exec aircharter-edge wget -qO- -T 5 http://127.0.0.1/version.json 2>/dev/null || true)
    if [[ "$out" == *"\"$tag\""* ]]; then
      log "Borda servindo $tag pela vaga $slot."
      printf '%s\n' "$slot" >"$ACTIVE_FILE"
      return 0
    fi
    sleep 1
  done
  fail "A borda não passou a servir $tag (resposta: '$out')."
}

# Primeira execução: o deploy antigo ocupa as portas 1700/1701. A vaga nova já
# foi testada; aqui os containers antigos saem e a borda assume as portas.
# É o único momento com interrupção — alguns segundos, uma vez só.
handover_legacy() {
  local c found=0
  for c in "${LEGACY_CONTAINERS[@]}"; do container_exists "$c" && found=1; done
  [ "$found" -eq 1 ] || return 0

  log "Passagem de bastão: removendo o deploy antigo (sem blue-green)."
  for c in "${LEGACY_CONTAINERS[@]}"; do
    if container_exists "$c"; then
      docker stop "$c" >/dev/null
      docker rm "$c" >/dev/null
    fi
  done
}

# ------------------------------------------------------------- comandos
cmd_deploy() {
  local tag=${1:-}
  [ -n "$tag" ] || fail "uso: deploy.sh deploy <tag>"
  [ -n "${IMAGE_API:-}" ] && [ -n "${IMAGE_WEB:-}" ] || fail "IMAGE_API e IMAGE_WEB são obrigatórios."

  set_var IMAGE_API "$IMAGE_API"
  set_var IMAGE_WEB "$IMAGE_WEB"

  local active target target_var
  active=$(active_slot)
  if [ -n "$active" ]; then target=$(other_slot "$active"); else target=blue; fi
  target_var="TAG_$(upper "$target")"

  log "Vaga no ar: ${active:-nenhuma}. Versão $tag vai para a vaga $target."

  if [ -n "$active" ] && [ "$(get_var "TAG_$(upper "$active")")" = "$tag" ]; then
    log "A versão $tag já está no ar na vaga $active. Nada a fazer."
    return 0
  fi

  set_var "$target_var" "$tag"

  "${COMPOSE[@]}" pull "api-$target" "web-$target"

  # --force-recreate: a vaga parada ainda guarda o container da versão
  # anterior; ele precisa ser recriado com a imagem nova.
  "${COMPOSE[@]}" up -d --no-deps --force-recreate "api-$target"
  if ! wait_healthy "aircharter-api-$target"; then
    stop_slot "$target"
    rm -f "$PREVIOUS_FILE"
    fail "A API nova não subiu. A versão no ar NÃO foi alterada."
  fi

  "${COMPOSE[@]}" up -d --no-deps --force-recreate "web-$target"
  if ! wait_healthy "aircharter-web-$target"; then
    stop_slot "$target"
    rm -f "$PREVIOUS_FILE"
    fail "O frontend novo não subiu. A versão no ar NÃO foi alterada."
  fi

  log "Testando a vaga $target antes de colocá-la no ar..."
  if ! smoke_test "$target" "$tag"; then
    stop_slot "$target"
    rm -f "$PREVIOUS_FILE"
    fail "A versão nova falhou nos testes. A versão no ar NÃO foi alterada."
  fi

  handover_legacy
  switch_to "$target" "$tag"

  if [ -n "$active" ]; then
    printf '%s\n' "$active" >"$PREVIOUS_FILE"
    log "Aguardando ${DRAIN_SECONDS}s para as requisições da vaga $active terminarem..."
    sleep "$DRAIN_SECONDS"
    stop_slot "$active"
    log "Vaga $active parada (guardada para rollback)."
  fi

  # Remove só imagens sem uso; a da vaga parada continua referenciada.
  docker image prune -f --filter "until=168h" >/dev/null || true

  log "Deploy concluído: $tag no ar pela vaga $target."
}

cmd_rollback() {
  local current previous tag
  current=$(active_slot)
  previous=$(cat "$PREVIOUS_FILE" 2>/dev/null || true)

  [ -n "$current" ] || fail "Nenhuma vaga ativa registrada."
  [ -n "$previous" ] || fail "Não há versão anterior disponível (nenhum deploy bem-sucedido depois da última falha)."
  container_exists "aircharter-api-$previous" || fail "O container da versão anterior não existe mais."

  tag=$(get_var "TAG_$(upper "$previous")")
  log "Rollback: vaga $current -> vaga $previous (versão $tag)."
  log "ATENÇÃO: o banco NÃO volta. Isso só é seguro porque toda migration é compatível com a versão anterior (docs/DEPLOY.md §6)."

  "${COMPOSE[@]}" start "api-$previous"
  wait_healthy "aircharter-api-$previous" || fail "A API da versão anterior não subiu. Nada foi trocado."
  "${COMPOSE[@]}" start "web-$previous"
  wait_healthy "aircharter-web-$previous" || fail "O frontend da versão anterior não subiu. Nada foi trocado."
  smoke_test "$previous" "$tag" || fail "A versão anterior falhou nos testes. Nada foi trocado."

  switch_to "$previous" "$tag"
  printf '%s\n' "$current" >"$PREVIOUS_FILE"

  log "Aguardando ${DRAIN_SECONDS}s antes de parar a vaga $current..."
  sleep "$DRAIN_SECONDS"
  stop_slot "$current"
  log "Rollback concluído: $tag no ar pela vaga $previous."
}

cmd_status() {
  local active previous
  active=$(active_slot)
  previous=$(cat "$PREVIOUS_FILE" 2>/dev/null || true)
  echo "Vaga ativa:     ${active:-nenhuma}"
  echo "Vaga anterior:  ${previous:-nenhuma (rollback indisponível)}"
  echo "Tag azul:       $(get_var TAG_BLUE)"
  echo "Tag verde:      $(get_var TAG_GREEN)"
  echo
  docker ps -a --filter "name=aircharter-" --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
}

main() {
  local command=${1:-}
  shift || true

  # Um deploy de cada vez, mesmo que alguém rode à mão durante o CI.
  if [ "$command" != status ] && command -v flock >/dev/null 2>&1; then
    exec 9>"$APP_DIR/.deploy.lock"
    flock -n 9 || fail "Outro deploy está em andamento."
  fi

  case "$command" in
    deploy) cmd_deploy "$@" ;;
    rollback) cmd_rollback ;;
    status) cmd_status ;;
    *) fail "uso: deploy.sh {deploy <tag>|rollback|status}" ;;
  esac
}

main "$@"
