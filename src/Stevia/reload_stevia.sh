#!/bin/bash

# ================================================================
#  STEVIA - RELOAD (sans rebuild)
# ================================================================

set -euo pipefail

STEVIA_ENV_FILE="$(pwd)/.env"

G='\033[0;32m' R='\033[0;31m' N='\033[0m'

[[ ! -f "$STEVIA_ENV_FILE" ]] && echo -e "${R}❌ .env introuvable${N}" && exit 1
set -a && source "$STEVIA_ENV_FILE" && set +a
: "${OLLAMA_HOST:?}"

podman cp services/ stevia-container:/app/
podman cp main.py stevia-container:/app/

podman exec stevia-container pkill -f uvicorn || true
podman exec -d stevia-container uvicorn main:app --host 0.0.0.0 --port 8001

sleep 3

if curl -s http://"$OLLAMA_HOST":8001/health >/dev/null 2>&1; then
  echo -e "${G}✅ API accessible${N}"
else
  echo -e "${R}❌ Erreur - voir logs : podman logs stevia-container${N}"
  exit 1
fi