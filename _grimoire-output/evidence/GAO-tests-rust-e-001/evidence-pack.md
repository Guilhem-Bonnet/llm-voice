# Evidence pack — GAO-tests-rust-e-001

## Livrables

| Fichier | Nature |
|---|---|
| `.github/workflows/ci.yml` | nouveau job `rust` (ubuntu-latest, `dtolnay/rust-toolchain@stable` + clippy/rustfmt, `Swatinem/rust-cache`, `libasound2-dev`, `working-directory: .`, `LLM_VOICE_NO_AUDIO=1`) : `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace` |
| `crates/llm-voice-core/tests/playback.rs` | seul fichier Rust modifié : le test lit `LLM_VOICE_NO_AUDIO` (défini, non vide, différent de `0`) et se saute avec un message ; les 9 tests `security.rs` et les autres tests tournent normalement |
| `scripts/e2e-local-suite.sh` | commande locale unique, arrêt au premier échec, tableau (EXIT trap), `--quick`, journaux dans `target/e2e-local/` (gitignoré, aucune suppression) |
| `vscode-extension/package.json` | script `"e2e:local": "bash ../scripts/e2e-local-suite.sh"` |

## Écart au brief (collision de nom)

`scripts/e2e-local.sh` existe déjà et est suivi par git (commit 3b9d6ba : E2E Chatterbox S4.3, cité par `docs/e2e/report-2026-09-08.md` et `vscode-extension/docs/testing.md`). Non écrasé : la suite s'appelle `scripts/e2e-local-suite.sh`, le script npm `e2e:local` pointe dessus. Si guilhem préfère le nom `e2e-local.sh`, renommer l'ancien d'abord (décision humaine).

## Vérifications exécutées

- `cargo fmt --check` : OK. `cargo clippy --workspace --all-targets -- -D warnings` : OK.
- `LLM_VOICE_NO_AUDIO=1 PIPEWIRE_RUNTIME_DIR=/nonexistent XDG_RUNTIME_DIR=/nonexistent cargo test --workspace` : tous verts (7+3+7+7 unitaires, playback 1 sauté, security 9, contract_examples 2).
- YAML de `ci.yml` parsé (PyYAML) : jobs `lint, rust, audit, unit, integration, package, package-linux-x64`. `actionlint` absent : non vérifié.
- `bash -n scripts/e2e-local-suite.sh` : OK (shellcheck non disponible : non vérifié).
- `bash scripts/e2e-local-suite.sh --quick` : vert (cargo fmt/clippy/test, build release, test:unit, typecheck, lint, intégration headless 69 s, core-attack 20 s ; 4 étapes sautées).

## Exécution complète `bash scripts/e2e-local-suite.sh` (17:15-17:21)

| Étape | Statut | Durée |
|---|---|---:|
| cargo fmt --check | OK | 0 s |
| cargo clippy -D warnings | OK | 0 s |
| cargo test --workspace | OK | 3 s |
| build release du Core | OK | 0 s |
| test:unit | OK | 3 s |
| typecheck | OK | 3 s |
| lint | OK | 4 s |
| intégration headless (xvfb-run -a npx vscode-test) | OK | 72 s |
| audio-proof selftest | OK | 16 s |
| core-attack (sécurité) | OK | 20 s |
| wayland-validation | ÉCHEC | 173 s |
| test:integration-real | non atteint (arrêt au premier échec) ; lancé à la main : 10/11 | — |
| native-real | non atteint ; script apparu en cours de tâche (autre carte), non exécuté | — |

### Constats

1. `wayland-validation` : cas 1-defaut FAIL (capture du sink nul par défaut silencieuse, rms 0, wer 1.0, `ended=1`, Core vivant) ; cas 2, 3, 4 PASS. Un échec identique du cas 1 figure dans `_grimoire-output/evidence/GAO-s1-fedora-va-001/wayland-validation/run.log` (14:41, wer 0.97) : défaut réel ou dépendance de l'environnement PipeWire, non tranché ici, hors périmètre (carte GAO-s1-fedora-va-001). Sink par défaut original restauré par le trap du script.
2. `test:integration-real` lancé à la main (`LLM_VOICE_E2E=1 LLM_VOICE_E2E_OLLAMA=1`) : 10 passés, 1 échec connu et machine-dépendant (`system-tts.test.ts` attend `local:espeak-ng`, Piper installé) — carte distincte.
3. Première exécution complète interrompue à `test:unit` : `native-audio-sink.test.ts` échouait (segmentId `session-4:0` hors contrat) parce qu'une autre carte modifiait transitoirement `NativeAudioSink.ts` (`encodeSegmentId` retiré, revenu propre ensuite, `git diff` vide). Environnement concurrent, pas un défaut du dépôt ; relance verte.

## Non vérifié

- Le job `rust` n'a jamais tourné sur GitHub Actions (aucun push) : le critère « CI verte » reste en attente de push, action L4 soumise à approbation.
- Le saut du test audio n'a été éprouvé que localement avec l'audio réel disponible plus variables PipeWire pointant dans le vide ; pas sur un runner GitHub.

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->

## Première exécution complète par le concierge (2026-09-29) et correction

`bash scripts/e2e-local-suite.sh` : toutes les étapes vertes jusqu'à l'intégration headless, où AC-SEC-02 (« a hostile inbox
message never reaches the document ») dépassait 20 s de façon reproductible. Cause établie : la suite `integration-security`
lisait l'inbox avec le profil par défaut `claude-code → llm-summary`, donc un appel au **vrai** Ollama, occupé par les
évaluations en cours (gpt-oss:20b chargé, 37 % CPU) : réponse du narrateur au bout de ~30 s. Correctif dans `.vscode-test.mjs` :
profil fidèle pour `claude-code` dans cette suite (+ port de narrateur fermé en second garde-fou). Résultat : 8/8 en 13 s,
Ollama toujours chargé. Aucune modification de code produit.
