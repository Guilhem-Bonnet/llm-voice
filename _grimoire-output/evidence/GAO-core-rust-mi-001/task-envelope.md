# Agentic Task Envelope

## Task

- Task id: GAO-core-rust-mi-001
- Request: Étape A — démon Rust `llm-voice-core` (axum + tokio) : 127.0.0.1 seulement, port éphémère, jeton aléatoire obligatoire (commandes HTTP et ouverture WS), `Origin` non vide et `Host` étranger refusés, `/health` avec version de protocole, fichier d'état `0600` `$XDG_RUNTIME_DIR/llm-voice/core.json`, instance unique (code de sortie dédié) ; routes `enqueue/play/pause/resume/stop/seek` et événements `state/position/segment_started/segment_ended/underrun/ended/error` conformes à `contracts/core-v1` via `llm-voice-protocol` ; tests cargo ; preuve audio `core-play.sh` + banc `prove.sh`. L'extension (`vscode-extension/`, étape B) n'est pas touchée.
- Owner agent: backend-engineer (Stack), skills attachées `platform-reliability-sre` (vidange, underrun) et `platform-deploy-release` (cycle de vie du démon)
- Profile: controlled
- Current state: `running` (reprise en escalade Opus, mode non-interactif ; l'état de la carte n'est pas modifié par cet agent)
- Risk level: `medium` (processus réseau local : surface d'attaque loopback ; aucun accès sortant ; aucun commit)

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---:|
| Décision d'architecture | `docs/adr/ADR-012-native-audio-core.md` §4-§6 | protocole, cycle de vie, sécurité loopback | 2026-09-28 | ~4k |
| Contrat | `contracts/core-v1/**` (README, schémas, exemples) | forme exacte des réponses et événements | 2026-09-28 | ~6k |
| Types serde | `crates/llm-voice-protocol/src/lib.rs` | réutilisés tels quels par le Core | working tree | ~5k |
| Moteur | `crates/llm-voice-audio/src/{player,queue}.rs` (diff non commité de l'agent précédent : `push`, `DrainStatus`) | file, position, vidange | working tree | ~6k |
| Exigence de vidange | `_grimoire-output/evidence/GAO-spike-moteur-001/claim-ledger.md` CL-004 | `ended` après vidange du périphérique | 2026-09-28 | ~1k |

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| Write/Edit | write | `crates/**`, `Cargo.toml`, `Cargo.lock`, `scripts/audio-spike/core-play.sh`, `_grimoire-output/evidence/GAO-core-rust-mi-001/**` | jamais `vscode-extension/` ni `contracts/` ; aucun commit |
| Bash | execute | `cargo build/test/clippy/fmt`, `piper`, `scripts/audio-proof/prove.sh` (sink nul PipeWire, détruit par trap) | loopback seulement ; `pactl set-default-sink` restauré par trap |

## LLM routing

| Step | Provider | Model | Fallback | Data policy |
|---|---|---|---|---|
| Implémentation Core, tests, preuve (backend-engineer) | Anthropic | opus (escalade) | — | code local, aucune donnée externe |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | brief non-interactif explicite (concierge, 2026-09-28) | recorded |
| Implementation complete | crate `llm-voice-core` compilé, routes et événements du contrat | done (evidence-pack) |
| Validation complete | `cargo test --workspace`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt --check`, banc `prove.sh` exit 0 | done (27 tests verts, clippy/fmt verts, banc exit 0) |
| Deviations documented | `evidence-pack.md` de cette tâche | done |
