# Agentic Task Envelope

## Task

- Task id: GAO-protocole-co-001
- Request: Définir le protocole v1 entre l'extension TypeScript et le Core
  Rust (ADR-012) : JSON Schema (draft 2020-12) versionnés des messages HTTP
  (health, enqueue de segments PCM/WAV par chemin, play, pause, resume,
  stop, seek) et des événements WebSocket (state, position,
  segment_started, segment_ended, underrun, ended, error), avec version de
  protocole et jeton d'authentification ; exemples valides/invalides
  partagés ; testés des deux côtés (vitest/ajv, cargo test/serde) sur les
  mêmes fichiers.
- Owner agent: backend-engineer (Stack), mode non-interactif
- Profile: controlled
- Current state: `running`
- Risk level: `low` (ajout de fichiers de contrat et de tests ; aucune
  connexion réseau, aucun binaire exécuté hors `npm`/`cargo` de vérification)

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---:|
| Protocole, cycle de vie, sécurité loopback, jeton | `docs/adr/ADR-012-native-audio-core.md` §4, §5, §6 | source normative du contrat | 2026-09-28 | ~3k |
| Position exacte, `ended` après vidange | `_grimoire-output/evidence/GAO-spike-moteur-001/claim-ledger.md` (CL-002, CL-003, CL-004) | `ended`/`segment_ended` doivent être postés après vidange complète du tampon, jamais avant | 2026-09-28 | ~1k |
| API du moteur (`TrackQueue`, `Player`, états) | `crates/llm-voice-audio/src/{lib,player,queue,error}.rs` | vocabulaire Rust déjà en place (état `Stopped/Playing/Paused/Ended`, position en ms) réutilisé dans les schémas et les structs `llm-voice-protocol` | 2026-09-28 | ~2k |
| Style Zod/JSON Schema existant côté extension | `vscode-extension/src/core/{inbox,profile}.schema.ts`, `vscode-extension/test/unit/schemas/profile-collection.schema.test.ts` | convention de dépôt : JSON Schema canonique vérifié par un test qui le recharge, jamais généré à la main sans preuve | 2026-09-28 | ~2k |
| `ajv` déjà présent (transitif, MIT, 8.20.0, `ajv/dist/2020`) | `vscode-extension/package-lock.json`, `node_modules/ajv/{package.json,LICENSE}` | seule bibliothèque du dépôt qui valide un JSON Schema brut (Zod ne rejoue pas un fichier `.schema.json` externe) ; promue en devDependency directe | 2026-09-28 | ~1k |

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| Write/Edit | write | `contracts/core-v1/**`, `vscode-extension/test/unit/contracts/**`, `vscode-extension/package.json` (ajout devDependency `ajv`), `crates/llm-voice-protocol/**`, `Cargo.toml` (ajout membre workspace), `_grimoire-output/evidence/GAO-protocole-co-001/**` | jamais `src/playback/**` ni `test/fakes/**` (carte en cours ailleurs) |
| Bash | execute | `npm --prefix vscode-extension`, `cargo`, `grimoire` | pas de `git push`/`gh`/commit |

## LLM routing

| Step | Provider | Model | Fallback | Data policy |
|---|---|---|---|---|
| Rédaction contrat + tests (backend-engineer) | Anthropic | sonnet | — | code local uniquement |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | brief non-interactif explicite (orchestrateur) | recorded |
| Implementation complete | `contracts/core-v1/**`, test vitest, crate/test Rust | en cours |
| Validation complete | `npm run test:unit` (contrats), `cargo test --workspace`, `cargo clippy --workspace -- -D warnings`, `cargo fmt --check` | en cours |
| Deviations documented | `evidence-pack.md` de cette tâche | en cours |
