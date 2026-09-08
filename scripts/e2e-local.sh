#!/usr/bin/env bash
# S4.3 — real, on-machine E2E for LLM Voice's local chain (Ollama +
# Chatterbox), no mocks. Run from the repo root:
#
#   bash scripts/e2e-local.sh
#
# Assumes `docker compose -f deploy/docker-compose.tts.yml up -d chatterbox`
# is already running and healthy (deploy/README.md), and that Ollama (native
# or containerised) is reachable on OLLAMA_URL. Writes
# ~/.llm-voice/e2e/report-<date>.md — copy manually into docs/e2e/ for the
# repo (never a personal path/secret in the committed copy).
#
# NOTE (S4.3): the demo synthesis (step 4) clones the default French
# reference (docs/voices.md — predefined voices are English-accented on
# French text, docs/e2e/report-2026-09-08.md). To use your own voice
# instead (consent, CdC §55):
#   pw-record --rate 24000 --channels 1 ~/.llm-voice/voices/ma-voix.wav
#   docker cp ~/.llm-voice/voices/ma-voix.wav deploy-chatterbox-1:/app/reference_audio/
#   LLM_VOICE_E2E_REFERENCE_VOICE=ma-voix.wav bash scripts/e2e-local.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_DIR="$REPO_ROOT/vscode-extension"
OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
TTS_URL="${LLM_VOICE_E2E_TTS_URL:-http://127.0.0.1:8004}"
E2E_DIR="${HOME}/.llm-voice/e2e"
WAV_PATH="$E2E_DIR/reference.wav"
REPORT_DATE="$(date +%Y-%m-%d)"
REPORT_PATH="$E2E_DIR/report-${REPORT_DATE}.md"
REFERENCE_TEXT="Bonjour. Voici un exemple de ma voix. Nous allons maintenant examiner un concept technique et voir comment l'expliquer clairement."

mkdir -p "$E2E_DIR"

fail() { echo "[e2e] FAIL: $*" >&2; }
ok() { echo "[e2e] ok: $*"; }

status_ollama="non vérifié"
status_chatterbox="non vérifié"
status_test_integration_real="non vérifié"
status_playback="non vérifié"
ttfb_ms="non vérifié"
wav_info="non vérifié"

# --- 1. Ollama ---------------------------------------------------------
echo "[e2e] checking Ollama at $OLLAMA_URL/api/version ..."
if ollama_version="$(curl -fsS -m 5 "$OLLAMA_URL/api/version" 2>&1)"; then
  ok "Ollama: $ollama_version"
  status_ollama="ok — $ollama_version"
else
  fail "Ollama unreachable at $OLLAMA_URL ($ollama_version)"
  status_ollama="unreachable: $ollama_version"
fi

# --- 2. Chatterbox -------------------------------------------------------
# Mirrors OpenAICompatibleTtsProvider.health(): try /health first (most
# OpenAI-compatible servers), fall back to /v1/audio/voices (the one
# Chatterbox-TTS-Server actually exposes, cf. deploy/README.md).
echo "[e2e] checking Chatterbox at $TTS_URL ..."
health_body=""
health_endpoint=""
if health_body="$(curl -fsS -m 5 "$TTS_URL/health" 2>&1)"; then
  health_endpoint="/health"
elif health_body="$(curl -fsS -m 5 "$TTS_URL/v1/audio/voices" 2>&1)"; then
  health_endpoint="/v1/audio/voices"
fi
if [[ -n "$health_endpoint" ]]; then
  ok "Chatterbox: $health_endpoint -> ${health_body:0:200}"
  status_chatterbox="ok — $health_endpoint"
else
  fail "Chatterbox unreachable at $TTS_URL (tried /health, /v1/audio/voices)"
  status_chatterbox="unreachable"
fi

# --- 3. npm run test:integration-real ------------------------------------
if [[ "$status_chatterbox" == ok* ]]; then
  echo "[e2e] running npm run test:integration-real (LLM_VOICE_E2E=1) ..."
  if (cd "$EXT_DIR" && LLM_VOICE_E2E=1 LLM_VOICE_E2E_TTS_URL="$TTS_URL" npm run test:integration-real); then
    ok "test:integration-real passed"
    status_test_integration_real="pass"
  else
    fail "test:integration-real failed"
    status_test_integration_real="fail"
  fi
else
  fail "skipping test:integration-real: Chatterbox unreachable"
  status_test_integration_real="skipped (Chatterbox unreachable)"
fi

