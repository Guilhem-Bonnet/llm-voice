#!/usr/bin/env bash
# prove.sh — banc de preuve audio sans oreille humaine (Fedora/Wayland/PipeWire).
#
# Usage :
#   scripts/audio-proof/prove.sh <fichier.wav> --expect "phrase attendue" [options]
#   scripts/audio-proof/prove.sh <fichier.wav> --expect "phrase" \
#       --play-cmd "node dist/play.js --file \$LLM_VOICE_AUDIO_PROOF_WAV" [options]
#
# Crée un sink PulseAudio/PipeWire nul, capture son moniteur, joue le WAV
# (ou exécute --play-cmd, qui DOIT jouer sur le sink via la variable
# d'environnement PULSE_SINK exportée par ce script), transcrit avec
# faster-whisper et calcule le WER normalisé + le plus long silence interne.
# Le sink est toujours détruit (trap), même en cas d'échec.
#
# Options :
#   --expect "phrase"     phrase attendue (obligatoire)
#   --play-cmd "cmd"      commande de lecture custom (sinon : pw-play ciblé sur le sink, cf. note ci-dessous)
#   --sink NAME           nom du sink nul (défaut : llmvoice_test)
#   --threshold N          WER max toléré, 0..1 (défaut : 0.25, documenté ci-dessous)
#   --lang XX              langue faster-whisper (défaut : fr)
#   --model NAME           modèle faster-whisper (défaut : small)
#   --pre-roll SECONDS     avance de capture avant lecture (défaut : 0.7, prouvé le 2026-09-27)
#   --post-roll SECONDS    attente après la fin de la lecture avant d'arrêter la capture (défaut : 1.0)
#   --keep-capture         ne supprime pas le WAV de capture temporaire
#
# Lecture par défaut — pourquoi pw-play et pas paplay : sur une machine où
# PipeWire a une règle "module-stream-restore" mémorisée par nom de
# processus (`sink-input-by-application-name:paplay`), `paplay -d <sink>`
# se fait rerouter en cours de lecture vers un autre sink par WirePlumber,
# malgré le `-d` explicite (mesuré : `pw-link -l` montre le flux relié à un
# autre sink, jamais au nôtre). Fixe en donnant au flux un `node.name`
# inédit et `node.dont-move=true` :
#   pw-play --target "$SINK" -P '{ node.name = "llm-voice-audio-proof" node.dont-move = true }' fichier.wav
# `--play-cmd` reste utile pour tester l'app réelle ; si elle appelle
# `paplay` en interne et qu'un rerouting inattendu apparaît sur une machine
# donnée, appliquer la même parade (nom de flux dédié + `node.dont-move`).
#
# Fidélité du bouclage — le sink nul et `parecord` sont créés au format natif
# du WAV joué (fréquence et canaux détectés via `soxi`) pour éviter un
# ré-échantillonnage superflu qui dégrade la reconnaissance (mesuré : WER
# ~0,44 en 48 kHz stéréo forcé contre ~0,11 au format natif sur la même
# phrase). Sans `soxi` disponible ou avec `--play-cmd`, repli sur 48000 Hz /
# 2 canaux.
#
# Seuil WER : 0.25 est proposé comme seuil par défaut (une erreur de mot sur
# quatre tolérée) car faster-whisper/small sur une capture bouclée en local
# introduit occasionnellement de petites variantes de ponctuation/liaison une
# fois le texte normalisé ; à resserrer si le banc devient un gate strict.
#
# Sortie : un objet JSON sur stdout (wer, transcription, duration_s,
# silence_max_ms, rms, silent, wer_ok, pass) ; code de sortie 0 si wer <= seuil
# ET signal non silencieux, non nul sinon (1 = échec de preuve, 2 = erreur
# d'exécution du banc lui-même).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${LLM_VOICE_AUDIO_PROOF_VENV:-$HOME/.llm-voice/tools/audio-proof-venv}"
PYTHON_BIN="$VENV_DIR/bin/python"

SINK="llmvoice_test"
EXPECT=""
PLAY_CMD=""
THRESHOLD="0.25"
LANG="fr"
MODEL="small"
DEVICE="cpu"
COMPUTE_TYPE="int8"
PRE_ROLL="0.7"
POST_ROLL="1.0"
KEEP_CAPTURE="0"
WAV=""

