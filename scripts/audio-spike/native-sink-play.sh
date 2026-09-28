#!/usr/bin/env bash
# Enveloppe de native-sink-play.cjs : route le Core vers le sink du banc
# (même méthode que core-play.sh, voir ses notes sur WirePlumber).
set -euo pipefail
original_sink=""
cleanup() { [[ -n "$original_sink" ]] && pactl set-default-sink "$original_sink" >/dev/null 2>&1 || true; }
trap cleanup EXIT
if [[ -n "${PULSE_SINK:-}" ]]; then
  original_sink="$(pactl get-default-sink 2>/dev/null || true)"
  pactl set-default-sink "$PULSE_SINK" >/dev/null 2>&1 || true
  export PIPEWIRE_NODE="$PULSE_SINK"
  export PIPEWIRE_PROPS="{ node.name = llm-voice-native-proof application.name = llm-voice-native-proof target.object = $PULSE_SINK node.dont-move = true }"
fi
export LLM_VOICE_CORE_STATE_DIR="$(mktemp -d)"
node "$(dirname "$0")/native-sink-play.cjs"
