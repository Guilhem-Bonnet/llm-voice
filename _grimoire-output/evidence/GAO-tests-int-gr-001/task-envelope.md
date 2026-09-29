# Agentic Task Envelope

## Task

- Task id: GAO-tests-int-gr-001
- Request: test d'intégration « extension entière » qui aurait attrapé le bogue terrain `segmentId "session-4:0"` (enqueue refusé `invalid_request`) : vrai VS Code sans écran (xvfb), `llmVoice.audio.engine=native`, vrai Core Rust, vraie voix Piper, son capté par le banc `prove.sh`. Livrables : label `native-real` (`vscode-extension/.vscode-test.mjs`), test `test/integration-native-real/native-real.test.ts`, script `scripts/audio-proof/native-real.sh`, contre-preuve (retrait temporaire de `encodeSegmentId` dans `NativeAudioSink.ts`, échec constaté, restauration).
- Owner agent: backend-engineer (Stack), skills `platform-deploy-release`, `platform-reliability-sre`
- Profile: controlled
- Current state: `running` (mode non-interactif ; l'état n'est déplacé que vers `needs_verification` en fin de tâche)
- Risk level: `low` (tests et script seulement ; aucun changement de code produit hors contre-preuve temporaire restaurée ; aucun commit)

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---|
| Profils de test existants | `vscode-extension/.vscode-test.mjs` | modèle d'isolation `--user-data-dir` | working tree | ~5k |
| Branchage natif | `vscode-extension/src/extension.ts` L220-235 | `audio.engine`, `audio.corePath` | working tree | ~1k |
| Encodage segmentId | `vscode-extension/src/playback/NativeAudioSink.ts` L150-170, L365 | cible de la contre-preuve | working tree | ~1k |
| Banc | `scripts/audio-proof/{README.md,prove.sh}`, `scripts/audio-spike/native-sink-play.sh` | `--play-cmd`, PULSE_SINK, PIPEWIRE_PROPS | working tree | ~4k |

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| Write/Edit | write | `vscode-extension/.vscode-test.mjs`, `vscode-extension/test/integration-native-real/**`, `scripts/audio-proof/native-real.sh`, `_grimoire-output/evidence/GAO-tests-int-gr-001/**` ; `NativeAudioSink.ts` seulement pour la contre-preuve, restauré | jamais `.github/`, `crates/`, `scripts/decision-spike`, `package.json` ; aucun commit |
| Bash | execute | `cargo build --release -p llm-voice-core`, `npm run build`, `xvfb-run vscode-test`, `prove.sh` (sink nul détruit par trap) | loopback ; `pactl set-default-sink` restauré par trap |

## LLM routing

| Step | Provider | Model | Fallback | Data policy |
|---|---|---|---|---|
| Implémentation, exécution, preuves | Anthropic | sonnet (backend-engineer) | — | code local, aucune donnée externe |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | brief non-interactif explicite | recorded |
| Implementation complete | label, test, script | pending |
| Validation complete | run vert (exit 0 + JSON du banc) ET contre-preuve rouge | pending |
| Deviations documented | `evidence-pack.md` | pending |