usage() {
  sed -n '2,48p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --expect) EXPECT="$2"; shift 2 ;;
    --play-cmd) PLAY_CMD="$2"; shift 2 ;;
    --sink) SINK="$2"; shift 2 ;;
    --threshold) THRESHOLD="$2"; shift 2 ;;
    --lang) LANG="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --device) DEVICE="$2"; shift 2 ;;
    --compute-type) COMPUTE_TYPE="$2"; shift 2 ;;
    --pre-roll) PRE_ROLL="$2"; shift 2 ;;
    --post-roll) POST_ROLL="$2"; shift 2 ;;
    --keep-capture) KEEP_CAPTURE="1"; shift ;;
    -h|--help) usage; exit 0 ;;
    *)
      if [ -z "$WAV" ]; then WAV="$1"; shift; else
        echo "prove.sh: argument inattendu : $1" >&2; exit 2
      fi
      ;;
  esac
done

if [ -z "$WAV" ] || [ -z "$EXPECT" ]; then
  echo "prove.sh: usage : prove.sh <fichier.wav> --expect \"phrase\" [options]" >&2
  exit 2
fi
if [ -z "$PLAY_CMD" ] && [ ! -f "$WAV" ]; then
  echo "prove.sh: fichier introuvable : $WAV" >&2
  exit 2
fi
if [ ! -x "$PYTHON_BIN" ]; then
  echo "prove.sh: venv absent ($VENV_DIR). Lance d'abord scripts/audio-proof/setup.sh" >&2
  exit 2
fi
for bin in pactl parecord; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "prove.sh: binaire requis introuvable : $bin" >&2
    exit 2
  fi
done
if [ -z "$PLAY_CMD" ] && ! command -v pw-play >/dev/null 2>&1; then
  echo "prove.sh: binaire requis introuvable : pw-play (paquet pipewire-utils)" >&2
  exit 2
fi

# Format natif du WAV joué, pour éviter un ré-échantillonnage qui dégrade la
# reconnaissance (cf. note en tête de fichier) ; repli 48000 Hz / 2 canaux.
SINK_RATE="48000"
SINK_CHANNELS="2"
if [ -f "$WAV" ] && command -v soxi >/dev/null 2>&1; then
  SINK_RATE="$(soxi -r "$WAV" 2>/dev/null || echo 48000)"
  SINK_CHANNELS="$(soxi -c "$WAV" 2>/dev/null || echo 2)"
fi

CAPTURE_FILE="$(mktemp --suffix=.wav "/tmp/llm-voice-audio-proof.XXXXXX")"
MODULE_ID=""
RECORD_PID=""

cleanup() {
  set +e
  if [ -n "$RECORD_PID" ] && kill -0 "$RECORD_PID" 2>/dev/null; then
    kill "$RECORD_PID" 2>/dev/null
    wait "$RECORD_PID" 2>/dev/null
  fi
  if [ -n "$MODULE_ID" ]; then
    pactl unload-module "$MODULE_ID" 2>/dev/null
  fi
  if [ "$KEEP_CAPTURE" != "1" ]; then
    rm -f "$CAPTURE_FILE"
  fi
}
trap cleanup EXIT INT TERM

MODULE_ID="$(pactl load-module module-null-sink sink_name="$SINK" \
  rate="$SINK_RATE" format=s16le channels="$SINK_CHANNELS" 2>/dev/null)"
if [ -z "$MODULE_ID" ]; then
  echo "prove.sh: échec de création du sink nul $SINK" >&2
  exit 2
fi

parecord -d "${SINK}.monitor" --file-format=wav \
  --rate="$SINK_RATE" --channels="$SINK_CHANNELS" "$CAPTURE_FILE" &
RECORD_PID=$!

sleep "$PRE_ROLL"

if [ -n "$PLAY_CMD" ]; then
  PULSE_SINK="$SINK" LLM_VOICE_AUDIO_PROOF_WAV="$WAV" bash -c "$PLAY_CMD"
else
  # pw-play (pas paplay) : voir la note en tête de fichier sur
  # module-stream-restore qui reroute paplay par nom de processus.
  pw-play --target "$SINK" \
    -P '{ node.name = "llm-voice-audio-proof" node.dont-move = true }' \
    "$WAV"
fi

sleep "$POST_ROLL"

kill "$RECORD_PID" 2>/dev/null || true
wait "$RECORD_PID" 2>/dev/null || true
RECORD_PID=""

pactl unload-module "$MODULE_ID" 2>/dev/null || true
MODULE_ID=""

set +e
RESULT_JSON="$("$PYTHON_BIN" "$SCRIPT_DIR/analyze.py" \
  --audio "$CAPTURE_FILE" \
  --expect "$EXPECT" \
  --lang "$LANG" \
  --model "$MODEL" \
  --device "$DEVICE" \
  --compute-type "$COMPUTE_TYPE" \
  --threshold "$THRESHOLD")"
ANALYZE_EXIT=$?
set -e

echo "$RESULT_JSON"
exit "$ANALYZE_EXIT"
