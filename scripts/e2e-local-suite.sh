#!/usr/bin/env bash
# Suite E2E locale unique (carte GAO-tests-rust-e-001) : enchaîne toutes les
# preuves du dépôt, s'arrête au premier échec, imprime un tableau récapitulatif.
#
#   bash scripts/e2e-local-suite.sh            # suite complète
#   bash scripts/e2e-local-suite.sh --quick    # saute les étapes audio/réseau
#   npm --prefix vscode-extension run e2e:local [-- --quick]
#
# NB : ne pas confondre avec scripts/e2e-local.sh (E2E Chatterbox S4.3, autre
# usage, conservé tel quel).
#
# Étapes sautées par --quick : selftest audio, validation Wayland, test réel
# Ollama, preuve native-real (sorties audio / réseau local).
# Journaux : $E2E_LOG_DIR (défaut target/e2e-local, ignoré par git). Aucune
# suppression : les journaux d'un run précédent sont simplement écrasés.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_DIR="$REPO_ROOT/vscode-extension"
LOG_DIR="${E2E_LOG_DIR:-$REPO_ROOT/target/e2e-local}"
QUICK=0
for arg in "$@"; do
  case "$arg" in
    --quick) QUICK=1 ;;
    -h|--help) sed -n '2,15p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "argument inconnu : $arg (attendu : --quick)" >&2; exit 2 ;;
  esac
done
mkdir -p "$LOG_DIR"
cd "$REPO_ROOT" || exit 2

declare -a NAMES STATUSES DURATIONS
FAILED=""

print_table() {
  echo
  printf '%-34s %-8s %8s\n' "ÉTAPE" "STATUT" "DURÉE"
  printf '%-34s %-8s %8s\n' "----------------------------------" "--------" "--------"
  local i
  for i in "${!NAMES[@]}"; do
    printf '%-34s %-8s %7ss\n' "${NAMES[$i]}" "${STATUSES[$i]}" "${DURATIONS[$i]}"
  done
  echo
  if [[ -n "$FAILED" ]]; then
    echo "ÉCHEC à l'étape : $FAILED (journal : $LOG_DIR/${FAILED_LOG:-?}.log)"
  else
    echo "TOUTES LES ÉTAPES EXÉCUTÉES SONT VERTES (quick=$QUICK)"
  fi
}
# Le tableau est imprimé quoi qu'il arrive (échec, Ctrl-C).
trap print_table EXIT
trap 'exit 130' INT TERM

# step <nom> <commande…> : exécute via bash -c, journal dédié, stoppe si échec.
step() {
  local name="$1"; shift
  local slug="${name//[^A-Za-z0-9]/_}"
  local log="$LOG_DIR/$slug.log"
  echo ">>> $name" >&2
  local t0=$SECONDS
  if bash -c "$*" >"$log" 2>&1; then
    NAMES+=("$name"); STATUSES+=("OK"); DURATIONS+=("$((SECONDS - t0))")
  else
    NAMES+=("$name"); STATUSES+=("ÉCHEC"); DURATIONS+=("$((SECONDS - t0))")
    FAILED="$name"; FAILED_LOG="$slug"
    echo "--- dernières lignes de $log" >&2
    tail -n 25 "$log" >&2
    exit 1
  fi
}

skip() {
  NAMES+=("$1"); STATUSES+=("SAUTÉ"); DURATIONS+=("0")
}

step "cargo fmt --check"        "cargo fmt --check"
step "cargo clippy -D warnings" "cargo clippy --workspace --all-targets -- -D warnings"
step "cargo test --workspace"   "cargo test --workspace"
step "build release du Core"    "cargo build --release -p llm-voice-core"
step "test:unit"                "npm --prefix '$EXT_DIR' run test:unit"
step "typecheck"                "npm --prefix '$EXT_DIR' run typecheck"
step "lint"                     "npm --prefix '$EXT_DIR' run lint"
step "intégration headless"     "cd '$EXT_DIR' && npm run build && xvfb-run -a npx vscode-test"

if (( QUICK )); then
  skip "audio-proof selftest"
else
  step "audio-proof selftest"   "bash '$REPO_ROOT/scripts/audio-proof/selftest.sh'"
fi

step "core-attack (sécurité)"   "bash '$REPO_ROOT/scripts/security/core-attack.sh'"

if (( QUICK )); then
  skip "wayland-validation"
  skip "test:integration-real"
  skip "native-real"
else
  step "wayland-validation"     "bash '$REPO_ROOT/scripts/audio-proof/wayland-validation.sh'"
  step "test:integration-real"  "cd '$EXT_DIR' && LLM_VOICE_E2E=1 LLM_VOICE_E2E_OLLAMA=1 npm run test:integration-real"
  if [[ -f "$REPO_ROOT/scripts/audio-proof/native-real.sh" ]]; then
    step "native-real"          "bash '$REPO_ROOT/scripts/audio-proof/native-real.sh'"
  else
    skip "native-real (absent)"
  fi
fi
