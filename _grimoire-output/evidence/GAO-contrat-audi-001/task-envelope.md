# Agentic Task Envelope

## Task

- Task id: GAO-contrat-audi-001
- Request: Contrat `AudioSink` v2 pour une lecture native sans blanc (préchargement du chunk suivant, position absolue en ms, sous-alimentation `underrun`, `ended` après vidange du périphérique) ; adaptation de `PlaybackController` (enchaînement de deux chunks prêts sans aller-retour `ended`→`load`) ; `FakeAudioSink` v2 et tests vitest. Le Core Rust n'est pas écrit ici.
- Owner agent: backend-engineer (Stack), skill attachée `platform-reliability-sre` (sémantique d'underrun, position exacte)
- Profile: controlled
- Current state: `running` (mode non-interactif)
- Risk level: `medium` (touche le chemin de lecture de toutes les sessions ; compatibilité du moteur webview à préserver ; aucun réseau, aucun binaire natif)

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---:|
| Décision d'architecture | `docs/adr/ADR-012-native-audio-core.md` §3 | sémantique v2 imposée (préchargement, position absolue par chunk, `underrun`) ; noms laissés à cette carte | 2026-09-28 | ~4k |
| Exigences du spike | `_grimoire-output/evidence/GAO-spike-moteur-001/evidence-pack.md`, `claim-ledger.md` (CL-002, CL-003, CL-004) | position absolue exacte, reprise exacte, `ended` après vidange | 2026-09-28 | ~2k |
| Code de jonction | `vscode-extension/src/playback/{AudioSink,PlaybackController,AudioQueue,WebviewAudioSink}.ts` | contrat et machine à états à faire évoluer | HEAD bcb5bd7 | ~8k |
| Double de test | `vscode-extension/test/fakes/FakeAudioSink.ts`, `test/unit/playback/playback-controller.test.ts`, `test/integration/{pipeline,latency}.test.ts` | usages de `loads`/`emitEnded` à garder cohérents | HEAD bcb5bd7 | ~6k |

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| Write/Edit | write | `vscode-extension/src/playback/**`, `vscode-extension/src/pipeline/Pipeline.ts` (choix du sink), `vscode-extension/src/views/player/PlayerViewProvider.ts`, `vscode-extension/test/**`, `_grimoire-output/evidence/GAO-contrat-audi-001/**` | jamais `contracts/` ni `crates/` (autre carte en cours) ; aucun commit |
| Bash | execute | `npm --prefix vscode-extension run test:unit/lint/typecheck/build`, `xvfb-run -a npx vscode-test --label fake-tts` | aucun accès réseau, aucun service tiers |
| Bash (grimoire) | execute | `grimoire task context/move`, `grimoire standard decision trace/gate` sur cette carte | ledger et board de cette carte uniquement |

## LLM routing

| Step | Provider | Model | Fallback | Data policy |
|---|---|---|---|---|
| Contrat, contrôleur, fake, tests (backend-engineer) | Anthropic | opus (dispatch) | — | code local, aucune donnée externe |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | brief non-interactif explicite (concierge, 2026-09-28) ; sémantique fixée par ADR-012 §3 | recorded |
| Implementation complete | `AudioSink.ts` v2, adaptateur webview, `PlaybackController` préchargement, `FakeAudioSink` v2 | en cours |
| Validation complete | `test:unit`, `lint`, `typecheck`, intégration `fake-tts` ; `grimoire standard gate check --task-id GAO-contrat-audi-001 --strict` | en cours |
| Deviations documented | `evidence-pack.md` de cette tâche | en cours |
