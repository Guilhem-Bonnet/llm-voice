# Agentic Evidence Pack

## Summary

- Task id: GAO-spike-moteur-001
- Profile: controlled
- Outcome: Spike moteur audio sur Fedora/Wayland/PipeWire — crate Rust `llm-voice-audio` (cpal + hound) contre mpv IPC, mesurés sur le banc `scripts/audio-proof`.
- Final state: needs_verification (2026-09-28)

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| Crate Rust | `crates/llm-voice-audio/` (lib `queue.rs`, `player.rs`, `error.rs`, bin `llm-voice-audio-play`) | backend-engineer (Sonnet) | compile, joue sans crash |
| Script mpv | `scripts/audio-spike/mpv-play.sh` (`--gapless-audio=yes`, `--input-ipc-server`, pause via `set_property`, position via `playback-time`) | backend-engineer | fonctionne |
| Script de mesure | `scripts/audio-spike/measure.sh` | backend-engineer, exécuté par le concierge | 4 mesures, JSON dans `mesures/` |
| Tests Rust | `rtk proxy cargo test --workspace` | concierge | 9 passés (6 file/position, 3 CLI), 0 échec |
| Lint Rust | `cargo clippy --workspace -- -D warnings` ; `cargo fmt --check` | concierge | vert ; vert |
| Licences dépendances | `cpal 0.15` Apache-2.0, `hound 3.5` Apache-2.0, `thiserror 1.0` MIT/Apache-2.0 | concierge | compatibles MIT |

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->

## Validation — mesures (3 phrases Piper FR enchaînées, durée de référence 8,707 s)

| Mesure | Rust (cpal) | mpv | Commentaire |
|---|---|---|---|
| Banc `prove.sh`, sans pause | exit 0, WER 0,115 | exit 0, WER 0,115 | les deux ratent le dernier mot : les enveloppes rendent la main avant vidange du tampon (vérifié : lecture directe du même WAV transcrite en entier) |
| Banc `prove.sh`, avec pause | exit 0, WER 0,077 | exit 0, WER 0,038 | même troncature en fin pour Rust |
| Plus long silence capté | 1 020 ms sans pause | 1 200 ms sans pause | inclut le pré-roll de capture et les silences de fin des WAV Piper : **la jonction entre fichiers n'est pas isolée**, pas de conclusion « gapless » chiffrée |
| Position finale rapportée | 8 707 ms (exacte) | 8 271 ms | mpv sous-estime de 436 ms à l'arrêt du sondage |
| Pause demandée à 2 100 ms → position à la pause / à la reprise | 2 100 / 2 100 | 2 022 / 2 102 | Rust exact ; mpv dérive de 80 ms à la reprise |
| Démarrage (premier sondage non nul) | index 1 | index 1 | équivalents à la résolution du sondage |

## Recommandation

**Retenir le moteur Rust (cpal) pour le Core**, conformément à ADR-012 : même intelligibilité sur le banc, position exacte et
reprise exacte après pause, là où mpv dérive (80 ms à la reprise, 436 ms sur la position finale). mpv reste la référence de
comparaison du banc et le repli documenté (option F), pas le moteur par défaut.

## Deviations and accepted risks

| Deviation | Impact | Accepted by | Review trigger |
|---|---|---|---|
| Dernier mot tronqué dans les deux moteurs : **pas le banc** (lecture directe du même WAV transcrite en entier), mais les lecteurs qui rendent la main avant la vidange du tampon | exigence reportée sur le Core : `ended` après vidange (drain) du périphérique, testée sur le banc | concierge | carte Contrat AudioSink v2 et carte Core |
| Blanc de jonction non isolé (silences Piper + pré-roll inclus) | critère « gapless » non chiffré | concierge | mesurer sur des WAV sans silence de bord (tonalités) dans la carte Contrat AudioSink v2 |
| Agent arrêté trois fois à la limite de tours ; mesures et pack finalisés par le concierge | aucune sur le résultat | concierge | briefs Rust plus découpés |
| `analyze.py` du banc dépend d'`audioop` (retiré en Python 3.13) | fonctionne en venv 3.12 | concierge | avant toute montée de version du venv |

## Métriques agent

| Métrique | Valeur |
|---|---|
| Agent | backend-engineer, Sonnet, brief Rust explicite |
| Reprises nécessaires | 3 (limite de 30 tours atteinte trois fois) |
| Appels d'outils | 99 |
| Durée cumulée | environ 16 min |
| Erreurs de compilation observées | au moins une (ré-export `load_wav` manquant dans `lib.rs`) ; décompte exact non consigné |
