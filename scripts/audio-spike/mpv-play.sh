#!/usr/bin/env bash
# Moteur de comparaison "mpv" du spike GAO-spike-moteur-001 (ADR-012).
#
# Joue une suite de fichiers WAV enchaînés sans blanc via
# `mpv --gapless-audio=yes`, pilotable par IPC JSON (pause/reprise/position),
# sur Fedora/Wayland/PipeWire.
#
# Usage :
#   scripts/audio-spike/mpv-play.sh <wav>... [--pause-at MS --resume-after MS]
#
# La position est imprimée sur stderr toutes les ~50 ms, au même format que
# `llm-voice-audio-play` : `position_ms=... total_ms=... state=...`.
#
# Ciblage du sink : `--audio-device=pipewire/<sink>` a été essayé en premier
# (ciblage direct, comme `pw-play --target`, sans toucher au sink par
# défaut) mais mesuré non fiable ici : le sink nul de `prove.sh` vient
# d'être créé juste avant l'appel à ce script, et mpv énumère ses
# périphériques une seule fois au démarrage — le nœud PipeWire n'est pas
# toujours visible à temps, et mpv retombe silencieusement (aucune erreur
# dans son log) sur le périphérique par défaut, donc sur le mauvais sink
# (mesuré : WER 0,81 et 92 % de silence sur la capture, alors que la
# position rapportée par mpv progressait normalement jusqu'à la fin).
# Ce script bascule donc le **sink par défaut PipeWire** vers `$PULSE_SINK`
# le temps de la lecture, comme `rust-play.sh` — même limitation
# documentée là-bas pour `cpal`.
#
# Chemin du socket IPC : ce build mpv (Fedora, `mpv-0.41.0-5.fc44`) réécrit
# tout `--input-ipc-server` fourni vers `/tmp/mpvSockets/<pid-mpv>` (constaté
# par `mpv -v`, ligne "Set property: options/input-ipc-server=..." ; aucune
# trace dans /etc/mpv/, donc un correctif du paquet, pas une conf locale). Ce
# script se connecte donc au chemin réel, pas à celui qu'il a demandé.
#
# Position absolue multi-pistes : `playback-time`/`duration` de l'IPC mpv ne
# portent que sur la piste en cours (mpv ne connaît pas d'offset "playlist"
# tout fait). Ce script précalcule la durée de chaque WAV avec `soxi` et
# ajoute la position dans la piste courante à la somme des pistes déjà
# jouées (`playlist-pos`), pour retrouver une position absolue comparable à
# celle du moteur Rust.
set -euo pipefail

original_sink=""
if [[ -n "${PULSE_SINK:-}" ]]; then
  original_sink="$(pactl get-default-sink 2>/dev/null || true)"
  pactl set-default-sink "$PULSE_SINK" >/dev/null 2>&1 || true
  sleep 0.2
fi
restore_sink() {
  if [[ -n "$original_sink" ]]; then
    pactl set-default-sink "$original_sink" >/dev/null 2>&1 || true
  fi
}
trap restore_sink EXIT

wavs=()
pause_at_ms=""
resume_after_ms=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pause-at)
      pause_at_ms="$2"
      shift 2
      ;;
    --resume-after)
      resume_after_ms="$2"
      shift 2
      ;;
    *)
      wavs+=("$1")
      shift
      ;;
  esac
done

if [[ ${#wavs[@]} -eq 0 ]]; then
  echo "erreur: aucun fichier WAV fourni" >&2
  exit 1
fi

durations_ms=()
total_ms=0
for wav in "${wavs[@]}"; do
  d="$(soxi -D "$wav" 2>/dev/null || echo 0)"
  ms=$(python3 -c "print(int(float(\"$d\") * 1000))")
  durations_ms+=("$ms")
  total_ms=$((total_ms + ms))
done

mpv --no-video --gapless-audio=yes --idle=no \
  --input-ipc-server=/tmp/llm-voice-mpv-ipc-hint \
  "${wavs[@]}" >/tmp/llm-voice-mpv.log 2>&1 &
mpv_pid=$!

socket="/tmp/mpvSockets/${mpv_pid}"
for _ in $(seq 1 100); do
  [[ -S "$socket" ]] && break
  sleep 0.02
done
if [[ ! -S "$socket" ]]; then
  echo "erreur: socket IPC mpv introuvable ($socket)" >&2
  kill "$mpv_pid" 2>/dev/null || true
  exit 1
fi

ipc() {
  # $1 = requête JSON, imprime la réponse JSON sur stdout.
  printf '%s\n' "$1" | timeout 1 socat - "UNIX-CONNECT:${socket}" 2>/dev/null || true
}

get_prop() {
  ipc "{\"command\":[\"get_property\",\"$1\"]}" | python3 -c "
import sys, json
for line in sys.stdin:
    try:
        d = json.loads(line)
    except json.JSONDecodeError:
        continue
    if 'data' in d and d.get('error') == 'success':
        print(d['data'])
        break
"
}

set_pause() {
  ipc "{\"command\":[\"set_property\",\"pause\",$1]}" >/dev/null
}

start_epoch_ms=$(($(date +%s%N) / 1000000))
paused_once=0
resumed_once=0

while kill -0 "$mpv_pid" 2>/dev/null; do
  now_ms=$(($(date +%s%N) / 1000000))
  elapsed_ms=$((now_ms - start_epoch_ms))

  playback_time="$(get_prop playback-time || true)"
  playlist_pos="$(get_prop playlist-pos || echo 0)"
  idle="$(get_prop idle-active || echo false)"

  track_ms=0
  if [[ -n "$playback_time" && "$playback_time" != "null" ]]; then
    track_ms=$(python3 -c "print(int(float(\"$playback_time\") * 1000))" 2>/dev/null || echo 0)
  fi
  prior_ms=0
  if [[ -n "$playlist_pos" && "$playlist_pos" != "null" && "$playlist_pos" -gt 0 ]] 2>/dev/null; then
    for ((i = 0; i < playlist_pos; i++)); do
      prior_ms=$((prior_ms + durations_ms[i]))
    done
  fi
  position_ms=$((prior_ms + track_ms))

  echo "position_ms=${position_ms} total_ms=${total_ms} state=playing" >&2

  if [[ -n "$pause_at_ms" && "$paused_once" -eq 0 && "$elapsed_ms" -ge "$pause_at_ms" ]]; then
    set_pause true
    paused_once=1
    echo "pause_ms=${position_ms}" >&2
  fi

  if [[ -n "$pause_at_ms" && -n "$resume_after_ms" && "$paused_once" -eq 1 && "$resumed_once" -eq 0 ]]; then
    resume_at_ms=$((pause_at_ms + resume_after_ms))
    if [[ "$elapsed_ms" -ge "$resume_at_ms" ]]; then
      set_pause false
      resumed_once=1
      echo "resume_ms=${position_ms}" >&2
    fi
  fi

  if [[ "$idle" == "True" || "$idle" == "true" ]]; then
    echo "ended position_ms=${position_ms}" >&2
    break
  fi

  sleep 0.05
done

wait "$mpv_pid" 2>/dev/null || true