# --- 4. Reference sentence synthesis + time-to-first-byte -----------------
# Uses /tts (not /v1/audio/speech) with the validated default French
# reference (docs/voices.md, SIWIS clip mounted by deploy/docker-compose.tts.yml
# at /app/reference_audio/fr-female-siwis.wav) and the parameters kept after
# user validation (S4.3, 2026-09-08): exaggeration=0.4, cfg_weight=0.5,
# temperature=0.6. /v1/audio/speech ignores `language` on this server (see
# shared-context.md "Requêtes inter-agents") and has no clone support — this
# is what a user should actually hear, not the raw OpenAI-compatible
# contract (already covered separately by npm run test:integration-real).
REFERENCE_VOICE_FILE="${LLM_VOICE_E2E_REFERENCE_VOICE:-fr-female-siwis.wav}"
if [[ "$status_chatterbox" == ok* ]]; then
  echo "[e2e] synthesizing reference sentence (voice clone: $REFERENCE_VOICE_FILE) -> $WAV_PATH ..."
  start_ns=$(date +%s%N)
  http_code="$(curl -s -o "$WAV_PATH" -w '%{http_code}' \
    -X POST "$TTS_URL/tts" \
    -H 'content-type: application/json' \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1], "voice_mode": "clone", "reference_audio_filename": sys.argv[2], "language": "fr", "exaggeration": 0.4, "cfg_weight": 0.5, "temperature": 0.6, "output_format": "wav"}))' "$REFERENCE_TEXT" "$REFERENCE_VOICE_FILE")")"
  end_ns=$(date +%s%N)
  elapsed_ms=$(( (end_ns - start_ns) / 1000000 ))
  if [[ "$http_code" == "200" && -s "$WAV_PATH" ]]; then
    ok "synthesis: HTTP $http_code, ${elapsed_ms}ms total, $(stat -c%s "$WAV_PATH") bytes -> $WAV_PATH"
    ttfb_ms="${elapsed_ms} (temps total requête, curl ne mesure pas le premier octet séparément ici)"
    wav_info="$(file "$WAV_PATH" 2>&1 || echo "fichier présent, 'file' indisponible")"
  else
    fail "synthesis failed: HTTP $http_code"
    ttfb_ms="échec (HTTP $http_code)"
  fi
else
  fail "skipping synthesis: Chatterbox unreachable"
fi

# --- 5. Playback ----------------------------------------------------------
if [[ -s "$WAV_PATH" ]]; then
  if command -v paplay >/dev/null 2>&1; then
    echo "[e2e] playing $WAV_PATH via paplay ..."
    if paplay "$WAV_PATH"; then status_playback="played via paplay"; else status_playback="paplay failed"; fi
  elif command -v pw-play >/dev/null 2>&1; then
    echo "[e2e] playing $WAV_PATH via pw-play ..."
    if pw-play "$WAV_PATH"; then status_playback="played via pw-play"; else status_playback="pw-play failed"; fi
  elif command -v aplay >/dev/null 2>&1; then
    echo "[e2e] playing $WAV_PATH via aplay ..."
    if aplay "$WAV_PATH"; then status_playback="played via aplay"; else status_playback="aplay failed"; fi
  else
    status_playback="no player found (paplay/pw-play/aplay absent)"
  fi
else
  status_playback="skipped, no WAV produced"
fi

# --- 6. Report --------------------------------------------------------
{
  echo "# Rapport E2E local — $REPORT_DATE"
  echo
  echo "Généré par \`scripts/e2e-local.sh\` (S4.3)."
  echo
  echo "## Environnement"
  echo
  echo "- Noyau : $(uname -srm)"
  echo "- Docker : $(docker --version 2>&1 || echo 'non vérifié')"
  echo "- GPU : $(lspci 2>/dev/null | grep -i 'vga\|display\|3d' || echo 'non vérifié (lspci absent)')"
  echo
  echo "## Résultats"
  echo
  echo "| Vérification | Résultat |"
  echo "|---|---|"
  echo "| Ollama \`/api/version\` | $status_ollama |"
  echo "| Chatterbox health | $status_chatterbox |"
  echo "| \`npm run test:integration-real\` | $status_test_integration_real |"
  echo "| Latence synthèse (requête complète) | $ttfb_ms |"
  echo "| WAV produit | \`$WAV_PATH\` — $wav_info |"
  echo "| Lecture audio | $status_playback |"
  echo
  echo "## AC observés"
  echo
  echo "- AC-07 (voix différente par profil) : non vérifié par ce script (nécessite plusieurs profils)."
  echo "- AC-08 (prompt de narration personnalisé) : non vérifié par ce script (Ollama seul, pas de pipeline narrateur+TTS complet)."
  echo "- AC-11 (VS Code + Ollama local + Chatterbox local, sans cloud) : $( [[ "$status_ollama" == ok* && "$status_chatterbox" == ok* ]] && echo 'chaîne locale Ollama+Chatterbox confirmée joignable, VS Code non exercé par ce script' || echo 'non confirmé — voir tableau ci-dessus' )."
} > "$REPORT_PATH"

echo "[e2e] report written to $REPORT_PATH"
cat "$REPORT_PATH"
