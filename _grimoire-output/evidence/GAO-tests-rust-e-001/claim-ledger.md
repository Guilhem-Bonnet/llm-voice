# Agentic Claim Ledger

- Task id: GAO-tests-rust-e-001 (Rust en CI + commande locale e2e:local)
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | Le job `rust` existe dans `ci.yml` (fmt, clippy -D warnings, test, cache cargo, libasound2-dev) | résultat | `.github/workflows/ci.yml` ; YAML parsé | prouvé | élevée | utiliser |
| CL-002 | `LLM_VOICE_NO_AUDIO=1 cargo test --workspace` passe sans sortie audio, seul le test playback est sauté | résultat | evidence-pack §Vérifications | prouvé | élevée | utiliser |
| CL-003 | Seul un fichier de test Rust a changé (`crates/llm-voice-core/tests/playback.rs`) | résultat | `git status` | prouvé | élevée | utiliser |
| CL-004 | `scripts/e2e-local-suite.sh` s'arrête au premier échec et imprime le tableau ; `--quick` vert | résultat | exécutions du 2026-09-29 | prouvé | élevée | utiliser |
| CL-005 | La suite complète est verte | résultat | arrêt à `wayland-validation` cas 1-defaut | réfuté | élevée | signaler (hors périmètre) |
| CL-006 | Le job `rust` est vert sur GitHub Actions | résultat | aucun push, aucune run | non vérifié | — | en attente de push (L4) |
| CL-007 | `native-real.sh` passe dans la suite | résultat | script apparu en cours de tâche, jamais atteint | non vérifié | — | à rejouer |
