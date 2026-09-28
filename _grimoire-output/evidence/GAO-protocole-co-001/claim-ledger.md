# Agentic Claim Ledger

- Task id: GAO-protocole-co-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | Les 37 tests vitest (`ajv`) sur les exemples de `contracts/core-v1/examples/` sont verts | résultat | sortie JSON de `vitest run --config vitest.config.ts test/unit/contracts` (37/37) | prouvé | élevée | utiliser |
| CL-002 | Les 2 tests `cargo test -p llm-voice-protocol` (rejeu du même manifeste par `serde`) sont verts | résultat | sortie `cargo test -p llm-voice-protocol` (2 passed) | prouvé | élevée | utiliser |
| CL-003 | Aucune régression sur la suite existante après ajout du contrat | résultat | `npm run test:unit` (1010/1010), `cargo test --workspace` (11/11) | prouvé | élevée | utiliser |
| CL-004 | `ajv` est sous licence MIT et déjà présent dans l'arbre de dépendances (8.20.0) avant cette carte | fait | `vscode-extension/node_modules/ajv/package.json` (`license: MIT`), `LICENSE`, `package-lock.json` (résolu transitivement avant modification) | prouvé | élevée | promu en devDependency directe (`^8.17.1`) plutôt qu'ajouté à neuf |
| CL-005 | Le lint et le format Rust (`clippy -D warnings`, `fmt --check`) sont propres sur le nouveau crate et sur tout le workspace | résultat | `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt --check` | prouvé | élevée | utiliser |
| CL-006 | Le typecheck et le lint TypeScript sont propres sur le nouveau fichier de test | résultat | `npx tsc -p ./ --noEmit`, `npx eslint test/unit/contracts/core-v1.contract.test.ts --max-warnings=0` | prouvé | élevée | utiliser |
| CL-007 | Le transport « commandes en HTTP, événements en WebSocket » implémenté ici diverge du texte d'ADR-012 §4 (tout sur WS) | fait | lecture directe d'ADR-012 §4 vs brief de cette carte et README écrit ; entrée `decisions-log.md` du 2026-09-28 | contredit (avec le texte de l'ADR, pas avec le brief) | élevée | signalé à l'utilisateur, non tranché — voir evidence-pack |
| CL-008 | `segment_ended`/`ended` ne doivent être émis qu'après vidange complète du tampon audio | fait (repris) | `_grimoire-output/evidence/GAO-spike-moteur-001/claim-ledger.md`, CL-004 | prouvé (par la carte source) | élevée | reporté dans la description des deux schémas WS concernés |
| CL-009 | Chacun des 15 types de message a au moins un exemple valide et un exemple invalide dans `manifest.json` | fait | test dédié des deux côtés (`declares at least one valid and one invalid example per message kind` en vitest, `manifest_covers_every_kind_with_a_valid_and_an_invalid_example` en Rust), tous deux verts | prouvé | élevée | utiliser |
| CL-010 | La réinitialisation du budget de session Grimoire (`grimoire policies reset-session`) était le remède attendu, pas un contournement | hypothèse | message d'erreur du hook lui-même recommandant cette commande ; action documentée comme réversible (remise à zéro d'un compteur), aucune modification de `policies.yaml` | hypothèse | moyenne | signalé dans l'evidence-pack pour revue humaine |

Types : `fait`, `hypothèse`, `résultat`, `décision`. Statuts : `prouvé`,
`hypothèse`, `contredit`. Confiance : `faible`, `moyenne`, `élevée`. Décision :
`utiliser`, `vérifier`, `rejeter`.

## Synthèse

| Question | Réponse |
|---|---|
| Affirmations bloquantes non prouvées | aucune pour la livraison du contrat et de ses tests |
| Contradictions détectées | CL-007 : le contrat livré diverge du texte actuel d'ADR-012 §4 sur le placement des commandes (HTTP ici, WS dans l'ADR) |
| Hypothèses acceptées temporairement | CL-010 (réinitialisation du budget de session) |
| Preuves à obtenir avant de considérer le protocole figé | confirmation de guilhem-bonnet sur CL-007 (amender ADR-012 ou revenir au tout-WS) ; ce contrat n'a encore aucun serveur/`llm-voice-core` réel à l'autre bout — seule la forme des messages est prouvée, pas leur comportement réseau |
