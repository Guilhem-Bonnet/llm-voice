#!/usr/bin/env bash
# Lance le banc d'écoute. Usage : scripts/voice-lab/run.sh [dossier de sortie] [options de lab.py]
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="${1:-$here/../../_grimoire-output/evidence/GAO-essais-voix-001/ecoute}"
[ $# -gt 0 ] && shift
python="${LLM_VOICE_LAB_PYTHON:-$HOME/.llm-voice/tools/audio-proof-venv/bin/python}"
exec "$python" "$here/lab.py" --out "$out" "$@"
