#!/usr/bin/env bash
# Smoke test d'un VSIX packagé avec le Core natif (ADR-012 §7,
# GAO-s1-fedora-pa-001) : extrait le paquet, lance le binaire embarqué dans
# un environnement isolé, interroge /health avec le jeton publié dans
# core.json, vérifie protocolVersion == "1.0", puis arrête le Core.
#
# Usage : scripts/smoke-core-vsix.sh <chemin-vsix> [cible]
#   <cible> par défaut : linux-x64 (seule cible packagée à ce stade, S1).
#
# Codes de sortie : 0 succès ; non nul sinon (voir messages sur stderr).
set -euo pipefail

log() { echo "smoke-core-vsix: $*" >&2; }
fail() { log "ÉCHEC — $*"; exit 1; }

VSIX="${1:-}"
TARGET="${2:-linux-x64}"
[[ -n "$VSIX" ]] || fail "usage : $0 <chemin-vsix> [cible]"
[[ -f "$VSIX" ]] || fail "VSIX introuvable : $VSIX"
VSIX="$(realpath "$VSIX")"

for bin in unzip curl jq; do
  command -v "$bin" >/dev/null 2>&1 || fail "binaire requis introuvable : $bin"
done

case "$TARGET" in
  win32-*) BINARY_NAME="llm-voice-core.exe" ;;
  *) BINARY_NAME="llm-voice-core" ;;
esac

WORK="$(mktemp -d)"
core_pid=""

cleanup() {
  if [[ -n "$core_pid" ]] && kill -0 "$core_pid" 2>/dev/null; then
    kill -TERM "$core_pid" 2>/dev/null || true
    wait "$core_pid" 2>/dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

log "extraction de $VSIX dans $WORK/extracted"
mkdir -p "$WORK/extracted"
unzip -q "$VSIX" -d "$WORK/extracted"

BIN="$WORK/extracted/extension/bin/$TARGET/$BINARY_NAME"
[[ -f "$BIN" ]] || fail "binaire absent du VSIX : extension/bin/$TARGET/$BINARY_NAME"
[[ -x "$BIN" ]] || fail "binaire non exécutable : $BIN"

# Environnement isolé : jamais le XDG_RUNTIME_DIR ni le cache réel de
# l'utilisateur (repris de scripts/audio-spike/core-play.sh).
export XDG_RUNTIME_DIR="$WORK/runtime"
mkdir -p "$XDG_RUNTIME_DIR"
export LLM_VOICE_CACHE_DIR="$WORK/cache"
mkdir -p "$LLM_VOICE_CACHE_DIR"
STATE_FILE="$XDG_RUNTIME_DIR/llm-voice/core.json"

log "lancement de $BIN"
"$BIN" >"$WORK/core.log" 2>&1 &
core_pid=$!

deadline=$((SECONDS + 5))
while [[ ! -f "$STATE_FILE" ]]; do
  if ! kill -0 "$core_pid" 2>/dev/null; then
    cat "$WORK/core.log" >&2 || true
    fail "le Core s'est arrêté avant de publier $STATE_FILE"
  fi
  if (( SECONDS >= deadline )); then
    fail "délai dépassé (5 s) en attendant $STATE_FILE"
  fi
  sleep 0.05
done

PORT="$(jq -r '.port' "$STATE_FILE")"
TOKEN="$(jq -r '.token' "$STATE_FILE")"
[[ -n "$PORT" && "$PORT" != "null" ]] || fail "port absent de $STATE_FILE"
[[ -n "$TOKEN" && "$TOKEN" != "null" ]] || fail "jeton absent de $STATE_FILE"

log "interrogation de /health sur 127.0.0.1:$PORT"
HEALTH_JSON="$(curl -sf --max-time 2 \
  -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:$PORT/health")" || fail "GET /health a échoué"

PROTOCOL_VERSION="$(echo "$HEALTH_JSON" | jq -r '.protocolVersion')"
STATUS="$(echo "$HEALTH_JSON" | jq -r '.status')"
[[ "$PROTOCOL_VERSION" == "1.0" ]] || fail "protocolVersion attendu 1.0, reçu '$PROTOCOL_VERSION' ($HEALTH_JSON)"
[[ "$STATUS" == "ok" ]] || fail "status attendu ok, reçu '$STATUS' ($HEALTH_JSON)"

log "arrêt du Core (SIGTERM, PID $core_pid)"
kill -TERM "$core_pid"
wait "$core_pid" 2>/dev/null
exit_code=$?
core_pid=""
[[ "$exit_code" -eq 0 ]] || fail "le Core n'a pas rendu 0 après SIGTERM (reçu $exit_code)"
[[ ! -f "$STATE_FILE" ]] || fail "$STATE_FILE aurait dû être retiré à l'arrêt propre"

log "SUCCÈS — protocolVersion=1.0, /health ok, arrêt propre"
exit 0
