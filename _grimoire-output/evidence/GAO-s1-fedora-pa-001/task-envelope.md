# Agentic Task Envelope

## Task

- Task id: GAO-s1-fedora-pa-001
- Request: VSIX `linux-x64` embarquant le binaire du Core (`llm-voice-core`) : script de mise en scène du binaire (`stage-core.mjs`), script npm `package:linux-x64`, extension de `check-vsix.mjs` (présence/exécutabilité du binaire de la cible, absence des autres cibles, plafond de taille), smoke test `smoke-core-vsix.sh` (extraction, lancement, `/health`, `protocolVersion` 1.0, arrêt), job CI `package-linux-x64` dans `ci.yml`. Phasage OS : Fedora/Wayland (linux-x64) d'abord, darwin S3, win32 S4 (decisions-log 2026-09-28, amendement ADR-012 §7).
- Owner agent: ops-engineer (Forge), skill attachée `infra-pipeline-cicd`
- Profile: controlled
- Current state: `running` (mode non-interactif, sur brief direct)
- Risk level: low (scripts de build/CI et packaging local ; aucun accès réseau sortant hors loopback pour le smoke ; aucun commit, aucun push)

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---:|
| Décision packaging | `docs/adr/ADR-012-native-audio-core.md` §7 (+ amendement 2026-09-28) | 5 cibles, gate VSIX, smoke `/health` | 2026-09-28 | ~2k |
| Phasage OS | `_grimoire/_memory/decisions-log.md` (entrée « Phasage par OS ») | linux-x64 avant darwin/win32 | 2026-09-28 | ~1k |
| Gate existante | `vscode-extension/scripts/check-vsix.mjs`, `.vscodeignore` | ne pas régresser le VSIX universel sans Core | working tree | ~3k |
| Contrat Core | `crates/llm-voice-core/src/server.rs` (`/health` sans jeton, `HealthResponse.protocol_version`) | forme exacte attendue par le smoke | working tree | ~1k |
| Client Core | `vscode-extension/src/playback/CoreProcess.ts` (`platformTarget`, `binaryName`, `core.json`) | chemin `bin/<target>/llm-voice-core` attendu par l'extension | working tree | ~2k |
| Modèle de preuve | `_grimoire-output/evidence/GAO-core-rust-mi-001/*` | format task-envelope/evidence-pack/claim-ledger | 2026-09-28 | ~2k |

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| Write/Edit | write | `vscode-extension/scripts/stage-core.mjs`, `vscode-extension/scripts/check-vsix.mjs`, `vscode-extension/package.json`, `vscode-extension/.vscodeignore`, `.gitignore`, `scripts/smoke-core-vsix.sh`, `.github/workflows/ci.yml`, `_grimoire-output/evidence/GAO-s1-fedora-pa-001/**` | jamais `contracts/`, jamais `release.yml` ; aucun commit, aucun push |
| Bash | execute | `cargo build --release -p llm-voice-core`, `npm run package:linux-x64`, `npm run check:vsix`, `bash scripts/smoke-core-vsix.sh` | loopback seulement (le Core smoke n'écoute que sur `127.0.0.1`) |

## LLM routing

| Step | Provider | Model | Fallback | Data policy |
|---|---|---|---|---|
| Packaging linux-x64, gate, smoke, CI (ops-engineer) | Anthropic | sonnet | — | code local, aucune donnée externe |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | brief non-interactif explicite (utilisateur, 2026-09-28) | recorded |
| Implementation complete | 4 fichiers/scripts + job CI livrés | en cours |
| Validation complete | `package:linux-x64`, `check:vsix --target linux-x64`, smoke local exécutés, sorties consignées | en cours |
| Deviations documented | `evidence-pack.md` de cette tâche (CI verte non prouvable sans push) | en cours |
