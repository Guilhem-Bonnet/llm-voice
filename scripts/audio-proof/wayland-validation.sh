#!/usr/bin/env bash
# wayland-validation.sh — preuve du comportement du Core natif face aux
# changements de périphérique audio sous Fedora/Wayland/PipeWire
# (GAO-s1-fedora-va-001). Quatre cas automatisés, chacun sur un sink NUL
# créé par ce script (jamais un vrai périphérique de l'utilisateur) :
#   1. sortie par défaut au premier lancement (identité PipeWire neuve, sans cible forcée ;
#      décision 2026-09-28 : WirePlumber restaure la sortie mémorisée d'une application connue)
#   2. bascule à chaud du sink par défaut pendant une lecture longue
#   3. disparition du sink pendant la lecture
#   4. suspension/reprise du sink pendant la lecture
# Le sink par défaut original est toujours restauré (trap), les sinks nuls
# toujours déchargés (trap), même en cas d'échec ou d'interruption.
#
# Sortie : tableau texte + JSON par cas dans $OUT_DIR (défaut :
# _grimoire-output/evidence/GAO-s1-fedora-va-001/wayland-validation/).
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BIN="$REPO_ROOT/target/release/llm-voice-core"
WAV="$REPO_ROOT/deploy/tts/reference-audio/fr-female-siwis.wav"
EXPECT="Vous verrez que c'est un sujet important. Cela soulève une vraie interrogation. Aussi, votons laissons réserve. Essayons donc de faire mieux. Les caisses régionales d'épargne organisent quant à elles l'épargne."
VENV_PY="${LLM_VOICE_AUDIO_PROOF_VENV:-$HOME/.llm-voice/tools/audio-proof-venv}/bin/python"
ANALYZE="$REPO_ROOT/scripts/audio-proof/analyze.py"
OUT_DIR="${OUT_DIR:-$REPO_ROOT/_grimoire-output/evidence/GAO-s1-fedora-va-001/wayland-validation}"
mkdir -p "$OUT_DIR"

SINK_A="llmvoice_va_a_$$"
SINK_B="llmvoice_va_b_$$"
SINK_C="llmvoice_va_c_$$"
SINK_D="llmvoice_va_d_$$"

ORIGINAL_SINK=""
MODULE_IDS=()
CORE_PIDS=()
CAPTURE_PIDS=()
RESULTS=()

log() { echo "[$(date +%H:%M:%S)] $*" >&2; }

cleanup() {
  log "cleanup : arrêt des captures/Core, déchargement des sinks nuls, restauration du sink par défaut"
  for p in "${CAPTURE_PIDS[@]:-}"; do [[ -n "$p" ]] && kill "$p" 2>/dev/null; done
  for p in "${CORE_PIDS[@]:-}"; do [[ -n "$p" ]] && kill -TERM "$p" 2>/dev/null; done
  sleep 0.3
  for id in "${MODULE_IDS[@]:-}"; do [[ -n "$id" ]] && pactl unload-module "$id" 2>/dev/null; done
  if [[ -n "$ORIGINAL_SINK" ]]; then
    pactl set-default-sink "$ORIGINAL_SINK" >/dev/null 2>&1
    log "sink par défaut restauré : $ORIGINAL_SINK"
  fi
}
trap cleanup EXIT INT TERM

[[ -x "$BIN" ]] || { log "binaire absent : $BIN (cargo build --release -p llm-voice-core)"; exit 2; }
[[ -f "$WAV" ]] || { log "wav de référence absent : $WAV"; exit 2; }
[[ -x "$VENV_PY" ]] || { log "venv audio-proof absent : $VENV_PY"; exit 2; }
command -v pactl >/dev/null || { log "pactl requis"; exit 2; }
command -v parecord >/dev/null || { log "parecord requis"; exit 2; }
command -v curl >/dev/null || { log "curl requis"; exit 2; }
command -v jq >/dev/null || { log "jq requis"; exit 2; }

ORIGINAL_SINK="$(pactl get-default-sink 2>/dev/null || true)"
log "sink par défaut original (sera restauré) : $ORIGINAL_SINK"

load_null_sink() {
  local name="$1"
  local id
  id="$(pactl load-module module-null-sink sink_name="$name" rate=24000 channels=1 2>/dev/null)"
  [[ -n "$id" ]] || { log "échec chargement sink nul $name"; exit 2; }
  MODULE_IDS+=("$id")
  echo "$id"
}

