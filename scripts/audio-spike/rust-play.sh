#!/usr/bin/env bash
# Moteur de comparaison "Rust" (`llm-voice-audio-play`) du spike
# GAO-spike-moteur-001 (ADR-012), pensé pour `scripts/audio-proof/prove.sh
# --play-cmd`.
#
# Limitation mesurée et documentée dans l'evidence-pack : `cpal` (backend
# ALSA, via le greffon `pipewire-alsa`) ouvre le périphérique ALSA "default"
# et ne sait pas cibler un sink précis comme le fait `pw-play --target`. Ce
# script bascule donc le **sink par défaut PipeWire** vers `$PULSE_SINK` le
# temps de la lecture, puis restaure le sink par défaut d'origine — un
# effet de bord global que mpv (backend natif `pipewire`, voir
# `mpv-play.sh`) n'a pas besoin de ce détour pour cibler un sink précis.
#
# Usage :
#   PULSE_SINK=<sink> scripts/audio-spike/rust-play.sh <wav>... [--pause-at MS --resume-after MS]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BIN="$REPO_ROOT/target/release/llm-voice-audio-play"

if [[ ! -x "$BIN" ]]; then
  echo "erreur: binaire absent ($BIN). Lance d'abord: cargo build --release -p llm-voice-audio" >&2
  exit 2
fi

original_sink=""
if [[ -n "${PULSE_SINK:-}" ]]; then
  original_sink="$(pactl get-default-sink 2>/dev/null || true)"
  pactl set-default-sink "$PULSE_SINK" >/dev/null 2>&1 || true
  # Laisse le temps à PipeWire de propager le nouveau sink par défaut avant
  # que cpal n'ouvre le périphérique "default".
  sleep 0.2
fi

restore_sink() {
  if [[ -n "$original_sink" ]]; then
    pactl set-default-sink "$original_sink" >/dev/null 2>&1 || true
  fi
}
trap restore_sink EXIT

"$BIN" "$@"
