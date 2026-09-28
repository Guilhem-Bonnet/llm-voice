#!/usr/bin/env bash
# selftest.sh — vérifie que prove.sh distingue un WAV parlé d'un WAV silencieux.
#
# Usage : scripts/audio-proof/selftest.sh
#
# Génère un WAV de référence avec piper (voix fr_FR-siwis-medium) et un WAV
# silencieux de même durée avec sox, lance prove.sh sur chacun, et imprime les
# deux codes de sortie obtenus (référence attendue : 0 ; silence attendu :
# non nul).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VOICE_MODEL="${LLM_VOICE_SELFTEST_MODEL:-$HOME/.llm-voice/voices/fr_FR-siwis-medium.onnx}"
PHRASE="Ceci est un test du banc de preuve audio."
WORKDIR="$(mktemp -d /tmp/llm-voice-audio-proof-selftest.XXXXXX)"
REF_WAV="$WORKDIR/reference.wav"
SILENCE_WAV="$WORKDIR/silence.wav"

cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

if ! command -v piper >/dev/null 2>&1; then
  echo "selftest.sh: piper introuvable" >&2
  exit 2
fi
if ! command -v sox >/dev/null 2>&1; then
  echo "selftest.sh: sox introuvable" >&2
  exit 2
fi
if [ ! -f "$VOICE_MODEL" ]; then
  echo "selftest.sh: modèle de voix introuvable : $VOICE_MODEL" >&2
  exit 2
fi

echo "selftest.sh: génération du WAV de référence (piper)…" >&2
echo -n "$PHRASE" | piper -m "$VOICE_MODEL" -f "$REF_WAV" >/dev/null 2>&1

DURATION="$(soxi -D "$REF_WAV")"
echo "selftest.sh: génération du WAV silencieux (sox, ${DURATION}s)…" >&2
sox -n -r 22050 -c 1 "$SILENCE_WAV" trim 0 "$DURATION"

echo "selftest.sh: prove.sh sur la référence…" >&2
"$SCRIPT_DIR/prove.sh" "$REF_WAV" --expect "$PHRASE"
REF_EXIT=$?

echo "selftest.sh: prove.sh sur le silence…" >&2
"$SCRIPT_DIR/prove.sh" "$SILENCE_WAV" --expect "$PHRASE"
SILENCE_EXIT=$?

echo "---"
echo "reference_exit=$REF_EXIT"
echo "silence_exit=$SILENCE_EXIT"

if [ "$REF_EXIT" -eq 0 ] && [ "$SILENCE_EXIT" -ne 0 ]; then
  echo "selftest.sh: PASS (référence=0, silence non nul)"
  exit 0
else
  echo "selftest.sh: FAIL (attendu référence=0 et silence non nul)" >&2
  exit 1
fi