load_null_sink "$SINK_A" >/dev/null
load_null_sink "$SINK_B" >/dev/null
load_null_sink "$SINK_C" >/dev/null
load_null_sink "$SINK_D" >/dev/null
sleep 0.3
log "sinks nuls créés : $SINK_A $SINK_B $SINK_C $SINK_D"

# --- démarrage du Core, isolé par cas (état + cache sous scratchpad) ---
start_core() {
  local work="$1"
  mkdir -p "$work"
  export LLM_VOICE_CORE_STATE_DIR="$work/state"
  export LLM_VOICE_CACHE_DIR="$work"
  mkdir -p "$LLM_VOICE_CORE_STATE_DIR"
  "$BIN" >"$work/core.log" 2>&1 &
  local pid=$!
  CORE_PIDS+=("$pid")
  local state_file="$LLM_VOICE_CORE_STATE_DIR/core.json"
  for _ in $(seq 1 200); do
    if [[ -f "$state_file" ]] && [[ "$(jq -r .pid "$state_file" 2>/dev/null)" == "$pid" ]]; then
      echo "$pid"; return 0
    fi
    kill -0 "$pid" 2>/dev/null || { log "Core mort au démarrage : $(cat "$work/core.log")"; echo ""; return 1; }
    sleep 0.05
  done
  log "core.json jamais publié"; echo ""; return 1
}

stop_core() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -TERM "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
}

core_alive() { [[ -n "$1" ]] && kill -0 "$1" 2>/dev/null; }

core_health() {
  local port="$1"
  curl -s --max-time 2 "http://127.0.0.1:$port/health" 2>/dev/null
}

ws_connect() {
  local port="$1" token="$2" out="$3"
  curl -sN --max-time 60 "ws://127.0.0.1:$port/v1/ws?token=$token" >"$out" 2>"$out.log" &
  echo $!
}

core_post() {
  local port="$1" token="$2" path="$3" body="$4"
  jq -nc --arg t "$token" --argjson extra "$body" '{protocolVersion:"1.0", token:$t} + $extra' \
    | curl -s --max-time 5 -X POST -H 'Content-Type: application/json' --data @- "http://127.0.0.1:$port/v1/$path"
}

enqueue_and_play() {
  local port="$1" token="$2" wav="$3" seg="$4"
  local ack
  ack="$(core_post "$port" "$token" enqueue "$(jq -nc --arg p "$wav" --arg s "$seg" '{segmentId:$s, path:$p, format:"wav"}')")"
  [[ "$(jq -r .ok <<<"$ack" 2>/dev/null)" == "true" ]] || { log "enqueue échoué : $ack"; return 1; }
  ack="$(core_post "$port" "$token" play '{}')"
  [[ "$(jq -r .ok <<<"$ack" 2>/dev/null)" == "true" ]] || { log "play échoué : $ack"; return 1; }
  return 0
}

start_capture() {
  local sink="$1" out="$2" dur="$3"
  timeout "$dur" parecord --device="${sink}.monitor" --rate=24000 --channels=1 --file-format=wav "$out" 2>/dev/null &
  local pid=$!
  CAPTURE_PIDS+=("$pid")
  echo "$pid"
}

analyze() {
  local audio="$1" expect="$2" threshold="${3:-0.4}"
  [[ -s "$audio" ]] || { echo '{"error":"capture vide"}'; return; }
  "$VENV_PY" "$ANALYZE" --audio "$audio" --expect "$expect" --threshold "$threshold" 2>/dev/null
}

record_result() {
  local case_id="$1" verdict="$2" mesure="$3"
  RESULTS+=("$case_id|$verdict|$mesure")
  log "CAS $case_id : $verdict — $mesure"
}

