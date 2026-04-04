#!/usr/bin/env bash
# update-tokens.sh — Met à jour les tokens BookStack dans stevia-container
# Usage : ./update-tokens.sh TOKEN_ID TOKEN_SECRET
set -euo pipefail

TOKEN_ID="${1:-}"
TOKEN_SECRET="${2:-}"

if [[ -z "$TOKEN_ID" || -z "$TOKEN_SECRET" ]]; then
    echo "Usage : ./update-tokens.sh <TOKEN_ID> <TOKEN_SECRET>"
    echo ""
    echo "Récupérer les tokens depuis BookStack :"
    echo "  1. Ouvrir http://localhost:8080"
    echo "  2. Se connecter (admin@admin.com / password)"
    echo "  3. Mon compte → Tokens API → Créer un token"
    exit 1
fi

# Mettre à jour le .env
sed -i '' "s|^BOOKSTACK_TOKEN_ID=.*|BOOKSTACK_TOKEN_ID=${TOKEN_ID}|" .env
sed -i '' "s|^BOOKSTACK_TOKEN_SECRET=.*|BOOKSTACK_TOKEN_SECRET=${TOKEN_SECRET}|" .env

echo "✓ .env mis à jour"

# Mettre à jour les variables dans le conteneur en direct
podman exec stevia-container bash -c "
  sed -i 's|^BOOKSTACK_TOKEN_ID=.*|BOOKSTACK_TOKEN_ID=${TOKEN_ID}|' /app/.env 2>/dev/null || true
  sed -i 's|^BOOKSTACK_TOKEN_SECRET=.*|BOOKSTACK_TOKEN_SECRET=${TOKEN_SECRET}|' /app/.env 2>/dev/null || true
" 2>/dev/null || true

# Relancer le conteneur avec les nouvelles variables
podman stop stevia-container
podman rm stevia-container
podman run -d \
  --name stevia-container \
  --network stevia-local_default \
  -p 8001:8001 \
  -e DATABASE_URL="postgresql://stevia:steviapassword@postgres-stevia:5432/stevia" \
  -e BOOKSTACK_URL="http://bookstack:80" \
  -e BOOKSTACK_TOKEN_ID="${TOKEN_ID}" \
  -e BOOKSTACK_TOKEN_SECRET="${TOKEN_SECRET}" \
  -e OLLAMA_HOST="ollama" \
  -e OLLAMA_MODEL="${OLLAMA_MODEL:-gemma3:1b}" \
  -e TMPDIR=/app/stevia_work/tmp \
  -v "$(pwd)/stevia-api/main.py:/app/main.py:ro" \
  localhost/stevia-local_stevia-api:latest

echo "✓ stevia-container relancé avec les nouveaux tokens"
sleep 4
curl -s http://localhost:8001/health && echo ""
