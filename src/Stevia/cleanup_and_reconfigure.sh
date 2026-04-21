#!/bin/bash

# ================================================================
#  STEVIA - NETTOYAGE ET RECONFIGURATION PODMAN
# ================================================================

set -euo pipefail

G='\033[0;32m' Y='\033[1;33m' R='\033[0;31m' B='\033[0;34m' N='\033[0m'

STEVIA_GRAPHROOT="/app/stevia_work/containers"
STEVIA_STORAGE_CONF="$HOME/.config/containers/storage.conf"

echo -e "${B}╔════════════════════════════════════════════════════════════╗${N}"
echo -e "${B}║       NETTOYAGE ET RECONFIGURATION PODMAN POUR STEVIA      ║${N}"
echo -e "${B}╚════════════════════════════════════════════════════════════╝${N}"

# ================================================================
#  ÉTAPE 1 : ÉTAT INITIAL
# ================================================================
echo -e "${Y}📊 1/7 : État initial${N}"
df -h /app | tail -1
df -h /home | tail -1
du -sh "$STEVIA_GRAPHROOT" 2>/dev/null || echo "  $STEVIA_GRAPHROOT : inexistant"
du -sh "$HOME/.local/share/containers" 2>/dev/null || echo "  ~/.local/share/containers : inexistant"
read -p "Appuyez sur Entrée pour continuer..."

# ================================================================
#  ÉTAPE 2 : ARRÊT DES CONTENEURS
# ================================================================
echo -e "${Y}🛑 2/7 : Arrêt des conteneurs${N}"
sudo podman stop $(sudo podman ps -aq) 2>/dev/null || true
sudo podman rm -f $(sudo podman ps -aq) 2>/dev/null || true
podman stop $(podman ps -aq) 2>/dev/null || true
podman rm -f $(podman ps -aq) 2>/dev/null || true
read -p "Appuyez sur Entrée pour continuer..."

# ================================================================
#  ÉTAPE 3 : NETTOYAGE ROOT
# ================================================================
echo -e "${Y}3/7 : Nettoyage stockage root${N}"
sudo podman system prune -a --volumes -f 2>/dev/null || true
sudo podman system reset -f 2>/dev/null || true
du -sh "$STEVIA_GRAPHROOT" 2>/dev/null || echo "  Dossier vide"
read -p "Appuyez sur Entrée pour continuer..."

# ================================================================
#  ÉTAPE 4 : NETTOYAGE ROOTLESS
# ================================================================
echo -e "${Y}4/7 : Nettoyage stockage rootless${N}"
podman system prune -a --volumes -f 2>/dev/null || true
podman system reset -f 2>/dev/null || true
[[ -d "$HOME/.local/share/containers/storage" ]] && rm -rf "$HOME/.local/share/containers/storage"
du -sh "$HOME/.local/share/containers" 2>/dev/null || echo "  Dossier supprimé"
read -p "Appuyez sur Entrée pour continuer..."

# ================================================================
#  ÉTAPE 5 : CONFIGURATION PODMAN
# ================================================================
echo -e "${Y}5/7 : Configuration Podman rootless${N}"
mkdir -p "$(dirname "$STEVIA_STORAGE_CONF")"
cat > "$STEVIA_STORAGE_CONF" << 'CONF'
[storage]
driver = "overlay"
runroot = "/run/user/1006/containers"
graphroot = "/app/stevia_work/containers"

[storage.options]
additionalimagestores = []

[storage.options.overlay]
mountopt = "nodev,metacopy=on"
CONF
echo "Configuration : $STEVIA_STORAGE_CONF"
read -p "Appuyez sur Entrée pour continuer..."

# ================================================================
#  ÉTAPE 6 : VÉRIFICATION
# ================================================================
echo -e "${Y}6/7 : Vérification${N}"
GRAPHROOT=$(podman info --format '{{.Store.GraphRoot}}' 2>/dev/null || echo "ERREUR")
if [[ "$GRAPHROOT" == "$STEVIA_GRAPHROOT" ]]; then
  echo -e "${G}✅ Podman utilise bien $STEVIA_GRAPHROOT${N}"
else
  echo -e "${R}❌ Podman utilise : $GRAPHROOT (attendu : $STEVIA_GRAPHROOT)${N}"
  exit 1
fi
read -p "Appuyez sur Entrée pour continuer..."

# ================================================================
#  ÉTAPE 7 : ÉTAT FINAL
# ================================================================
echo -e "${Y}7/7 : État final${N}"
df -h /app | tail -1
df -h /home | tail -1
podman ps -a
podman volume ls

echo ""
echo -e "${B}╔════════════════════════════════════════════════════════════╗${N}"
echo -e "${B}║  ✅ RECONFIGURATION TERMINÉE                               ║${N}"
echo -e "${B}╚════════════════════════════════════════════════════════════╝${N}"
echo -e "  Lancez : ${B}./start_stevia.sh${N}"