# Agentic Task Envelope

## Task

- Task id: GAO-spike-moteur-001
- Request: Spike comparatif « `llm-voice-audio` (Rust, cpal+hound) contre mpv (IPC JSON) », mesuré sur le banc de preuve audio (`scripts/audio-proof/prove.sh`) avec le sink PipeWire nul, sur Fedora/Wayland/PipeWire uniquement. Condition d'entrée d'ADR-012 §Statut.
- Owner agent: backend-engineer (Stack) + skills attachées `platform-deploy-release` (ex-Convoy), `platform-reliability-sre` (ex-Guardian) — aucun spécialiste Rust dans l'équipe, contraintes Rust données explicitement par le brief
- Profile: controlled
- Current state: `running` (mode non-interactif)
- Risk level: `medium` (crée un workspace Cargo et des binaires exécutés localement ; joue du son sur un sink PipeWire nul, aucune modification hors `crates/`, `scripts/audio-spike/`, `Cargo.toml` racine, `_grimoire-output/evidence/GAO-spike-moteur-001/` ; `vscode-extension/` non touché)

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---:|
| Décision Core Rust minimal | `docs/adr/ADR-012-native-audio-core.md` | définit `llm-voice-audio` (cpal, tampon circulaire, position) comme brique commune, condition d'entrée = ce spike | 2026-09-28 | ~3k |
| Banc de preuve | `scripts/audio-proof/README.md`, `prove.sh` | méthode de mesure imposée (sink nul, parecord, faster-whisper, WER, silence) ; option `--play-cmd` | 2026-09-28 | ~1k |
| Contrat de lecture actuel | `vscode-extension/src/playback/AudioSink.ts` | vocabulaire à respecter côté Rust (load/play/pause/stop/position/ended), sans en dépendre techniquement | 2026-09-27 | ~1k |
| Licences dépendances | `crates.io` API (`cpal` 0.18.2 Apache-2.0, `hound` 3.5.1 Apache-2.0, `thiserror` 2.0.21 MIT OR Apache-2.0) | contrainte du brief : MIT/Apache-2.0 uniquement | 2026-09-28 | ~0.5k |
| Voix Piper FR | `~/.llm-voice/voices/fr_FR-siwis-medium.onnx` (présent) | génération des 3 phrases de mesure | 2026-09-28 | ~0.5k |

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| Bash | execute | `cargo` (build/test/clippy/fmt), `piper`, `mpv` (IPC), `scripts/audio-proof/prove.sh`, sink PipeWire de test | jamais de sink système par défaut modifié ; pas de `git push`/`gh` |
| Write/Edit | write | `Cargo.toml` (racine, nouveau), `crates/llm-voice-audio/**`, `scripts/audio-spike/**`, `_grimoire-output/evidence/GAO-spike-moteur-001/**` | jamais sous `vscode-extension/` ni `contracts/` |
| Bash (grimoire) | execute | `grimoire task context/move`, `grimoire standard decision trace/gate/verify` sur cette carte | ledger et board de cette carte uniquement |

## LLM routing

| Step | Provider | Model | Fallback | Data policy |
|---|---|---|---|---|
| Implémentation Rust + mesures (backend-engineer) | Anthropic | sonnet | — | code local, aucune donnée externe |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | brief non-interactif explicite (contraintes Rust listées faute de spécialiste dédié) | recorded |
| Implementation complete | `crates/llm-voice-audio` (lib + bin `llm-voice-audio-play`), `scripts/audio-spike/mpv-play.sh` | en cours |
| Validation complete | `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt --check`, banc de preuve exécuté pour les deux moteurs | en cours |
| Deviations documented | `evidence-pack.md` de cette tâche | en cours |
