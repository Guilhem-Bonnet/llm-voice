#!/usr/bin/env bash
#
# bootstrap-repo.sh — Idempotent bootstrap of the public GitHub repo for
# LLM Voice (Guilhem-Bonnet/llm-voice).
#
# Usage:
#   scripts/bootstrap-repo.sh --dry-run   # show what would happen, no side effects
#   scripts/bootstrap-repo.sh             # execute for real
#
# Requires: git, gh (authenticated), gitleaks.
#
set -euo pipefail

OWNER="Guilhem-Bonnet"
REPO="llm-voice"
FULL_REPO="${OWNER}/${REPO}"
DESCRIPTION="Local-first VS Code extension for voice narration of Markdown documents and LLM agent output (Claude Code, and more), via Chatterbox/Kokoro TTS and an optional Ollama narrator."
TOPICS=(vscode-extension typescript tts voice ollama accessibility local-first)
DEFAULT_BRANCH="main"
DRY_RUN=0

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN=1
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

log() {
  printf '[bootstrap-repo] %s\n' "$1"
}

run() {
  # run <description> -- <command...>
  local description="$1"
  shift
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "DRY-RUN would run: $description"
    printf '  $ %s\n' "$*"
    return 0
  fi
  log "$description"
  "$@"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

require_cmd git
require_cmd gh
require_cmd gitleaks

log "Repo root: $REPO_ROOT"
log "Target: $FULL_REPO"
[[ "$DRY_RUN" -eq 1 ]] && log "MODE: --dry-run (no side effects)"

# --- 0. Stop if the remote repo already exists -----------------------------

if gh repo view "$FULL_REPO" >/dev/null 2>&1; then
  log "Repo $FULL_REPO already exists on GitHub. Nothing to create. Exiting."
  exit 0
fi

# --- 1. Secret scan before any commit ---------------------------------------

log "Running gitleaks (blocking) before any commit is created..."
if [[ "$DRY_RUN" -eq 1 ]]; then
  log "DRY-RUN would run: gitleaks detect --no-git -s . --redact"
else
  if ! gitleaks detect --no-git -s . --redact; then
    echo "gitleaks found potential secrets. Aborting before any commit." >&2
    exit 1
  fi
  log "gitleaks: no secrets found."
fi

# --- 2. git init (only if .git absent) --------------------------------------

if [[ -d .git ]]; then
  log ".git already present, skipping git init."
else
  run "git init -b $DEFAULT_BRANCH" git init -b "$DEFAULT_BRANCH"
fi

# --- 3. Initial commit (Conventional Commits) -------------------------------

if [[ "$DRY_RUN" -eq 1 ]]; then
  log "DRY-RUN would run: git add -A && git commit -m 'chore: bootstrap llm-voice repository' ..."
else
  git add -A
  if git diff --cached --quiet; then
    log "Nothing staged, skipping initial commit (already committed?)."
  else
    git commit -m "$(cat <<'EOF'
chore: bootstrap llm-voice repository

Governance files, CI/CD workflows (lint, unit, integration, package,
release, CodeQL, Dependabot), vscode-extension skeleton, and Claude Code
integration skeleton.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
  fi
fi

# --- 4. Create the GitHub repo and push -------------------------------------

run "gh repo create $FULL_REPO --public --source=. --push --description \"$DESCRIPTION\"" \
  gh repo create "$FULL_REPO" --public --source=. --push --description "$DESCRIPTION"

# --- 5. Topics ---------------------------------------------------------------

for topic in "${TOPICS[@]}"; do
  run "gh repo edit $FULL_REPO --add-topic $topic" gh repo edit "$FULL_REPO" --add-topic "$topic"
done

# --- 6. Branch protection on main --------------------------------------------
#
# Uses `gh api --method PUT --input -` with a complete JSON body (not `-f`
# with flattened strings) so nested objects (required_status_checks,
# required_pull_request_reviews, restrictions) are sent as real JSON, as
# required by the GitHub REST API for this endpoint.
#
# Status check contexts match the actual job names declared in
# .github/workflows/ci.yml: lint, unit, package are single jobs; integration
# runs as a 3-way OS matrix so GitHub reports one context per matrix leg.

BRANCH_PROTECTION_JSON=$(cat <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "lint",
      "audit",
      "unit",
      "integration (ubuntu-latest)",
      "integration (windows-latest)",
      "integration (macos-latest)",
      "package"
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": false,
  "required_conversation_resolution": true
}
EOF
)

if [[ "$DRY_RUN" -eq 1 ]]; then
  log "DRY-RUN would run: gh api --method PUT --input - repos/$FULL_REPO/branches/$DEFAULT_BRANCH/protection"
  printf '%s\n' "$BRANCH_PROTECTION_JSON"
else
  log "Applying branch protection on $DEFAULT_BRANCH..."
  printf '%s' "$BRANCH_PROTECTION_JSON" | gh api \
    --method PUT \
    -H "Accept: application/vnd.github+json" \
    "repos/$FULL_REPO/branches/$DEFAULT_BRANCH/protection" \
    --input -
fi

# --- 7. Labels ----------------------------------------------------------------

declare -A LABELS=(
  [bug]="d73a4a"
  [enhancement]="a2eeef"
  [documentation]="0075ca"
  [chore]="cfd3d7"
  [security]="b60205"
  [dependencies]="0366d6"
)

for label in "${!LABELS[@]}"; do
  color="${LABELS[$label]}"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "DRY-RUN would run: gh label create $label --color $color --repo $FULL_REPO (or update if exists)"
    continue
  fi
  if gh label create "$label" --color "$color" --repo "$FULL_REPO" 2>/dev/null; then
    log "Created label: $label"
  else
    gh label edit "$label" --color "$color" --repo "$FULL_REPO" >/dev/null 2>&1 || true
    log "Label already existed, ensured color: $label"
  fi
done

# --- 8. Security settings: Dependabot security updates -----------------------
#
# Uses `--method PATCH --input -` with a real JSON body (the Haiku plan's
# `-f security_and_analysis='{...}'` sends a JSON string as a form value,
# which the API rejects — it must be a JSON object field).

SECURITY_ANALYSIS_JSON=$(cat <<'EOF'
{
  "security_and_analysis": {
    "dependabot_security_updates": {
      "status": "enabled"
    },
    "secret_scanning": {
      "status": "enabled"
    },
    "secret_scanning_push_protection": {
      "status": "enabled"
    }
  }
}
EOF
)

if [[ "$DRY_RUN" -eq 1 ]]; then
  log "DRY-RUN would run: gh api --method PATCH --input - repos/$FULL_REPO"
  printf '%s\n' "$SECURITY_ANALYSIS_JSON"
else
  log "Enabling Dependabot security updates and secret scanning..."
  printf '%s' "$SECURITY_ANALYSIS_JSON" | gh api \
    --method PATCH \
    -H "Accept: application/vnd.github+json" \
    "repos/$FULL_REPO" \
    --input -
fi

log "Done. https://github.com/$FULL_REPO"
