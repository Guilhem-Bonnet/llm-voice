# Plan Infrastructure CI/CD — Repo GitHub LLM Voice

## 1. Identité Repo

**Nom recommandé** : `llm-voice` (court, mémorable)  
**Description** : VS Code extension for voice narration via local TTS (Chatterbox, Kokoro) + Ollama narrator  
**Topics** : vscode-extension, typescript, tts, voice, ollama, accessibility  
**Licence** : MIT (vs Apache-2.0 : plus léger, adoption meilleure pour extensions, moins contraignant contributeurs)  
**Visibilité** : Public

---

## 2. Arborescence Repo (essentiellement)

```
llm-voice/
├── .github/workflows/{ci,release,codeql,dependabot}.yml
├── vscode-extension/ src/{extension,commands,parser,narrator,tts,playback,highlight,profiles,claude,views,infrastructure} + test/{unit,integration} + vitest.config.ts
├── integrations/claude-code/{capture.sh,capture.ps1,capture.py}
├── docs/{README,INSTALLATION,DEVELOPMENT,ARCHITECTURE,PRIVACY}.md
├── examples/profiles/{default,fast,narrator-minimal}.json
├── LICENSE (MIT) | README.md | CONTRIBUTING.md | CODE_OF_CONDUCT.md | SECURITY.md | CHANGELOG.md | CODEOWNERS
├── .editorconfig | .nvmrc (22) | .gitignore (node_modules/, *.vsix, out/, .vscode-test/) | bootstrap-repo.sh
```

Gouvernance : CODEOWNERS (`* @Guilhem-Bonnet`), PR template (tests + docs), issue templates (bug/feature).

---

## 3. Bootstrap Script (bash)

```bash
#!/bin/bash
set -euo pipefail
REPO="llm-voice"; OWNER="Guilhem-Bonnet"

gh repo view "$OWNER/$REPO" >/dev/null 2>&1 && { echo "Repo exists"; exit 1; }
git init && git checkout -b main && touch .gitkeep && git add . && git commit -m "chore: init"
gh repo create "$REPO" --public --source=. --push
sleep 2

# Protect main: require 1 review, status checks, no force-push
gh api repos/$OWNER/$REPO/branches/main/protection -X PUT \
  -f required_status_checks='{"strict":true,"contexts":["build","test","codeql"]}' \
  -f required_pull_request_reviews='{"required_approving_review_count":1}' \
  -f allow_force_pushes=false

# Standard labels, Dependabot alerts
for label in bug enhancement documentation chore; do
  gh api repos/$OWNER/$REPO/labels -X POST -f name=$label || true
done

gh api repos/$OWNER/$REPO -X PATCH \
  -f security_and_analysis='{"dependabot_security_updates":{"status":"enabled"}}'

echo "✓ $REPO ready at github.com/$OWNER/$REPO"
```

---

## 4. GitHub Actions Workflows (4 fichiers)

### ci.yml (push/PR → lint, typecheck, test, integration, coverage)
```yaml
name: CI
on: [push, pull_request]
concurrency: {group: "${{ github.workflow }}-${{ github.ref }}", cancel-in-progress: true}
jobs:
  test:
    strategy: {matrix: {os: [ubuntu-latest, windows-latest, macos-latest]}}
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: {node-version-file: '.nvmrc', cache: npm}
      - run: npm ci --prefix vscode-extension
      - run: npm run lint --prefix vscode-extension
      - run: npm run typecheck --prefix vscode-extension
      - run: npm run test:unit -- --coverage --prefix vscode-extension
      - uses: codecov/codecov-action@v4
        with: {files: ./vscode-extension/coverage/coverage-final.json, fail_ci_if_error: false}
      - run: xvfb-run -a npm run test:integration --prefix vscode-extension
        if: runner.os == 'Linux'
      - run: npm run test:integration --prefix vscode-extension
        if: runner.os != 'Linux'
      - run: npm run package --prefix vscode-extension
      - uses: actions/upload-artifact@v4
        with: {name: vsix-${{ matrix.os }}, path: 'vscode-extension/*.vsix', retention-days: 5}
```

