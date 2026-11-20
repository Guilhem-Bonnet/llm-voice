#!/usr/bin/env bash
# Prépare, HORS DU DÉPÔT, le contexte de construction de l'image llm-voice-qwen3-models.
#   deploy/qwen3/prepare-models-context.sh [DOSSIER_CIBLE]
# Source : ~/.llm-voice/voices-lab/qwen3 (QWEN3_LAB). Liens physiques si même système de
# fichiers (aucune copie de 8,6 Go), sinon copie. Refuse un dossier cible existant.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
VERSION=${QWEN3_VERSION:-0.1.0}
LAB=${QWEN3_LAB:-$HOME/.llm-voice/voices-lab/qwen3}
DEST=${1:-$HOME/.llm-voice/build/qwen3-models-$VERSION}
MODELS=(models--Qwen--Qwen3-TTS-12Hz-1.7B-Base models--Qwen--Qwen3-TTS-12Hz-1.7B-VoiceDesign)
REFS=(out-gao/rire-en-s11.wav out-gao/rire-en-s11.json out-gao/chuchote-en-s11.wav out-gao/chuchote-en-s11.json)

case "$DEST" in "$(git -C "$HERE" rev-parse --show-toplevel 2>/dev/null || echo /nonexistent)"*)
    echo "refus : $DEST est dans le dépôt (les poids n'entrent jamais dans git)" >&2; exit 1;; esac
[ -e "$DEST" ] && { echo "refus : $DEST existe déjà (choisir un autre dossier)" >&2; exit 1; }
for m in "${MODELS[@]}"; do [ -d "$LAB/hf/hub/$m/snapshots" ] || { echo "manque $LAB/hf/hub/$m" >&2; exit 1; }; done
for r in "${REFS[@]}"; do [ -f "$LAB/$r" ] || { echo "manque $LAB/$r" >&2; exit 1; }; done
LICENSE_SRC=$(ls "$LAB"/extras/qwen_tts-0.1.1.dist-info/licenses/LICENSE)

mkdir -p "$DEST/hf/hub" "$DEST/refs/out-gao" "$DEST/created"
link() { cp -al "$@" 2>/dev/null || cp -a "$@"; }
for m in "${MODELS[@]}"; do link "$LAB/hf/hub/$m" "$DEST/hf/hub/"; done
for r in "${REFS[@]}"; do cp -a "$LAB/$r" "$DEST/refs/$r"; done
cp "$HERE/voices.json" "$DEST/refs/voices.json"
# Les voix créées, une par dossier v-* ; jamais created-archive/.
for v in "$LAB"/created/v-*; do [ -f "$v/voice.json" ] && cp -a "$v" "$DEST/created/"; done
cp "$LICENSE_SRC" "$DEST/LICENSE-Apache-2.0"
cp "$HERE/NOTICE.models" "$DEST/NOTICE"
cp "$HERE/Dockerfile.models" "$HERE/data-init.sh" "$DEST/"
echo "$VERSION" > "$DEST/VERSION"
echo "contexte prêt : $DEST ($(ls "$DEST/created" | wc -l) voix créées)"
du -shL "$DEST"/hf/hub/* 2>/dev/null || true
