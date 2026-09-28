# Agentic Evidence Pack

## Summary

- Task id: GAO-contrat-audi-001
- Profile: controlled
- Outcome: contrat `AudioSink` v2 (préchargement `enqueue`/`clearQueue`, événement `started`, `underrun`, `ended` après vidange, position absolue exacte au moment de la pause) ; `PlaybackController` précharge le chunk suivant et enchaîne deux chunks prêts sans aller-retour `ended`→`load` ; adaptateur `SequencedAudioSink` pour le moteur webview (v1 → v2, `gapless: false`) ; `FakeAudioSink` v2. Le Core Rust n'est pas écrit ici.
- Final state: needs_verification (2026-09-28)

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| Contrat v2 | `vscode-extension/src/playback/AudioSink.ts` (`AudioSink` v2 + `LegacyAudioSink` v1) | backend-engineer | tsc vert |
| Adaptateur webview | `vscode-extension/src/playback/SequencedAudioSink.ts` ; `WebviewAudioSink` implémente `LegacyAudioSink` ; `PlayerViewProvider.playbackSink` ; `Pipeline.ts` utilise `playbackSink` | backend-engineer | tsc vert |
| Contrôleur | `vscode-extension/src/playback/PlaybackController.ts` (`preloadAfter`, `handleStarted`, `handleUnderrun`, `handlePreloadFailure`, `onUnderrun`) | backend-engineer | tests verts |
| Fake v2 | `vscode-extension/test/fakes/FakeAudioSink.ts` (`received`, `enqueues`, `timeline`, position par temps écoulé, `underrun`, `failEnqueued`) | backend-engineer | tests verts |
| Tests v2 | `vscode-extension/test/unit/playback/audio-sink-v2.test.ts` (11 contrôleur + 6 adaptateur) | backend-engineer | 17/17 |
| Tests unitaires | `npm run test:unit` | backend-engineer | exit 0 ; 956 avant la carte, 973 après ma modification, 1 010 au moment de la vérification finale (dont d'autres cartes en cours) |
| Lint / typecheck | `npm run lint` ; `npm run typecheck` | backend-engineer | exit 0 ; exit 0 |
| Build | `npm run build` | backend-engineer | exit 0 |
| Intégration | `xvfb-run -a npx vscode-test --label fake-tts` ; `--label prefetch-chunks-fake-tts` | backend-engineer | exit 0, 63 passing ; exit 0, 1 passing |
| Mutation | retrait de l'appel `preloadAfter` dans `playIndex`, relance de `audio-sink-v2.test.ts` | backend-engineer | 5 échecs dont « aucun aller-retour ended→load » ; code restauré, 156/156 dans `test/unit/playback` |

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->

## Validation

| Exigence (brief, spike CL-002/003/004) | Test | Résultat |
|---|---|---|
| Aucun aller-retour `ended`→`load` entre deux chunks prêts | `chains two ready chunks with no ended→load round trip` (`timeline[ended+1] === started:<suivant>`, un seul `load`) | vert |
| Position monotone | `reports a monotone absolute position, across chunks and a pause` | vert |
| Pause/reprise conserve la position | `pause and resume keep the exact position, without reload or seek` (pause à 1 284 ms entre deux ticks, reprise 1 534 ms) | vert |
| Underrun quand le suivant n'est pas prêt | `signals an underrun when the next chunk is not ready, then falls back to load` | vert |
| `ended` après vidange | sémantique du contrat ; le fake n'émet `ended` qu'à position = durée | contrat seulement (voir déviations) |
| Compatibilité webview | 6 tests `SequencedAudioSink` + intégration `fake-tts` | vert |

## Deviations and accepted risks

| Deviation | Impact | Accepted by | Review trigger |
|---|---|---|---|
| Trois tests existants changent d'attente : un `load` + un `play` au lieu de trois ; position de pause 800 ms au lieu de 750 ms (position exacte, plus le dernier tick) | comportement voulu du contrat v2 | backend-engineer (brief) | revue de la carte |
| `ended` après vidange et position par échantillons non prouvés sur un vrai moteur : seul le fake les modélise | exigence reportée sur le Core et son banc | backend-engineer | carte Core / `NativeAudioSink` |
| `SequencedAudioSink` (webview) garde un rechargement interne à la jonction : `gapless: false`, `ended` et position tels que rapportés par `<audio>` | le repli webview n'est pas sans blanc | backend-engineer | bascule `llmVoice.audio.engine` |
| Underrun en cours de chunk seulement relayé (`onUnderrun`), sans passage en `buffering` | pas de retour visuel tant que le Core n'existe pas | backend-engineer | carte Core |
| Avec `prefetchChunks = 0`, aucun préchargement (fenêtre de synthèse respectée) | retombe sur le chemin `load` v1 | backend-engineer | — |
| Blanc de jonction toujours non mesuré sur tonalités (CL-005 du spike) | critère « gapless » chiffré absent | backend-engineer | carte Core (banc) |
| Budget de 400 écritures atteint en cours de session ; levé par le coordinateur | aucune sur le résultat | coordinateur | — |