### release.yml (tag v* → build, test, VSIX, Release, publish optionnel)
```yaml
name: Release
on: {push: {tags: ['v*']}}
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: {node-version-file: '.nvmrc', cache: npm}
      - run: npm ci --prefix vscode-extension
      - run: npm run test:unit --prefix vscode-extension
      - run: npm run build --prefix vscode-extension
      - run: npm run package --prefix vscode-extension
      - run: gh release create ${{ github.ref_name }} --generate-notes vscode-extension/*.vsix
        env: {GITHUB_TOKEN: "${{ secrets.GITHUB_TOKEN }}"}
      - run: npm run publish --prefix vscode-extension
        if: "!contains(github.ref, 'beta') && !contains(github.ref, 'alpha')"
        env: {VSCE_PAT: "${{ secrets.VSCE_PAT }}"}
```

### codeql.yml (schedule weekly + PR)
```yaml
name: CodeQL
on: {push: {branches: [main]}, pull_request: {branches: [main]}, schedule: [{cron: '0 2 * * 1'}]}
jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v3
        with: {languages: [javascript]}
      - uses: actions/setup-node@v4
        with: {node-version-file: '.nvmrc'}
      - run: npm ci --prefix vscode-extension && npm run build --prefix vscode-extension
      - uses: github/codeql-action/analyze@v3
```

### dependabot.yml
```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /vscode-extension
    schedule: {interval: weekly, day: monday, time: "03:00"}
    commit-message: {prefix: "chore(deps)"}
    allow: [{dependency-type: all}]
    reviewers: [Guilhem-Bonnet]
  - package-ecosystem: github-actions
    directory: /
    schedule: {interval: weekly}
    commit-message: {prefix: "chore(ci)"}
```

---

## 5. Branches & Versions

**Trunk-based** : feature branches courtes (`feat/`, `fix/`, `docs/`), max 14j avant merge  
**Conventional Commits** : feat/fix/docs/chore/refactor  
**SemVer** : 0.x (MVP), 1.0.0 (post-MVP) ; tags : `v0.1.0`, `v0.1.1-beta.1`  

**Release (5 étapes)** :
1. `npm version [patch|minor|major]` (updates package.json + tag)
2. `git push origin main && git push origin v*`
3. CI runs `release.yml`, builds VSIX, creates Release
4. Manual or auto publish via `VSCE_PAT` secret
5. Update CHANGELOG + announce

---

## 6. Maintenance (tableau récurrent)

| Action | Fréquence | Agent Grimoire | Automatisable ? |
|--------|-----------|----------------|-----------------|
| Merge Dependabot | Weekly | ops-engineer | ✓ |
| Triage issues | Weekly | concierge | ✗ |
| CI health check | Bi-weekly | pipeline-architect | ✓ |
| Security audit | Monthly | security-hardener | ✓ |
| Release planning | Per-release | concierge | ✗ |

---

## 7. Métriques Santé (≤8)

1. **Coverage** ≥75% (vitest + codecov)
2. **Build time** ≤8 min (CI logs)
3. **Security findings** 0 critical (CodeQL + Dependabot)
4. **Issue resolution** ≤14j avg (API)
5. **Dependabot PRs** ≤5 open (groupées)
6. **Test flakiness** ≤2% (CI history)
7. **Marketplace rating** ≥4.0⭐
8. **Stale branches** ≤2 (>30j unused)

---

**Fichier** : `/mnt/Travail/Projets/Dev/TTS-Voice/_grimoire-output/planning-artifacts/github-repo-ci-plan-v1.md`  
**Repo** : `Guilhem-Bonnet/llm-voice` · MIT · Public · Trunk-based  
**Workflows** : 4 YAML complets (CI, Release, CodeQL, Dependabot)  
**Bootstrap** : bash idempotent avec gh api protection/labels/Dependabot  
