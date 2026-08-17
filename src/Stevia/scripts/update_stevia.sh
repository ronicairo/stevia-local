#!/bin/bash


# ================================================================
#  STEVIA - UPDATE CODE
# ================================================================


set -euo pipefail


SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STEVIA_ENV_FILE="$SCRIPT_DIR/../.env"
G='\033[0;32m' Y='\033[1;33m' R='\033[0;31m' N='\033[0m'


echo -e "${Y}╔══════════════════════════════════════════╗${N}"
echo -e "${Y}║  ⚡ MISE À JOUR STEVIA                   ║${N}"
echo -e "${Y}╚══════════════════════════════════════════╝${N}"


# ================================================================
#  CHARGEMENT .ENV
# ================================================================
[[ ! -f "$STEVIA_ENV_FILE" ]] && echo -e "${R}❌ .env introuvable${N}" && exit 1
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"        # retire un éventuel \r de fin (CRLF Windows)
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ -z "${line// }" ]] && continue
  [[ "$line" =~ ^TMPDIR= ]] && continue
  key="${line%%=*}"
  val="${line#*=}"
  val="${val#\'}" val="${val%\'}"
  val="${val#\"}" val="${val%\"}"
  export "$key=$val"
done < "$STEVIA_ENV_FILE"


: "${BOOKSTACK_URL:?}" "${BOOKSTACK_TOKEN_ID:?}" "${BOOKSTACK_TOKEN_SECRET:?}"
: "${PROXY_URL:?}" "${NO_PROXY_LIST:?}"
: "${POSTGRES_USER:?}" "${POSTGRES_PASSWORD:?}" "${POSTGRES_DB:?}"


CONTAINER_NAME="${CONTAINER_NAME:-stevia-container}"
API_PORT="${API_PORT:-8001}"
RAW_MODE="${RAW_MODE:-false}"
OLLAMA_HOST="${OLLAMA_HOST:-127.0.0.1}"

if [[ "$RAW_MODE" == "false" ]]; then
  : "${OLLAMA_MODEL:?}"
fi


# ================================================================
#  VÉRIFICATIONS RAPIDES
# ================================================================
podman exec postgres_db pg_isready -U "$POSTGRES_USER" >/dev/null 2>&1 \
  || { echo -e "${R}❌ PostgreSQL KO — lancez ./scripts/start_stevia.sh${N}"; exit 1; }
echo -e "${G}✅ PostgreSQL${N}"


curl -s --max-time 3 http://"$OLLAMA_HOST":11434/api/tags >/dev/null 2>&1 \
  || { echo -e "${R}❌ Ollama KO — lancez ./scripts/start_stevia.sh${N}"; exit 1; }
echo -e "${G}✅ Ollama${N}"


# ================================================================
#  BUILD & RESTART
# ================================================================
echo -e "${Y}🏗️ Build...${N}"
podman build --network host \
  --build-arg HTTP_PROXY="$PROXY_URL" \
  --build-arg HTTPS_PROXY="$PROXY_URL" \
  --build-arg NO_PROXY="$NO_PROXY_LIST" \
  -t stevia-python "$SCRIPT_DIR/.." \
  2>&1 | grep -E "(STEP|COMMIT|Successfully)" || true


echo -e "${Y}🔄 Restart...${N}"
LOG_DIR="$SCRIPT_DIR/../var/log"
TRAIN_LOG_DIR="$SCRIPT_DIR/../logs"
mkdir -p "$LOG_DIR" "$TRAIN_LOG_DIR"
podman rm -f "$CONTAINER_NAME" 2>/dev/null || true
podman run -d --name "$CONTAINER_NAME" --replace --restart unless-stopped --network host \
  --tz=local \
  -e HTTP_PROXY="$PROXY_URL" -e HTTPS_PROXY="$PROXY_URL" -e NO_PROXY="$NO_PROXY_LIST" \
  -e OLLAMA_HOST="$OLLAMA_HOST" \
  -e OLLAMA_MODEL="$OLLAMA_MODEL" \
  -e ML_RELEVANCE_THRESHOLD="${ML_RELEVANCE_THRESHOLD:-0.35}" \
  -e ML_RETRAIN_THRESHOLD="${ML_RETRAIN_THRESHOLD:-10}" \
  -e DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}" \
  -e BOOKSTACK_URL="$BOOKSTACK_URL" \
  -e BOOKSTACK_TOKEN_ID="$BOOKSTACK_TOKEN_ID" \
  -e BOOKSTACK_TOKEN_SECRET="$BOOKSTACK_TOKEN_SECRET" \
  -e STEVIA_LOG_DIR=/app/var/log \
  -e STEVIA_TRAIN_LOG_DIR=/app/stevia_logs \
  -e RAW_MODE="$RAW_MODE" \
  -e PORT="$API_PORT" \
  -v "$SCRIPT_DIR/../ml":/app/ml \
  -v "$LOG_DIR":/app/var/log \
  -v "$TRAIN_LOG_DIR":/app/stevia_logs \
  localhost/stevia-python:latest


podman image prune -f >/dev/null 2>&1 &


# ================================================================
#  VÉRIFICATION
# ================================================================
echo -e "${Y}⏳ Attente démarrage API...${N}"
for i in {1..20}; do
  curl -s --max-time 2 "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -s --max-time 2 "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1 \
  || { echo -e "${R}❌ API non accessible${N}"; podman logs --tail 30 "$CONTAINER_NAME"; exit 1; }


echo ""
echo -e "${G}══════════════════════════════════════════${N}"
echo -e "${G}  ✅ MISE À JOUR TERMINÉE${N}"
echo -e "${G}══════════════════════════════════════════${N}"
echo ""
echo -e "${Y}Logs en direct (Ctrl+C pour quitter) :${N}"
podman logs -f "$CONTAINER_NAME"
