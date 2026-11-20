# Agentic Claim Ledger

- Task id: GAO-core-rust-mi-001 (étape A)
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | Le Core n'écoute que sur 127.0.0.1, port éphémère | résultat | `main.rs` (`Ipv4Addr::LOCALHOST`, port 0) ; tests via `127.0.0.1:<port de core.json>` | prouvé | élevée | utiliser |
| CL-002 | Sans jeton ou jeton faux : 401 sur les 6 commandes et à l'ouverture WS | résultat | `tests/security.rs` | prouvé | élevée | utiliser |
| CL-003 | `Origin` non vide et `Host` étranger : 403 partout | résultat | `tests/security.rs` | prouvé | élevée | utiliser |
| CL-004 | Instance unique : seconde instance → code 17 ; `core.json` 0600 ; arrêt propre le retire | résultat | `single_instance_state_file_and_clean_shutdown`, `lock::tests` | prouvé | élevée | utiliser |
| CL-005 | Réponses et événements conformes à `contracts/core-v1` (exemples identiques, validation `llm-voice-protocol`) | résultat | `events_match_contract_examples_exactly`, `health_matches_contract_example`, `assert_contract` sur chaque message des tests | prouvé | élevée | utiliser |
| CL-006 | `ended` n'est émis qu'après la fin audio + marge, jamais avant | résultat | `playback.rs` (`ended` ≥ 900 + 300 ms) ; banc : dernier mot « mot. » transcrit | prouvé sur cette machine | moyenne | utiliser (reverifier sur autres backends) |
| CL-007 | Phrase Piper FR entière jouée par le Core, dernier mot compris | résultat | `prove-core.json` : pass, wer 0,2143 | prouvé | élevée | utiliser |
| CL-008 | La troncature en fin de capture avec `--post-roll 1.0` vient du banc (`parecord`), pas du Core | résultat | même troncature avec `pw-play` de référence ; captures multiples de 32 768 trames | prouvé | élevée | corriger le banc (autre carte) |
| CL-009 | La latence `cpal` affine l'instant de vidange | hypothèse | 0 ns mesuré via pipewire-alsa : non exercé ici | hypothèse | faible | vérifier sur macOS/Windows |
| CL-010 | `position` ≥ 4 Hz | résultat | test (≥ 4 sur 900 ms) ; banc : 42 `position` pour 3,96 s (~10 Hz) | prouvé | élevée | utiliser |

## Synthèse

| Question | Réponse |
|---|---|
| Affirmations bloquantes non prouvées | aucune pour l'étape A |
| Contradictions détectées | commande du brief (post-roll par défaut) → exit 1 ; expliquée par CL-008 |
| Hypothèses acceptées temporairement | CL-009 |
| Preuves à obtenir avant livraison | banc corrigé (post-roll/fragment) ; `NativeAudioSink` branché (étape B) ; smoke multi-plateforme |
