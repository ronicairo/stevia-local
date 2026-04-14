#!/bin/bash

# ================================================================
#  STEVIA - UPDATE CODE (mode rapide : cp + restart)
#  Usage : ./update_stevia.sh
#          ./update_stevia.sh --rebuild   ← rebuild image complète
# ================================================================

set -euo pipefail

STEVIA_ENV_FILE="$(pwd)/.env"
G='\033[0;32m' Y='\033[1;33m' R='\033[0;31m' B='\033[0;34m' N='\033[0m'

echo -e "${B}╔══════════════════════════════════════════╗${N}"
echo -e "${B}║  ⚡ MISE À JOUR STEVIA                   ║${N}"
echo -e "${B}╚══════════════════════════════════════════╝${N}"

# Chargement .env — TMPDIR est un chemin container, on ne l'exporte pas
if [[ -f "$STEVIA_ENV_FILE" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }" ]] && continue
    [[ "$line" =~ ^TMPDIR= ]] && continue
    export "${line?}"
  done < "$STEVIA_ENV_FILE"
fi

REBUILD=false
[[ "${1:-}" == "--rebuild" ]] && REBUILD=true

# ================================================================
#  MODE RAPIDE (défaut) — copie + restart (~10s)
# ================================================================
if [[ "$REBUILD" == false ]]; then
  echo -e "${Y}⚡ Copie du code Python...${N}"
  podman cp services/  stevia-container:/app/services/
  podman cp main.py    stevia-container:/app/main.py
  # ml/ est un volume monté (docker-compose) — pas besoin de podman cp

  echo -e "${Y}🔄 Restart stevia-container...${N}"
  podman restart stevia-container

# ================================================================
#  MODE REBUILD — image complète
# ================================================================
else
  echo -e "${Y}🏗️  Rebuild image...${N}"
  podman build --network host -t stevia-python . \
    2>&1 | grep -E "(STEP|COMMIT|Successfully)" || true

  echo -e "${Y}🚀 Restart stevia-container...${N}"
  podman stop stevia-container 2>/dev/null || true
  podman rm   stevia-container 2>/dev/null || true
  podman run -d --name stevia-container --restart unless-stopped --network host \
    -e TZ="Europe/Paris" \
    -e OLLAMA_HOST="${OLLAMA_HOST:-ollama}" \
    -e OLLAMA_MODEL="${OLLAMA_MODEL:-gemma3:1b}" \
    -e DATABASE_URL="${DATABASE_URL:-postgresql://stevia:steviapassword@127.0.0.1:5432/stevia}" \
    -e BOOKSTACK_URL="${BOOKSTACK_URL:-http://127.0.0.1:8080}" \
    -e BOOKSTACK_TOKEN_ID="${BOOKSTACK_TOKEN_ID:-}" \
    -e BOOKSTACK_TOKEN_SECRET="${BOOKSTACK_TOKEN_SECRET:-}" \
    localhost/stevia-python:latest

  podman image prune -f >/dev/null 2>&1 &
fi

# ================================================================
#  VÉRIFICATION API
# ================================================================
echo -e "${Y}⏳ Attente démarrage API...${N}"
for i in {1..20}; do
  curl -s --max-time 2 http://127.0.0.1:8001/health >/dev/null 2>&1 && break
  sleep 1
done

curl -s --max-time 2 http://127.0.0.1:8001/health >/dev/null 2>&1 \
  || { echo -e "${R}❌ API non accessible — logs :${N}"; podman logs --tail 30 stevia-container; exit 1; }

echo ""
echo -e "${G}══════════════════════════════════════════${N}"
echo -e "${G}  ✅ MISE À JOUR TERMINÉE${N}"
echo -e "${G}══════════════════════════════════════════${N}"
echo ""
echo -e "${Y}Logs en direct (Ctrl+C pour quitter) :${N}"
echo ""
podman logs -f stevia-container