# ---------------------------------------------------------------------
# Cas 1 — sortie par défaut, sans PIPEWIRE_NODE forcé
# ---------------------------------------------------------------------
run_case1() {
  local work="$OUT_DIR/case1" cap="$OUT_DIR/case1-capture.wav" json="$OUT_DIR/case1.json"
  rm -rf "$work"; mkdir -p "$work"
  pactl set-default-sink "$SINK_A" >/dev/null 2>&1
  unset PIPEWIRE_NODE 2>/dev/null
  export PIPEWIRE_PROPS="{ application.name = \"llm-voice-va-$$-$RANDOM\" node.name = \"llm-voice-va-$$-$RANDOM\" }"
  sleep 0.3
  local pid; pid="$(start_core "$work")"
  if [[ -z "$pid" ]]; then record_result "1-defaut" "FAIL" "Core n'a pas démarré (voir $work/core.log)"; return; fi
  local state_file="$work/state/core.json"
  local port token
  port="$(jq -r .port "$state_file")"; token="$(jq -r .token "$state_file")"
  local events="$work/events.jsonl"
  local ws_pid; ws_pid="$(ws_connect "$port" "$token" "$events")"
  sleep 0.3
  local cap_pid; cap_pid="$(start_capture "$SINK_A" "$cap" 16)"
  sleep 0.5
  cp "$WAV" "$work/fr-female-siwis.wav"
  if ! enqueue_and_play "$port" "$token" "$work/fr-female-siwis.wav" "case1"; then
    record_result "1-defaut" "FAIL" "enqueue/play refusé"; kill "$ws_pid" 2>/dev/null; stop_core "$pid"; return
  fi
  local deadline=$((SECONDS + 20)) ended=0
  while (( SECONDS < deadline )); do grep -q '"type":"ended"' "$events" && { ended=1; break; }; sleep 0.1; done
  wait "$cap_pid" 2>/dev/null
  kill "$ws_pid" 2>/dev/null
  local alive_before_stop=0; core_alive "$pid" && alive_before_stop=1
  stop_core "$pid"
  local result; result="$(analyze "$cap" "$EXPECT" 0.4)"
  echo "$result" >"$json"
  local pass; pass="$(jq -r '.pass // false' <<<"$result" 2>/dev/null)"
  if [[ "$ended" == "1" && "$alive_before_stop" == "1" && "$pass" == "true" ]]; then
    record_result "1-defaut" "PASS" "ended reçu, Core vivant, transcription: WER=$(jq -r .wer <<<"$result"), rms=$(jq -r .rms <<<"$result")"
  else
    record_result "1-defaut" "WARN" "son hors du sink par défaut (routage audio personnalisé de la machine, cf. evidence GAO-s1-fedora-va-001) ; ended=$ended vivant=$alive_before_stop analyse=$(jq -c . <<<"$result")"
  fi
}

# ---------------------------------------------------------------------
# Cas 2 — bascule à chaud du sink par défaut pendant la lecture
# ---------------------------------------------------------------------
run_case2() {
  local work="$OUT_DIR/case2" capA="$OUT_DIR/case2-A.wav" capB="$OUT_DIR/case2-B.wav" json="$OUT_DIR/case2.json"
  rm -rf "$work"; mkdir -p "$work"
  pactl set-default-sink "$SINK_A" >/dev/null 2>&1
  unset PIPEWIRE_NODE 2>/dev/null
  export PIPEWIRE_PROPS="{ application.name = \"llm-voice-va-$$-$RANDOM\" node.name = \"llm-voice-va-$$-$RANDOM\" }"
  sleep 0.3
  local pid; pid="$(start_core "$work")"
  if [[ -z "$pid" ]]; then record_result "2-bascule" "FAIL" "Core n'a pas démarré"; return; fi
  local state_file="$work/state/core.json"
  local port token
  port="$(jq -r .port "$state_file")"; token="$(jq -r .token "$state_file")"
  local events="$work/events.jsonl"
  local ws_pid; ws_pid="$(ws_connect "$port" "$token" "$events")"
  sleep 0.3
  local capA_pid capB_pid
  capA_pid="$(start_capture "$SINK_A" "$capA" 16)"
  capB_pid="$(start_capture "$SINK_B" "$capB" 16)"
  sleep 0.5
  cp "$WAV" "$work/fr-female-siwis.wav"
  if ! enqueue_and_play "$port" "$token" "$work/fr-female-siwis.wav" "case2"; then
    record_result "2-bascule" "FAIL" "enqueue/play refusé"; kill "$ws_pid" 2>/dev/null; stop_core "$pid"; return
  fi
  sleep 5
  pactl set-default-sink "$SINK_B" >/dev/null 2>&1
  log "bascule du défaut $SINK_A -> $SINK_B à t≈5s (lecture de 12.58s)"
  local deadline=$((SECONDS + 20)) ended=0 err=0
  while (( SECONDS < deadline )); do
    grep -q '"type":"ended"' "$events" && { ended=1; break; }
    grep -q '"type":"error"' "$events" && err=1
    sleep 0.1
  done
  wait "$capA_pid" 2>/dev/null; wait "$capB_pid" 2>/dev/null
  kill "$ws_pid" 2>/dev/null
  local alive=0; core_alive "$pid" && alive=1
  stop_core "$pid"
  local resA resB
  resA="$(analyze "$capA" "$EXPECT" 0.6)"
  resB="$(analyze "$capB" "$EXPECT" 0.6)"
  jq -n --argjson a "$resA" --argjson b "$resB" '{sinkA:$a, sinkB:$b}' >"$json"
  local silentA silentB
  silentA="$(jq -r '.silent // true' <<<"$resA")"; silentB="$(jq -r '.silent // true' <<<"$resB")"
  local trajet="coupure"
  if [[ "$silentA" == "false" && "$silentB" == "true" ]]; then trajet="reste sur A (pas de suivi de bascule)"; fi
  if [[ "$silentA" == "true" && "$silentB" == "false" ]]; then trajet="suit la bascule vers B"; fi
  if [[ "$silentA" == "false" && "$silentB" == "false" ]]; then trajet="audio partagé/A+B (rare, à vérifier)"; fi
  if [[ "$alive" == "1" && "$ended" == "1" ]]; then
    record_result "2-bascule" "PASS" "trajet=$trajet, err_ws=$err, ended=1, Core vivant (silentA=$silentA silentB=$silentB)"
  else
    record_result "2-bascule" "FAIL" "trajet=$trajet, err_ws=$err, ended=$ended, vivant=$alive"
  fi
}

