#!/usr/bin/env bash
# Lecture d'un WAV par le démon `llm-voice-core` (GAO-core-rust-mi-001,
# ADR-012), pensé pour `scripts/audio-proof/prove.sh --play-cmd`.
#
# Déroulé : lance le Core, lit son fichier d'état `core.json` (port, jeton,
# PID), ouvre le WebSocket d'événements (curl ≥ 7.86, protocole ws), enfile
# `$LLM_VOICE_AUDIO_PROOF_WAV` (POST /v1/enqueue), joue (POST /v1/play),
# attend l'événement `ended` (émis après vidange du périphérique, CL-004),
# puis arrête le Core par SIGTERM. Le jeton ne passe jamais sur la ligne de
# commande d'un processus : il est lu dans core.json et envoyé par stdin à
# curl (`--data @-`) ; seule l'URL WS le porte en paramètre (curl local,
# processus éphémère — limite documentée dans l'evidence-pack).
#
# Même détour de sink que `rust-play.sh` : cpal (ALSA via pipewire-alsa)
# ouvre le périphérique "default" ; si `PULSE_SINK` est défini, le sink par
# défaut PipeWire est basculé dessus le temps de la lecture puis restauré.
#
# Toute la trace va sur stderr : `prove.sh` réserve stdout à son JSON.
#
# Usage :
#   LLM_VOICE_AUDIO_PROOF_WAV=<wav> [PULSE_SINK=<sink>] scripts/audio-spike/core-play.sh
#   scripts/audio-spike/core-play.sh <wav>
# Codes : 0 `ended` reçu ; 1 échec de lecture ; 2 erreur d'environnement.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BIN="$REPO_ROOT/target/release/llm-voice-core"
WAV="${LLM_VOICE_AUDIO_PROOF_WAV:-${1:-}}"
log() { echo "core-play: $*" >&2; }

[[ -n "$WAV" && -f "$WAV" ]] || { log "WAV introuvable : '${WAV}'"; exit 2; }
[[ -x "$BIN" ]] || { log "binaire absent ($BIN). Lance : cargo build --release -p llm-voice-core"; exit 2; }
for bin in curl jq; do
  command -v "$bin" >/dev/null 2>&1 || { log "binaire requis introuvable : $bin"; exit 2; }
done

WAV="$(realpath "$WAV")"
export LLM_VOICE_CACHE_DIR="$(dirname "$WAV")"
STATE_DIR="${LLM_VOICE_CORE_STATE_DIR:-${XDG_RUNTIME_DIR:?XDG_RUNTIME_DIR requis}/llm-voice}"
STATE_FILE="$STATE_DIR/core.json"
WORK="$(mktemp -d)"
EVENTS="$WORK/events.jsonl"
core_pid=""
ws_pid=""
original_sink=""

cleanup() {
  [[ -n "$ws_pid" ]] && kill "$ws_pid" 2>/dev/null || true
  if [[ -n "$core_pid" ]] && kill -0 "$core_pid" 2>/dev/null; then
    kill -TERM "$core_pid" 2>/dev/null || true
    wait "$core_pid" 2>/dev/null || true
  fi
  [[ -n "$original_sink" ]] && pactl set-default-sink "$original_sink" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

if [[ -n "${PULSE_SINK:-}" ]]; then
  original_sink="$(pactl get-default-sink 2>/dev/null || true)"
  pactl set-default-sink "$PULSE_SINK" >/dev/null 2>&1 || true
  # WirePlumber mémorise la cible par nom d'application (module
  # stream-restore) : un flux « llm-voice-core » déjà joué sur les
  # haut-parleurs y serait renvoyé malgré le sink par défaut (mesuré :
  # capture muette, rms 0). Parade identique à prove.sh : cible explicite,
  # nom de nœud inédit, `node.dont-move`, lus par pipewire-alsa.
  export PIPEWIRE_NODE="$PULSE_SINK"
  export PIPEWIRE_PROPS="{ node.name = llm-voice-core-proof application.name = llm-voice-core-proof target.object = $PULSE_SINK node.dont-move = true }"
  sleep 0.2
fi

"$BIN" 2>"$WORK/core.log" &
core_pid=$!

for _ in $(seq 1 200); do
  if [[ -f "$STATE_FILE" ]] && [[ "$(jq -r .pid "$STATE_FILE" 2>/dev/null)" == "$core_pid" ]]; then break; fi
  kill -0 "$core_pid" 2>/dev/null || { log "le Core s'est arrêté : $(cat "$WORK/core.log")"; core_pid=""; exit 1; }
  sleep 0.05
done
[[ "$(jq -r .pid "$STATE_FILE" 2>/dev/null)" == "$core_pid" ]] || { log "core.json jamais publié"; exit 1; }
PORT="$(jq -r .port "$STATE_FILE")"
TOKEN="$(jq -r .token "$STATE_FILE")"
log "Core pid=$core_pid port=$PORT état=$STATE_FILE (mode $(stat -c %a "$STATE_FILE"))"

curl -sN "ws://127.0.0.1:$PORT/v1/ws?token=$TOKEN" >"$EVENTS" 2>"$WORK/ws.log" &
ws_pid=$!
for _ in $(seq 1 100); do [[ -s "$EVENTS" ]] && break; sleep 0.05; done
[[ -s "$EVENTS" ]] || { log "WebSocket muet"; exit 1; }

post() {
  jq -nc --arg t "$TOKEN" --argjson extra "$2" '{protocolVersion:"1.0", token:$t} + $extra' \
    | curl -s -X POST -H 'Content-Type: application/json' --data @- "http://127.0.0.1:$PORT/v1/$1"
}

ack="$(post enqueue "$(jq -nc --arg p "$WAV" '{segmentId:"proof-0001", path:$p, format:"wav"}')")"
log "enqueue → $ack"
[[ "$(jq -r .ok <<<"$ack")" == "true" ]] || exit 1
ack="$(post play '{}')"
log "play → $ack"
[[ "$(jq -r .ok <<<"$ack")" == "true" ]] || exit 1

duration_s="$(jq -nr --argjson b "$(stat -c %s "$WAV")" '($b / 22050 / 2) | ceil')"
deadline=$(( SECONDS + duration_s + 30 ))
while (( SECONDS < deadline )); do
  if grep -q '"type":"ended"' "$EVENTS"; then
    ended="$(grep -o '{"protocolVersion":"1.0","type":"ended"[^}]*}' "$EVENTS" | head -1)"
    log "ended → $ended"
    grep -h 'latence' "$WORK/core.log" >&2 || true
    log "événements reçus : $(grep -o '"type":"[a-z_]*"' "$EVENTS" | sort | uniq -c | tr -s ' ' | tr '\n' ';')"
    exit 0
  fi
  sleep 0.05
done
log "ended jamais reçu ; événements : $(cat "$EVENTS")"
exit 1
