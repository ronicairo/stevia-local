#!/bin/bash

# ================================================================
#  STEVIA - START LOCAL (podman-compose + Python natif + Ollama macOS)
# ================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STEVIA_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$STEVIA_DIR/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
STEVIA_ENV_FILE="$STEVIA_DIR/.env"

G='\033[0;32m' Y='\033[1;33m' R='\033[0;31m' N='\033[0m'

# ================================================================
#  CHARGEMENT .ENV
# ================================================================
[[ ! -f "$STEVIA_ENV_FILE" ]] && echo -e "${R}❌ .env introuvable${N}" && exit 1
set -a && source "$STEVIA_ENV_FILE" && set +a
: "${BOOKSTACK_URL:?}" "${BOOKSTACK_TOKEN_ID:?}" "${BOOKSTACK_TOKEN_SECRET:?}"
: "${OLLAMA_MODEL:?}" "${OLLAMA_HOST:?}"
: "${TMPDIR:?}"

mkdir -p "$TMPDIR"
mkdir -p "${STEVIA_LOG_DIR:-/tmp/stevia/logs}"
echo -e "${G}✅ Variables chargées${N}"

# ================================================================
#  PODMAN
# ================================================================
if ! podman info >/dev/null 2>&1; then
  echo -e "${Y}🔧 Démarrage machine Podman...${N}"
  podman machine start 2>/dev/null || true
  podman info >/dev/null 2>&1 || { echo -e "${R}❌ Podman non disponible${N}"; exit 1; }
fi

# ================================================================
#  OLLAMA
# ================================================================
if curl -s --max-time 2 http://localhost:11434/api/tags >/dev/null 2>&1; then
  echo -e "${G}✅ Ollama déjà actif${N}"
else
  echo -e "${Y}🧠 Démarrage Ollama...${N}"
  ollama serve >/dev/null 2>&1 &
  for i in {1..15}; do
    curl -s --max-time 2 http://localhost:11434/api/tags >/dev/null 2>&1 && break
    sleep 1
  done
  curl -s --max-time 2 http://localhost:11434/api/tags >/dev/null 2>&1 \
    || { echo -e "${R}❌ Ollama KO${N}"; exit 1; }
  echo -e "${G}✅ Ollama démarré${N}"
fi

if ! ollama list 2>/dev/null | grep -q "${OLLAMA_MODEL}"; then
  echo -e "${Y}📥 Téléchargement modèle ${OLLAMA_MODEL}...${N}"
  ollama pull "${OLLAMA_MODEL}"
else
  echo -e "${G}✅ Modèle ${OLLAMA_MODEL} déjà présent${N}"
fi

# ================================================================
#  POSTGRESQL + BOOKSTACK
# ================================================================
echo -e "${Y}🗄️ Démarrage PostgreSQL + BookStack...${N}"
start_container() {
  local name=$1
  if podman ps --format '{{.Names}}' | grep -q "^${name}$"; then
    echo -e "${G}✅ ${name} déjà actif${N}"
  elif podman ps -a --format '{{.Names}}' | grep -q "^${name}$"; then
    if ! podman start "$name" >/dev/null 2>&1; then
      echo -e "${Y}⚠️  Premier démarrage échoué pour ${name}, nouvelle tentative...${N}"
      sleep 2
      podman start "$name" >/dev/null 2>&1 \
        || { echo -e "${R}❌ Impossible de démarrer ${name}${N}"; podman logs --tail 20 "$name" 2>&1; exit 1; }
    fi
    echo -e "${G}✅ ${name} redémarré${N}"
  else
    return 1
  fi
}

# Si les conteneurs n'existent pas encore, les créer via podman-compose
if ! podman ps -a --format '{{.Names}}' | grep -q "^postgres-stevia$"; then
  podman-compose -f "$COMPOSE_FILE" up -d postgres bookstack-db bookstack
else
  start_container bookstack-db
  start_container bookstack
  start_container postgres-stevia
fi

# Attente PostgreSQL
for i in {1..20}; do
  podman exec postgres-stevia pg_isready -U stevia >/dev/null 2>&1 && break
  sleep 1
done
podman exec postgres-stevia pg_isready -U stevia >/dev/null 2>&1 \
  || { echo -e "${R}❌ PostgreSQL KO${N}"; exit 1; }
echo -e "${G}✅ PostgreSQL OK${N}"

# Attente BookStack
for i in {1..30}; do
  curl -s --max-time 2 http://localhost:8080 >/dev/null 2>&1 && break
  sleep 2
done
curl -s --max-time 2 http://localhost:8080 >/dev/null 2>&1 \
  && echo -e "${G}✅ BookStack OK${N}" \
  || echo -e "${Y}⚠️  BookStack pas encore prêt (normal au 1er démarrage)${N}"

# ================================================================
#  DÉPENDANCES PYTHON
# ================================================================
echo -e "${Y}📦 Vérification dépendances Python...${N}"
cd "$STEVIA_DIR"
pip install -q -r requirements.txt
echo -e "${G}✅ Dépendances OK${N}"

# ================================================================
#  LANCEMENT FASTAPI
# ================================================================
echo ""
echo -e "${G}══════════════════════════════════════════${N}"
echo -e "${G}  ✅ STEVIA DÉMARRÉE${N}"
echo -e "${G}  → API      : http://127.0.0.1:8001${N}"
echo -e "${G}  → Health   : http://127.0.0.1:8001/health${N}"
echo -e "${G}  → BookStack: http://localhost:8080${N}"
echo -e "${G}══════════════════════════════════════════${N}"
echo ""

uvicorn main:app --host 0.0.0.0 --port 8001 --reload
