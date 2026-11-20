# Agentic Task Envelope

## Task

- Task id: GAO-bogue-un-seg-001
- Request: quand le Core refuse un `enqueue`/`play` (ack `ok:false`, HTTP >= 400) ou que la requête échoue au niveau réseau, le PlaybackController reste en `preparing` sans erreur visible (bogue trouvé par le test native-real, GAO-tests-int-gr-001). Le refus doit devenir un événement `error` du sink pour le segment concerné (message du Core), le contrôleur applique sa politique (Réessayer / Passer / Arrêter), l'état n'est jamais laissé à `preparing`.
- Owner agent: backend-engineer (Stack), skills `platform-deploy-release`, `platform-reliability-sre`
- Profile: controlled
- Current state: `running` (mode non-interactif ; déplacé vers `needs_verification` en fin de tâche)
- Risk level: `low` (extension TypeScript, sink natif + contrôleur + tests ; aucun changement de contrat Core ; aucun commit)

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---|
| Sink natif | `vscode-extension/src/playback/NativeAudioSink.ts` (load, enqueue, sendEnqueue, post, emitError) | où le refus est converti en rejet au lieu d'événement | working tree | ~8k |
| Contrôleur | `vscode-extension/src/playback/PlaybackController.ts` (playIndex, handleSinkError, handleChunkFailure) | politique d'erreur CdC §52, état `preparing` | working tree | ~10k |
| Fakes | `vscode-extension/test/fakes/FakeCoreServer.ts` | injecter un ack d'erreur ciblé | working tree | ~3k |
| Preuve amont | `_grimoire-output/evidence/GAO-tests-int-gr-001/evidence-pack.md` | découverte du bogue | working tree | ~2k |

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| Write/Edit | write | `vscode-extension/src/playback/{NativeAudioSink,PlaybackController}.ts`, `vscode-extension/test/fakes/FakeCoreServer.ts`, `vscode-extension/test/unit/playback/**`, `_grimoire-output/evidence/GAO-bogue-un-seg-001/**` | jamais `.github/`, `crates/`, `scripts/decision-spike`, `scripts/narrator-eval` ; aucun commit |
| Bash | execute | npm test:unit/typecheck/lint/build, `xvfb-run -a npx vscode-test --label fake-tts`, `scripts/audio-proof/native-real.sh` | loopback, sink nul détruit par trap |

## LLM routing

| Step | Provider | Model | Fallback | Data policy |
|---|---|---|---|---|
| Implémentation, exécution, preuves | Anthropic | sonnet (backend-engineer) | — | code local, aucune donnée externe |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | brief non-interactif explicite | recorded |
| Implementation complete | correctif sink + contrôleur, tests | pending |
| Validation complete | tests rouges sans correctif puis verts ; suite complète ; native-real vert | pending |
