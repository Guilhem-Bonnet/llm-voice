#!/usr/bin/env bash
# setup.sh — prépare le venv du banc de preuve audio (idempotent).
#
# Usage :
#   scripts/audio-proof/setup.sh
#
# Crée (si absent) ~/.llm-voice/tools/audio-proof-venv avec Python 3.12
# (le système peut être en 3.14, incompatible avec faster-whisper/ctranslate2 au
# moment de l'écriture) et y installe faster-whisper + numpy. Hors dépôt :
# le venv ne doit jamais être commité.
set -euo pipefail

VENV_DIR="${LLM_VOICE_AUDIO_PROOF_VENV:-$HOME/.llm-voice/tools/audio-proof-venv}"

if ! command -v uv >/dev/null 2>&1; then
  echo "setup.sh: uv introuvable (https://docs.astral.sh/uv/)" >&2
  exit 1
fi

if [ -x "$VENV_DIR/bin/python" ] && "$VENV_DIR/bin/python" -c "import faster_whisper, numpy" >/dev/null 2>&1; then
  echo "setup.sh: venv déjà prêt : $VENV_DIR"
  exit 0
fi

mkdir -p "$(dirname "$VENV_DIR")"
uv venv --python 3.12 "$VENV_DIR"
uv pip install --python "$VENV_DIR/bin/python" faster-whisper numpy

echo "setup.sh: venv prêt : $VENV_DIR"
