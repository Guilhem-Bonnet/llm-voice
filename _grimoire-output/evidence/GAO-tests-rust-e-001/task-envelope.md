# Agentic Task Envelope

## Task

- Task id: GAO-tests-rust-e-001
- Request: (1) job CI `rust` (fmt, clippy -D warnings, cargo test --workspace) avec saut des tests exigeant une sortie audio réelle via variable d'environnement, sans modifier que les fichiers de test Rust ; (2) commande locale unique `scripts/e2e-local*.sh` + script npm `e2e:local` enchaînant toutes les étapes avec tableau récapitulatif, option `--quick` ; (3) exécution complète une fois, consignation du tableau.
- Owner agent: ops-engineer (Forge) + skill infra-pipeline-cicd — dispatch non-interactif
- Profile: controlled
- Current state: `running` ; aucun commit, aucun push
- Risk level: `low` (fichiers CI/scripts/tests Rust ; aucune suppression forcée)

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| Read/Edit/Write | edit | `.github/workflows/ci.yml`, `scripts/`, `vscode-extension/package.json`, `crates/*/tests/**` | interdits : `vscode-extension/src`, `crates/*/src`, `scripts/decision-spike`, `.vscode-test.mjs` |
| Bash | execute | cargo, npm, xvfb-run, scripts d'épreuve | aucun `rm -rf` forcé ; pas de `grimoire policies reset-session` ; pas de commit/push |

## Assumption (collision de nom)

`scripts/e2e-local.sh` existe déjà, suivi par git (commit 3b9d6ba, E2E Chatterbox S4.3) et cité par `docs/e2e/report-2026-09-08.md` et `vscode-extension/docs/testing.md`. Ne pas l'écraser : la nouvelle commande s'appelle `scripts/e2e-local-suite.sh`, le script npm `e2e:local` la cible.

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Job `rust` dans ci.yml | YAML valide | see evidence-pack |
| `LLM_VOICE_NO_AUDIO=1 cargo test --workspace` passe | sortie de commande | see evidence-pack |
| Exécution complète de la suite | tableau | see evidence-pack |
| CI verte | run GitHub Actions | en attente de push (non vérifiable localement) |
