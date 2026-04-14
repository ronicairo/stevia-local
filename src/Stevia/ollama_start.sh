#!/bin/bash
# Démarre Ollama et précharge le modèle en mémoire (lancé par cron à 7h30)
PODMAN=/opt/homebrew/bin/podman
CURL=/usr/bin/curl
MODEL=$(grep "^OLLAMA_MODEL=" /Users/roni/Downloads/WEB/stevia-local/src/Stevia/.env | cut -d= -f2 | tr -d ' ')

$PODMAN start ollama
sleep 5
$CURL -s http://127.0.0.1:11434/api/generate \
  -d "{\"model\":\"${MODEL}\",\"prompt\":\"\",\"keep_alive\":-1}" \
  > /dev/null 2>&1
