#!/usr/bin/env bash
# Mesure comparative du spike GAO-spike-moteur-001 (ADR-012) : moteur Rust
# (`llm-voice-audio-play`) contre mpv, sur le banc de preuve audio
# (`scripts/audio-proof/prove.sh`), avec 3 phrases Piper FR enchaînées.
#
# Écrit un JSON par moteur sous $OUT_DIR (défaut : répertoire courant) et un
# résumé sur stdout. Ne modifie rien hors /tmp et $OUT_DIR.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="${OUT_DIR:-$(pwd)}"
WORK_DIR="$(mktemp -d /tmp/llm-voice-spike-measure.XXXXXX)"

P1="Bonjour, je suis la voix de test du spike."
P2="Cette phrase mesure la jonction entre deux fichiers."
P3="Dernière phrase pour vérifier la position et la reprise."
EXPECT="$P1 $P2 $P3"

echo "== génération des 3 phrases Piper (fr_FR-siwis-medium) ==" >&2
echo "$P1" | piper -m ~/.llm-voice/voices/fr_FR-siwis-medium.onnx -f "$WORK_DIR/p1.wav" >/dev/null 2>&1
echo "$P2" | piper -m ~/.llm-voice/voices/fr_FR-siwis-medium.onnx -f "$WORK_DIR/p2.wav" >/dev/null 2>&1
echo "$P3" | piper -m ~/.llm-voice/voices/fr_FR-siwis-medium.onnx -f "$WORK_DIR/p3.wav" >/dev/null 2>&1
sox "$WORK_DIR/p1.wav" "$WORK_DIR/p2.wav" "$WORK_DIR/p3.wav" "$WORK_DIR/reference.wav"

cargo build --release -p llm-voice-audio --manifest-path "$REPO_ROOT/Cargo.toml" >&2

PAUSE_AT=2000
RESUME_AFTER=1500

analyze_log() {
  # $1 = fichier de log stderr du moteur, $2 = wall-clock de lancement (ms epoch)
  local log="$1"
  local start_ms="$2"
  python3 - "$log" "$start_ms" "$PAUSE_AT" "$RESUME_AFTER" <<'PYEOF'
import re, sys
log, start_ms, pause_at, resume_after = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
positions = []
pause_pos = None
resume_pos = None
first_nonzero_line_idx = None
with open(log) as f:
    lines = f.readlines()
for i, line in enumerate(lines):
    m = re.search(r"position_ms=(\d+)", line)
    if m:
        val = int(m.group(1))
        positions.append(val)
        if val > 0 and first_nonzero_line_idx is None:
            first_nonzero_line_idx = i
    if line.startswith("pause_ms="):
        pause_pos = int(line.strip().split("=")[1])
    if line.startswith("resume_ms="):
        resume_pos = int(line.strip().split("=")[1])
last_position_ms = max(positions) if positions else None
startup_latency_estimate_polls = first_nonzero_line_idx if first_nonzero_line_idx is not None else None
resume_ok = None
if pause_pos is not None and resume_pos is not None:
    # La position ne doit pas avoir bougé de plus d'un pas de sondage (~80ms)
    # pendant la pause : reprise fidèle si l'écart est petit.
    resume_ok = abs(resume_pos - pause_pos) <= 100
print(f"last_position_ms={last_position_ms}")
print(f"pause_position_ms={pause_pos}")
print(f"resume_position_ms={resume_pos}")
print(f"resume_ok={resume_ok}")
print(f"first_nonzero_poll_index={startup_latency_estimate_polls}")
PYEOF
}

measure_engine() {
  local name="$1"
  local play_cmd="$2"
  local log="$WORK_DIR/${name}.log"
  echo "== mesure $name ==" >&2
  local start_ms
  start_ms=$(($(date +%s%N) / 1000000))
  local json
  set +e
  json="$(bash "$REPO_ROOT/scripts/audio-proof/prove.sh" "$WORK_DIR/reference.wav" \
    --expect "$EXPECT" \
    --sink "llmvoice_spike_${name}" \
    --play-cmd "$play_cmd" 2>"$WORK_DIR/${name}.prove.stderr")"
  local exit_code=$?
  set -e
  echo "$json" >"$OUT_DIR/${name}.prove.json"
  cp "$log" "$OUT_DIR/${name}.engine.log" 2>/dev/null || true
  echo "-- prove.sh exit=$exit_code --" >&2
  echo "$json" >&2
  echo "-- analyse position/pause/reprise --" >&2
  analyze_log "$log" "$start_ms" | tee "$OUT_DIR/${name}.position-analysis.txt" >&2
}

# Passe 1 : lecture continue sans pause, pour mesurer le blanc de jonction
# naturel entre phrases et le WER sans contamination par un silence injecté.
measure_engine "rust-nopause" \
  "$REPO_ROOT/scripts/audio-spike/rust-play.sh $WORK_DIR/p1.wav $WORK_DIR/p2.wav $WORK_DIR/p3.wav 2>$WORK_DIR/rust-nopause.log"
measure_engine "mpv-nopause" \
  "$REPO_ROOT/scripts/audio-spike/mpv-play.sh $WORK_DIR/p1.wav $WORK_DIR/p2.wav $WORK_DIR/p3.wav 2>$WORK_DIR/mpv-nopause.log"

# Passe 2 : pause à 2000 ms puis reprise 1500 ms plus tard, pour mesurer la
# fidélité de la reprise (le silence injecté rend le WER/silence de cette
# passe non comparables à la passe 1, attendu).
measure_engine "rust-pause" \
  "$REPO_ROOT/scripts/audio-spike/rust-play.sh $WORK_DIR/p1.wav $WORK_DIR/p2.wav $WORK_DIR/p3.wav --pause-at $PAUSE_AT --resume-after $RESUME_AFTER 2>$WORK_DIR/rust-pause.log"
measure_engine "mpv-pause" \
  "$REPO_ROOT/scripts/audio-spike/mpv-play.sh $WORK_DIR/p1.wav $WORK_DIR/p2.wav $WORK_DIR/p3.wav --pause-at $PAUSE_AT --resume-after $RESUME_AFTER 2>$WORK_DIR/mpv-pause.log"

echo "== fichiers de travail conservés dans $WORK_DIR ==" >&2
echo "$WORK_DIR"
