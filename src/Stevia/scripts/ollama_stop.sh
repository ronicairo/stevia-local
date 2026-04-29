#!/bin/bash
# Décharge le modèle et arrête Ollama (lancé par cron à 18h30)
PODMAN=/opt/homebrew/bin/podman
CURL=/usr/bin/curl
MODEL=$(grep "^OLLAMA_MODEL=" /Users/roni/Downloads/WEB/stevia-local/src/Stevia/.env | cut -d= -f2 | tr -d ' ')

$CURL -s http://127.0.0.1:11434/api/generate \
  -d "{\"model\":\"${MODEL}\",\"keep_alive\":0}" \
  > /dev/null 2>&1
sleep 2
$PODMAN stop ollama
