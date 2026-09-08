#!/usr/bin/env bash
# Downloads the configured Piper voice into /models on first start (never
# baked into the image, cf. shared-context.md invariant #5). Subsequent
# starts are fully offline: skip re-download if both files already exist.
set -euo pipefail

VOICE="${PIPER_VOICE:-fr_FR-siwis-medium}"
MODELS_DIR="${PIPER_MODELS_DIR:-/models}"

if [[ "$VOICE" != "fr_FR-siwis-medium" ]]; then
  echo "[piper] PIPER_VOICE='$VOICE' is not the built-in default (fr_FR-siwis-medium)." >&2
  echo "[piper] Only that voice is auto-downloaded; place ${VOICE}.onnx(.json) in $MODELS_DIR yourself." >&2
fi
BASE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/siwis/medium"

mkdir -p "$MODELS_DIR"

onnx="$MODELS_DIR/${VOICE}.onnx"
config="$MODELS_DIR/${VOICE}.onnx.json"

if [[ -f "$onnx" && -f "$config" ]]; then
  echo "[piper] voice '$VOICE' already present, no network call." >&2
elif [[ "$VOICE" == "fr_FR-siwis-medium" ]]; then
  echo "[piper] downloading voice '$VOICE' into $MODELS_DIR (one-time)..." >&2
  curl -fsSL -o "$onnx" "$BASE_URL/${VOICE}.onnx"
  curl -fsSL -o "$config" "$BASE_URL/${VOICE}.onnx.json"
else
  echo "[piper] voice '$VOICE' missing in $MODELS_DIR and not auto-downloadable, server will 404 on synth." >&2
fi

exec python3 /app/server.py