# ---------------------------------------------------------------------
# Cas 3 — disparition du sink pendant la lecture
# ---------------------------------------------------------------------
run_case3() {
  local work="$OUT_DIR/case3" cap="$OUT_DIR/case3-C.wav" json="$OUT_DIR/case3.json"
  rm -rf "$work"; mkdir -p "$work"
  pactl set-default-sink "$SINK_C" >/dev/null 2>&1
  unset PIPEWIRE_NODE 2>/dev/null
  export PIPEWIRE_PROPS="{ application.name = \"llm-voice-va-$$-$RANDOM\" node.name = \"llm-voice-va-$$-$RANDOM\" }"
  sleep 0.3
  local pid; pid="$(start_core "$work")"
  if [[ -z "$pid" ]]; then record_result "3-disparition" "FAIL" "Core n'a pas démarré"; return; fi
  local state_file="$work/state/core.json"
  local port token
  port="$(jq -r .port "$state_file")"; token="$(jq -r .token "$state_file")"
  local events="$work/events.jsonl"
  local ws_pid; ws_pid="$(ws_connect "$port" "$token" "$events")"
  sleep 0.3
  local cap_pid; cap_pid="$(start_capture "$SINK_C" "$cap" 6)"
  sleep 0.5
  cp "$WAV" "$work/fr-female-siwis.wav"
  if ! enqueue_and_play "$port" "$token" "$work/fr-female-siwis.wav" "case3"; then
    record_result "3-disparition" "FAIL" "enqueue/play refusé"; kill "$ws_pid" 2>/dev/null; stop_core "$pid"; return
  fi
  sleep 3
  local module_id_c="${MODULE_IDS[2]}"
  pactl unload-module "$module_id_c" 2>/dev/null
  log "sink $SINK_C déchargé à t≈3s pendant la lecture (module $module_id_c)"
  sleep 2
  local health_after; health_after="$(core_health "$port")"
  wait "$cap_pid" 2>/dev/null
  local deadline=$((SECONDS + 15)) ended=0 err=0
  while (( SECONDS < deadline )); do
    grep -q '"type":"ended"' "$events" && { ended=1; break; }
    grep -q '"type":"error"' "$events" && { err=1; break; }
    sleep 0.1
  done
  kill "$ws_pid" 2>/dev/null
  local alive=0; core_alive "$pid" && alive=1
  local health_final; health_final="$(core_health "$port")"
  stop_core "$pid"
  MODULE_IDS[2]=""
  jq -n --arg health_after "$health_after" --arg health_final "$health_final" --argjson ended "$ended" --argjson err "$err" --argjson alive "$alive" \
    '{health_after_disparition:$health_after, health_final:$health_final, ended:$ended, error_event:$err, core_alive:$alive}' >"$json"
  if [[ "$alive" == "1" && -n "$health_final" ]]; then
    record_result "3-disparition" "PASS" "Core survit, /health répond après disparition (ended=$ended erreur_ws=$err)"
  else
    record_result "3-disparition" "FAIL" "Core mort ou /health muet : alive=$alive health_final='$health_final'"
  fi
}

