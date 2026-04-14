#!/bin/bash

# ================================================================
#  STEVIA - START STACK (PGVector + Ollama + FastAPI)
# ================================================================

set -euo pipefail

STEVIA_ENV_FILE="$(pwd)/.env"

# Couleurs
G='\033[0;32m' Y='\033[1;33m' R='\033[0;31m' N='\033[0m'

# ================================================================
#  CHARGEMENT .ENV
# ================================================================
[[ ! -f "$STEVIA_ENV_FILE" ]] && echo -e "${R}❌ .env introuvable${N}" && exit 1
set -a && source "$STEVIA_ENV_FILE" && set +a
: "${BOOKSTACK_URL:?}" "${BOOKSTACK_TOKEN_ID:?}" "${BOOKSTACK_TOKEN_SECRET:?}"
: "${OLLAMA_MODEL:?}" "${OLLAMA_HOST:?}"
: "${TMPDIR:?}"
PROXY_URL="${PROXY_URL:-}"
NO_PROXY_LIST="${NO_PROXY_LIST:-}"
export TMPDIR
mkdir -p "$TMPDIR"
echo -e "${G}✅ Variables chargées${N}"

# ================================================================
#  VÉRIFICATIONS
# ================================================================
GRAPHROOT=$(podman info --format '{{.Store.GraphRoot}}' 2>/dev/null || echo "")
[[ "$GRAPHROOT" != "/app/stevia_work/containers" ]] && echo -e "${R}❌ Podman mal configuré${N}" && exit 1

SPACE=$(df -BG /app | tail -1 | awk '{print $4}' | sed 's/G//')
[[ "$SPACE" -lt 3 ]] && echo -e "${R}❌ Espace insuffisant (${SPACE}GB)${N}" && exit 1

# ================================================================
#  NETTOYAGE
# ================================================================
echo -e "${Y}🧹 Nettoyage...${N}"
podman rm -f stevia-container postgres_db ollama 2>/dev/null || true
podman image prune -f >/dev/null 2>&1 || true

# ================================================================
#  POSTGRESQL
# ================================================================
echo -e "${Y}🗄️ PostgreSQL...${N}"
podman run -d --name postgres_db --replace --restart always --network host \
  -e POSTGRES_USER="$POSTGRES_USER" \
  -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  -e POSTGRES_DB="$POSTGRES_DB" \
  -v stevia_pgdata:/var/lib/postgresql/data \
  docker.io/pgvector/pgvector:pg16

for i in {1..15}; do
  podman exec postgres_db pg_isready -U "$POSTGRES_USER" >/dev/null 2>&1 && break
  sleep 1
done
podman exec postgres_db pg_isready -U "$POSTGRES_USER" >/dev/null 2>&1 || { echo -e "${R}❌ PostgreSQL KO${N}"; exit 1; }
echo -e "${G}✅ PostgreSQL OK${N}"

# ================================================================
#  OLLAMA
# ================================================================
echo -e "${Y}🧠 Ollama...${N}"
podman run -d --name ollama --replace --restart always --network host \
  -e HTTP_PROXY="$PROXY_URL" -e HTTPS_PROXY="$PROXY_URL" -e NO_PROXY="$NO_PROXY_LIST" \
  -e OLLAMA_INSECURE="true" \
  -v ollama_data:/root/.ollama \
  docker.io/ollama/ollama:latest

for i in {1..15}; do
  curl -s --max-time 2 http://"$OLLAMA_HOST":11434/api/tags >/dev/null 2>&1 && break
  sleep 1
done
curl -s --max-time 2 http://"$OLLAMA_HOST":11434/api/tags >/dev/null 2>&1 || { echo -e "${R}❌ Ollama KO${N}"; exit 1; }
echo -e "${G}✅ Ollama OK${N}"

# Modèle (télécharge seulement si absent)
if ! podman exec ollama ollama list | grep -q "${OLLAMA_MODEL}"; then
  echo -e "${Y}📥 Téléchargement modèle...${N}"
  podman exec ollama ollama pull "${OLLAMA_MODEL}"
fi
# Préchargement rapide
curl -s http://"$OLLAMA_HOST":11434/api/generate -d "{\"model\":\"${OLLAMA_MODEL}\",\"prompt\":\"\",\"keep_alive\":\"10m\"}" >/dev/null &
echo -e "${G}✅ Modèle prêt${N}"

# ================================================================
#  BUILD & RUN STEVIA
# ================================================================
echo -e "${Y}🏗️ Build Stevia...${N}"
podman build --network host \
  --build-arg HTTP_PROXY="$PROXY_URL" --build-arg HTTPS_PROXY="$PROXY_URL" --build-arg NO_PROXY="$NO_PROXY_LIST" \
  -t stevia-python . 2>&1 | grep -E "(STEP|COMMIT|Successfully)" || true

echo -e "${Y}🚀 Lancement Stevia...${N}"
podman run -d --name stevia-container --replace --restart always --network host \
  -e TZ="Europe/Paris" \
  -e HTTP_PROXY="$PROXY_URL" -e HTTPS_PROXY="$PROXY_URL" -e NO_PROXY="$NO_PROXY_LIST" \
  -e OLLAMA_HOST="$OLLAMA_HOST" \
  -e OLLAMA_MODEL="$OLLAMA_MODEL" \
  -e DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${OLLAMA_HOST}:5432/${POSTGRES_DB}" \
  -e BOOKSTACK_URL="$BOOKSTACK_URL" \
  -e BOOKSTACK_TOKEN_ID="$BOOKSTACK_TOKEN_ID" \
  -e BOOKSTACK_TOKEN_SECRET="$BOOKSTACK_TOKEN_SECRET" \
  localhost/stevia-python:latest

# ================================================================
#  FIN
# ================================================================
sleep 3
echo ""
echo -e "${G}══════════════════════════════════════════${N}"
echo -e "${G}  ✅ STEVIA DÉMARRÉE${N}"
echo -e "${G}══════════════════════════════════════════${N}"
podman ps --format "table {{.Names}}\t{{.Status}}" | grep -E "(postgres|ollama|stevia)"
echo ""
echo -e "${Y}📜 Logs en direct (Ctrl+C pour quitter) :${N}"
echo ""
podman logs -f stevia-container