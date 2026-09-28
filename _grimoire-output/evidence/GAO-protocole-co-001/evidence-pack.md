# Agentic Evidence Pack

## Summary

- Task id: GAO-protocole-co-001
- Profile: controlled
- Outcome: protocole Core v1 défini sous `contracts/core-v1/` (16 fichiers
  JSON Schema draft 2020-12 — 1 commun + 8 HTTP + 7 WS —, `README.md`, 17
  exemples valides, 19 exemples invalides, `examples/manifest.json` faisant
  le lien) ; validé des deux côtés sur les mêmes fichiers — vitest/`ajv`
  (37/37) et `cargo test`/`serde` sur un nouveau crate `llm-voice-protocol`
  (2/2, 15 types de message).
- Final state: implémentation et validation complètes ; passage en
  `needs_verification` demandé à l'issue de ce pack.

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| Carte claim → running | préexistant à cette session | — | `running` confirmé (`grimoire task show`) |
| Enveloppe (avant toute modification) | `_grimoire-output/evidence/GAO-protocole-co-001/task-envelope.md` | backend-engineer | écrite |
| Contexte, protocole, sécurité | `docs/adr/ADR-012-native-audio-core.md` §4/§5/§6 | lu | source normative |
| `ended` après vidange | `_grimoire-output/evidence/GAO-spike-moteur-001/claim-ledger.md` (CL-004) | lu | reporté dans `ws/ended.event.schema.json` et `ws/segment_ended.event.schema.json` |
| Schémas JSON Schema 2020-12 | `contracts/core-v1/common.schema.json`, `contracts/core-v1/http/*.schema.json` (8), `contracts/core-v1/ws/*.schema.json` (7) | backend-engineer | 16 fichiers, `$ref` cross-fichiers vers `common.schema.json` |
| Documentation | `contracts/core-v1/README.md` | backend-engineer | écrite |
| Exemples de référence | `contracts/core-v1/examples/valid/*.json` (17), `contracts/core-v1/examples/invalid/*.json` (19), `contracts/core-v1/examples/manifest.json` | backend-engineer | 15 kinds de message, chacun ≥ 1 valide + ≥ 1 invalide |
| `ajv` promu en devDependency directe | `vscode-extension/package.json`, `vscode-extension/package-lock.json` | `npm install` | déjà présent transitivement (8.20.0, MIT) ; lockfile confirme `devDependencies.ajv: ^8.17.1` à la racine |
| Test TypeScript | `vscode-extension/test/unit/contracts/core-v1.contract.test.ts` | backend-engineer | 37/37 verts (voir § Validation) |
| Nouveau crate Rust | `crates/llm-voice-protocol/{Cargo.toml,src/lib.rs}`, membre ajouté à `Cargo.toml` (racine) | backend-engineer | 15 structs `serde` + `Validate`, compile et lint propres |
| Test Rust | `crates/llm-voice-protocol/tests/contract_examples.rs` | backend-engineer | 2/2 verts (voir § Validation) |
| Décision journalisée | `_grimoire/_memory/decisions-log.md`, entrée `[2026-09-28] Protocole Core v1` | backend-engineer | déviation HTTP/WS vs ADR-012 §4 documentée, statut « proposé, à confirmer » |
| Context bundle | `_grimoire-output/context/GAO-protocole-co-001/context-bundle.yaml` | `grimoire task context` | OK |
| Decision trace | `_grimoire-output/decisions/GAO-protocole-co-001/decision-trace.yaml` | `grimoire standard decision trace` | OK |

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->

## Déviation par rapport à ADR-012 §4 (à confirmer)

ADR-012 §4 place « les commandes et les événements » tous les deux sur la
WebSocket (`/v1/ws`), HTTP limité à `GET /health`. Le brief de cette carte
demande explicitement des « requêtes HTTP » pour `enqueue`/`play`/`pause`/
`resume`/`stop`/`seek` et des « événements WebSocket » pour le reste — c'est
ce qui a été implémenté (voir `contracts/core-v1/README.md`, section
Transport, et l'entrée de `decisions-log.md` du 2026-09-28). Les deux
sources ne sont pas alignées ; la décision est journalisée comme
**proposée, non confirmée par guilhem-bonnet**, à trancher avant que
`llm-voice-core` implémente réellement ce transport (amender ADR-012, ou
revenir au tout-WebSocket et ajuster ce contrat en conséquence).

## Validation

| Check | Command or method | Result |
|---|---|---|
| Test contrat TypeScript | `cd vscode-extension && npx vitest run --config vitest.config.ts test/unit/contracts` | 37/37 tests verts (1 couverture manifeste + 36 exemples) |
| Suite unitaire complète (non-régression) | `npm --prefix vscode-extension run test:unit` | 82 fichiers, 1010/1010 tests verts |
| Typecheck | `npx tsc -p ./ --noEmit` | aucune erreur |
| Lint (fichier ajouté) | `npx eslint test/unit/contracts/core-v1.contract.test.ts --max-warnings=0` | aucun problème |
| Test contrat Rust | `cargo test -p llm-voice-protocol` | 2/2 tests verts (couverture des 15 kinds + rejeu du manifeste) |
| Suite Rust complète (non-régression) | `cargo test --workspace` | 11/11 tests verts (6 suites, `llm-voice-audio` + `llm-voice-protocol`) |
| Lint Rust | `cargo clippy --workspace --all-targets -- -D warnings` | aucun problème |
| Formatage Rust | `cargo fmt --check` (après `cargo fmt`) | propre |

## Controls

| Control family | Applied? | Evidence | Gap |
|---|---:|---|---|
| Governance | yes | carte ledger `GAO-protocole-co-001` existante, ce pack, décision journalisée | déviation HTTP/WS non confirmée par l'utilisateur — signalé ci-dessus |
| Quality | yes | vitest + cargo test verts sur les **mêmes** fichiers d'exemple (`manifest.json` partagé), lint et format propres des deux côtés | aucun test ne couvre encore un vrai aller-retour réseau (`llm-voice-core` n'existe pas encore) : ce sont des tests de forme du message, pas d'un serveur réel |
| Runtime | yes | `npm run test:unit` et `cargo test --workspace` exécutés réellement, pas seulement lus | — |
| Knowledge | yes | README explique le transport, la version de protocole, le jeton, et comment étendre le contrat | — |
| Model/provider | yes | backend-engineer, sonnet (ce sous-agent), mode non-interactif | — |

## Deviations and accepted risks

- Budget d'écriture de session Grimoire (`session-budget`, 400/400 atteint
  en cours de tâche) réinitialisé une fois via `grimoire policies
  reset-session` — remède documenté par le message d'erreur du hook
  lui-même, action réversible (remise à zéro d'un compteur de session), sans
  modification de `_grimoire/standard/policies.yaml`. Journalisé ici pour
  traçabilité.
- Périmètre HTTP vs WebSocket : voir section dédiée ci-dessus.
- `src/playback/**` et `test/fakes/**` non touchés (hors périmètre de cette
  carte, conformément à la consigne).
