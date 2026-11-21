#!/bin/sh
# Enchaîne les moteurs lourds, un à la fois : arrête le service qwen3, essaie Fish puis Ming, redémarre TOUJOURS le service.
B=$(cd "$(dirname "$0")" && pwd); D=/mnt/Travail/Projets/Dev/TTS-Voice; LOG=$HOME/.llm-voice/voices-lab/banc
while docker ps --format '{{.Image}}' | grep -q '^deploy-chatterbox:latest$' && [ "$(docker ps --format '{{.Image}}' | grep -c '^deploy-chatterbox:latest$')" -gt 1 ]; do sleep 10; done
[ -e "$XDG_RUNTIME_DIR/gpu-yield/active" ] && { echo "mode jeu actif : rien lancé"; exit 75; }
restart() { cd $D && docker compose -f deploy/docker-compose.tts.yml --profile qwen3 up -d qwen3; echo "SERVICE QWEN3 REDÉMARRÉ $(date +%T)"; }
trap restart EXIT
cd $D && docker compose -f deploy/docker-compose.tts.yml --profile qwen3 stop qwen3; echo "service arrêté $(date +%T)"
sleep 5; for p in /sys/class/drm/card*/device/mem_info_vram_used; do echo "vram libre après arrêt : utilisée $(( $(cat $p)/1048576 )) Mio"; done
echo "=== FISH essai 1 (bf16)"; $B/fish/go_fish.sh > $LOG/fish1.log 2>&1; echo "fish code $?"
if [ -e "$XDG_RUNTIME_DIR/gpu-yield/active" ]; then echo "mode jeu : arrêt avant Ming"; exit 75; fi
echo "=== MING tentative unique"; $B/ming/go_ming.sh > $LOG/ming.log 2>&1; echo "ming code $?"
echo FIN-LOURDS
