#!/usr/bin/env bash
# native-real.sh — preuve de bout en bout de l'extension entière (GAO-tests-int-gr-001).
#
# Vrai VS Code sans écran (xvfb-run), `llmVoice.audio.engine=native`, vrai Core
# Rust (`target/release/llm-voice-core`), vraie voix Piper (fournisseur
# `system`), son capté sur un sink nul par le banc `prove.sh` puis transcrit.
# C'est le test qui aurait attrapé le bogue terrain `segmentId "session-4:0"`.
#
# Étapes : cargo build --release -p llm-voice-core → build de l'extension →
# prove.sh --play-cmd "<ce script> --inner" (le test `native-real` de
# vscode-extension/test/integration-native-real/ tourne pendant la capture).
#
# Le Core hérite de PULSE_SINK/PIPEWIRE_PROPS (même routage que
# scripts/audio-spike/native-sink-play.sh) et d'un LLM_VOICE_CORE_STATE_DIR
# jetable : jamais de rattachement au Core « réel » d'un VS Code ouvert.
#
# Sortie 0 si le test est vert ET la transcription conforme (prove.sh, WER
# <= 0.25, signal non silencieux) ; 1 sinon ; 2 erreur du banc. Le JSON de
# prove.sh est imprimé sur stdout ; les journaux détaillés vont sur stderr.
set -euo pipefail

SCRIPT="$(readlink -f "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(dirname "$SCRIPT")"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
EXT="$REPO/vscode-extension"
MARKDOWN="$EXT/test/fixtures-native-real/native-real.md"

if [ "${1:-}" = "--inner" ]; then
  # Exécuté par prove.sh (--play-cmd) : PULSE_SINK est exporté vers le sink nul.
  original_sink=""
  cleanup_inner() { [ -n "$original_sink" ] && pactl set-default-sink "$original_sink" >/dev/null 2>&1 || true; }
  trap cleanup_inner EXIT
  if [ -n "${PULSE_SINK:-}" ]; then
    original_sink="$(pactl get-default-sink 2>/dev/null || true)"
    pactl set-default-sink "$PULSE_SINK" >/dev/null 2>&1 || true
    export PIPEWIRE_NODE="$PULSE_SINK"
    export PIPEWIRE_PROPS="{ node.name = llm-voice-native-real application.name = llm-voice-native-real target.object = $PULSE_SINK node.dont-move = true }"
  fi
  export LLM_VOICE_CORE_STATE_DIR
  LLM_VOICE_CORE_STATE_DIR="$(mktemp -d)"
  export LLM_VOICE_NATIVE_REAL=1
  cd "$EXT"
  set +e
  xvfb-run -a npx vscode-test --label native-real >&2
  code=$?
  set -e
  echo "$code" > "$LLM_VOICE_NATIVE_REAL_EXIT_FILE"
  # Le Core lancé par l'extension s'arrête avec son parent ; on nettoie au cas où.
  if [ -f "$LLM_VOICE_CORE_STATE_DIR/core.json" ]; then
    pid="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["pid"])' "$LLM_VOICE_CORE_STATE_DIR/core.json" 2>/dev/null || true)"
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  fi
  rm -rf "$LLM_VOICE_CORE_STATE_DIR"
  exit 0   # le verdict du test est combiné à celui du banc plus bas
fi

for bin in cargo npm npx xvfb-run pactl parecord python3; do
  command -v "$bin" >/dev/null 2>&1 || { echo "native-real.sh: binaire requis introuvable : $bin" >&2; exit 2; }
done

echo "== cargo build --release -p llm-voice-core" >&2
(cd "$REPO" && cargo build --release -p llm-voice-core >&2)
echo "== build de l'extension" >&2
(cd "$EXT" && npm run build >&2)

# Texte attendu = les phrases du Markdown (retours à la ligne aplatis).
EXPECT="$(tr '\n' ' ' < "$MARKDOWN" | sed 's/  */ /g; s/ *$//')"
export LLM_VOICE_NATIVE_REAL_EXIT_FILE
LLM_VOICE_NATIVE_REAL_EXIT_FILE="$(mktemp)"
trap 'rm -f "$LLM_VOICE_NATIVE_REAL_EXIT_FILE"' EXIT
echo "1" > "$LLM_VOICE_NATIVE_REAL_EXIT_FILE"   # défaut : test non exécuté = échec

set +e
"$SCRIPT_DIR/prove.sh" "$(mktemp -u).wav" --expect "$EXPECT" --post-roll 3 \
  --play-cmd "\"$SCRIPT\" --inner"
PROVE_EXIT=$?
set -e
TEST_EXIT="$(cat "$LLM_VOICE_NATIVE_REAL_EXIT_FILE")"

echo "native-real.sh: test vscode-test exit=$TEST_EXIT ; banc prove.sh exit=$PROVE_EXIT" >&2
if [ "$TEST_EXIT" = "0" ] && [ "$PROVE_EXIT" = "0" ]; then
  exit 0
fi
[ "$PROVE_EXIT" = "2" ] && exit 2
exit 1
