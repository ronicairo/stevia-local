#!/bin/bash

# ================================================================
#  STEVIA - UPDATE CODE
# ================================================================

set -euo pipefail

STEVIA_ENV_FILE="$(pwd)/.env"

# Couleurs
G='\033[0;32m' Y='\033[1;33m' R='\033[0;31m' B='\033[0;34m' N='\033[0m'

echo -e "${B}╔══════════════════════════════════════════╗${N}"
echo -e "${B}║  🔄 MISE À JOUR STEVIA                   ║${N}"
echo -e "${B}╚══════════════════════════════════════════╝${N}"

# ================================================================
#  CHARGEMENT .ENV
# ================================================================
[[ ! -f "$STEVIA_ENV_FILE" ]] && echo -e "${R}❌ .env introuvable${N}" && exit 1
set -a && source "$STEVIA_ENV_FILE" && set +a
: "${BOOKSTACK_URL:?}" "${BOOKSTACK_TOKEN_ID:?}" "${BOOKSTACK_TOKEN_SECRET:?}"
: "${OLLAMA_MODEL:?}" "${OLLAMA_HOST:?}"
: "${PROXY_URL:?}" "${NO_PROXY_LIST:?}"
: "${POSTGRES_USER:?}" "${POSTGRES_PASSWORD:?}" "${POSTGRES_DB:?}"
: "${TMPDIR:?}"
export TMPDIR
mkdir -p "$TMPDIR"

# ================================================================
#  VÉRIFICATIONS RAPIDES
# ================================================================
podman exec postgres_db pg_isready -U "$POSTGRES_USER" >/dev/null 2>&1 || { echo -e "${R}❌ PostgreSQL KO - lancez ./start_stevia.sh${N}"; exit 1; }
echo -e "${G}✅ PostgreSQL${N}"

curl -s --max-time 3 http://"$OLLAMA_HOST":11434/api/tags >/dev/null 2>&1 || { echo -e "${R}❌ Ollama KO - lancez ./start_stevia.sh${N}"; exit 1; }
echo -e "${G}✅ Ollama${N}"

# ================================================================
#  BUILD & RESTART
# ================================================================
echo -e "${Y}Build...${N}"
podman build --network host \
  --build-arg HTTP_PROXY="$PROXY_URL" --build-arg HTTPS_PROXY="$PROXY_URL" --build-arg NO_PROXY="$NO_PROXY_LIST" \
  -t stevia-python . 2>&1 | grep -E "(STEP|COMMIT|Successfully)" || true

echo -e "${Y}Restart...${N}"
podman rm -f stevia-container 2>/dev/null || true
podman run -d --name stevia-container --replace --restart always --network host \
  -e TZ="Europe/Paris" \
  -e HTTP_PROXY="$PROXY_URL" -e HTTPS_PROXY="$PROXY_URL" -e NO_PROXY="$NO_PROXY_LIST" \
  -e OLLAMA_HOST="$OLLAMA_HOST" \
  -e OLLAMA_MODEL="$OLLAMA_MODEL" \
  -e DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}" \
  -e BOOKSTACK_URL="$BOOKSTACK_URL" \
  -e BOOKSTACK_TOKEN_ID="$BOOKSTACK_TOKEN_ID" \
  -e BOOKSTACK_TOKEN_SECRET="$BOOKSTACK_TOKEN_SECRET" \
  localhost/stevia-python:latest

podman image prune -f >/dev/null 2>&1 &

# ================================================================
#  VÉRIFICATION
# ================================================================
echo -e "${Y}⏳ Attente démarrage API...${N}"
for i in {1..20}; do
  if curl -s --max-time 2 http://127.0.0.1:8001/health >/dev/null 2>&1; then
    echo -e "${G}✅ API prête !${N}"
    break
  fi
  sleep 1
done

if ! curl -s --max-time 2 http://127.0.0.1:8001/health >/dev/null 2>&1; then
  echo -e "${R}❌ API non accessible - vérifiez les logs :${N}"
  podman logs --tail 30 stevia-container
  exit 1
fi

echo ""
echo -e "${G}══════════════════════════════════════════${N}"
echo -e "${G}  ✅ MISE À JOUR TERMINÉE${N}"
echo -e "${G}══════════════════════════════════════════${N}"
echo ""
echo -e "${Y}Logs en direct (Ctrl+C pour quitter) :${N}"
echo ""
podman logs -f stevia-container