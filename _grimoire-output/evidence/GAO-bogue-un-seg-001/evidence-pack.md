# Agentic Evidence Pack

## Summary

- Task id: GAO-bogue-un-seg-001
- Profile: controlled
- Outcome: un refus du Core (ack `ok:false`, HTTP 400) ou un échec réseau sur `stop`/`enqueue` pendant `load()` devient un événement `error` du sink pour le segment concerné ; le contrôleur applique sa politique (Passer / Arrêter / Réessayer) et ne reste plus en `preparing`. Rien de commité.
- Final state: prêt pour vérification

## Cause exacte

- `vscode-extension/src/playback/NativeAudioSink.ts:230-231` (avant correctif) : `load()` faisait `await this.post("stop")` puis `await this.sendEnqueue(chunk)` ; `post()` (l.379-398) lève une `Error` quand `ok:false`. `load()` rejetait donc au lieu d'émettre `error`.
- `vscode-extension/src/playback/PlaybackController.ts:596` (`playIndex`, `await session.sink.load(...)`) : le rejet remontait hors de `playIndex`/`start()` sans passer par `handleSinkError`/`handleChunkFailure` (l.524, 707) : ni politique d'erreur, ni notification, état laissé à `preparing` (posé l.247). Seul le journal portait `start failed`.
- Même défaut, chemin `enqueue()` d'une file en famine (`NativeAudioSink.ts` ancien l.248) : rejet au lieu d'événement.
- Course associée corrigée : quand `load()` signale l'échec par événement, `playIndex` reprenait après le `await` et faisait passer le chunk refusé à `playing` (+ `sink.play()`) tant que la décision utilisateur (notification, asynchrone) était en attente ; `handleSinkError` invalide maintenant la génération avant d'attendre la politique.

## Correctif

- `NativeAudioSink.load()` : `stop` + `sendEnqueue` dans un `try/catch` -> `emitError(chunkId, message du Core)` ; `load()` ne rejette plus.
- `NativeAudioSink.enqueue()` (branche famine / sans lecteur) : idem, et restauration de `current`/`starved` puisque le Core n'a pas reçu le chunk.
- `PlaybackController.handleSinkError` : `this.generation += 1` avant `handleChunkFailure`.
- Inchangés (déjà corrects) : `play`/`pause`/`seek` (`.catch` -> `emitError`), `trySendAhead` (`.catch` -> `emitError`).
- Fake : `FakeCoreServer.failNextOn(path, error)` (ack d'erreur ciblé par verbe ; `failNextWith` frappait `stop`, premier verbe de `load()`).

## Tests

| Preuve | Commande | Résultat |
|---|---|---|
| Avant correctif (contre-preuve) | `npx vitest run test/unit/playback/native-audio-sink.test.ts test/unit/playback/native-refusal.test.ts` avec les 2 fichiers `src/` non corrigés | `6 failed \| 12 passed (18)` : rejets `Core: enqueue refused (invalid_request)` / `fetch failed` sortis de `PlaybackController.playIndex` |
| Avant correctif, course | `git stash` de `PlaybackController.ts` seul (sink corrigé), `native-refusal.test.ts` | `1 failed \| 3 passed` : « slow user decision » (chunk refusé passé `playing`) |
| Après correctif | mêmes fichiers | `18 passed` (sink 4 nouveaux tests, contrôleur 4 tests : stop, skip, décision lente, échec réseau) |
| Unit complet | `npm run test:unit` | `1036 passed (1036)` |
| Types / lint / build | `npm run typecheck` ; `npm run lint` ; `npm run build` | exit 0 ; `ESLint: No issues found` ; `Done` |
| Intégration fake | `xvfb-run -a npx vscode-test --label fake-tts` | `63 passing`, exit 0 |
| native-real | `bash scripts/audio-proof/native-real.sh` | mocha `1 passing (9s)` ; banc `{"wer": 0.0455, "silent": false, "wer_ok": true, "pass": true}` ; `test exit=0, banc exit=0` |

Fichiers : `vscode-extension/src/playback/NativeAudioSink.ts`, `vscode-extension/src/playback/PlaybackController.ts`, `vscode-extension/test/fakes/FakeCoreServer.ts`, `vscode-extension/test/unit/playback/native-audio-sink.test.ts`, `vscode-extension/test/unit/playback/native-refusal.test.ts` (nouveau).

## Deviations et notes

- Non vérifié : l'affichage réel de la notification « Réessayer / Passer / Arrêter » dans VS Code sur un refus du Core (couvert au niveau contrôleur avec politique injectée ; le chemin `Pipeline.handleChunkError` -> `notifications.ts` n'a pas été rejoué de bout en bout pour ce cas).
- Non ajouté : filet `try/catch` autour de `sink.load()` dans `playIndex` pour d'autres sinks qui rejetteraient (risque de double traitement avec un événement `error`) ; `WebviewAudioSink.load` non audité pour ce point.
- Le journal de la carte amont (`start failed`) ne devrait plus apparaître pour un refus ; il devient `chunk failed` / politique d'erreur.

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->