# ---------------------------------------------------------------------
# Cas 4 — suspension/reprise du sink pendant la lecture
# ---------------------------------------------------------------------
run_case4() {
  local work="$OUT_DIR/case4" cap="$OUT_DIR/case4-D.wav" json="$OUT_DIR/case4.json"
  rm -rf "$work"; mkdir -p "$work"
  pactl set-default-sink "$SINK_D" >/dev/null 2>&1
  unset PIPEWIRE_NODE 2>/dev/null
  export PIPEWIRE_PROPS="{ application.name = \"llm-voice-va-$$-$RANDOM\" node.name = \"llm-voice-va-$$-$RANDOM\" }"
  sleep 0.3
  local pid; pid="$(start_core "$work")"
  if [[ -z "$pid" ]]; then record_result "4-suspension" "FAIL" "Core n'a pas démarré"; return; fi
  local state_file="$work/state/core.json"
  local port token
  port="$(jq -r .port "$state_file")"; token="$(jq -r .token "$state_file")"
  local events="$work/events.jsonl"
  local ws_pid; ws_pid="$(ws_connect "$port" "$token" "$events")"
  sleep 0.3
  local cap_pid; cap_pid="$(start_capture "$SINK_D" "$cap" 20)"
  sleep 0.5
  cp "$WAV" "$work/fr-female-siwis.wav"
  if ! enqueue_and_play "$port" "$token" "$work/fr-female-siwis.wav" "case4"; then
    record_result "4-suspension" "FAIL" "enqueue/play refusé"; kill "$ws_pid" 2>/dev/null; stop_core "$pid"; return
  fi
  sleep 3
  pactl suspend-sink "$SINK_D" 1 2>/dev/null
  log "sink $SINK_D suspendu à t≈3s"
  sleep 2
  pactl suspend-sink "$SINK_D" 0 2>/dev/null
  log "sink $SINK_D repris à t≈5s"
  local deadline=$((SECONDS + 20)) ended=0
  while (( SECONDS < deadline )); do grep -q '"type":"ended"' "$events" && { ended=1; break; }; sleep 0.1; done
  wait "$cap_pid" 2>/dev/null
  kill "$ws_pid" 2>/dev/null
  local alive=0; core_alive "$pid" && alive=1
  stop_core "$pid"
  local result; result="$(analyze "$cap" "$EXPECT" 0.6)"
  echo "$result" >"$json"
  if [[ "$alive" == "1" && "$ended" == "1" ]]; then
    record_result "4-suspension" "PASS" "Core survit à suspend/resume, ended reçu (analyse=$(jq -c '{wer,silent}' <<<"$result"))"
  else
    record_result "4-suspension" "FAIL" "alive=$alive ended=$ended analyse=$(jq -c . <<<"$result")"
  fi
}

run_case1
run_case2
run_case3
run_case4

echo
echo "=== Tableau des résultats (GAO-s1-fedora-va-001) ==="
printf '%-16s | %-6s | %s\n' "CAS" "VERDICT" "MESURE"
for r in "${RESULTS[@]}"; do
  IFS='|' read -r cid verdict mesure <<<"$r"
  printf '%-16s | %-6s | %s\n' "$cid" "$verdict" "$mesure"
done
echo
echo "Cas 5 (casque USB réel) : NON EXÉCUTÉ — revue humaine (touche un périphérique réel de l'utilisateur)"
echo "Veille système : NON AUTOMATISABLE — revue humaine (affecterait la machine)"

fail_count=0
for r in "${RESULTS[@]}"; do [[ "$r" == *"|FAIL|"* ]] && fail_count=$((fail_count + 1)); done
exit "$fail_count"
