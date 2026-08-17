#!/bin/bash
# Démarre Ollama et précharge le modèle UTILISÉ (RAW ou normal) en mémoire (cron 7h30)
PODMAN=/opt/homebrew/bin/podman
CURL=/usr/bin/curl
ENV_FILE=/Users/roni/Downloads/WEB/stevia-local/src/Stevia/.env
_env() { grep "^$1=" "$ENV_FILE" | cut -d= -f2 | tr -d " '\""; }

RAW_MODE=$(_env RAW_MODE)
OLLAMA_MODEL=$(_env OLLAMA_MODEL)
RAW_OLLAMA_MODEL=$(_env RAW_OLLAMA_MODEL)

# Ne charger que le modèle réellement utilisé selon le mode
if [[ "$RAW_MODE" == "true" ]]; then
  MODEL="$RAW_OLLAMA_MODEL"; OTHER="$OLLAMA_MODEL"
else
  MODEL="$OLLAMA_MODEL"; OTHER="$RAW_OLLAMA_MODEL"
fi

$PODMAN start ollama
sleep 5

# Décharge le modèle NON utilisé (libère la RAM)
if [[ -n "$OTHER" && "$OTHER" != "$MODEL" ]]; then
  $CURL -s http://127.0.0.1:11434/api/generate -d "{\"model\":\"${OTHER}\",\"keep_alive\":0}" > /dev/null 2>&1
  $PODMAN exec ollama ollama stop "$OTHER" > /dev/null 2>&1 || true
fi

# Précharge le modèle utilisé (keep_alive:-1 = reste chargé)
$CURL -s http://127.0.0.1:11434/api/generate \
  -d "{\"model\":\"${MODEL}\",\"prompt\":\"\",\"keep_alive\":-1}" \
  > /dev/null 2>&1
