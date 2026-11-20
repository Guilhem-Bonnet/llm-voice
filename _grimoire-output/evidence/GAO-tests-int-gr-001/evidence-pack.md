# Agentic Evidence Pack

## Summary

- Task id: GAO-tests-int-gr-001
- Profile: controlled
- Outcome: label `native-real` (`vscode-extension/.vscode-test.mjs`), test `vscode-extension/test/integration-native-real/native-real.test.ts` (Markdown `test/fixtures-native-real/native-real.md`, 3 phrases), script `scripts/audio-proof/native-real.sh`. Run vert : test 1 passing + banc `pass: true` (exit 0). Contre-preuve (`segmentId: chunk.chunkId` au lieu de `encodeSegmentId(...)`) : test rouge en 679 ms + banc `silent: true` (exit 1). Rien de commité.
- Final state: prêt pour vérification

## Evidence inventory

| Evidence | Location | Result |
|---|---|---|
| Label isolé | `.vscode-test.mjs` : `--user-data-dir=.vscode-test/native-real`, `--extensions-dir=.vscode-test/native-real-extensions`, `settings.json` pré-semé (`audio.engine=native`, `audio.corePath=<repo>/target/release/llm-voice-core`, `tts.provider=system`, `defaultProfile`), `profiles.json` pré-semé (providerId `system`, 1 phrase par chunk) | présent ; typecheck + eslint verts |
| Test | `test/integration-native-real/native-real.test.ts` : saute si `LLM_VOICE_NATIVE_REAL!=1` ; `speakDocument` ; attend `completed` ; échoue vite sur `chunk failed\|start failed\|invalid_request` dans `LLM Voice.log` ; exige >= 2 segments démarrés (tous), état final `completed`, `core.json` + pid vivant dans `LLM_VOICE_CORE_STATE_DIR` isolé | vert (run vert) |
| Script | `scripts/audio-proof/native-real.sh` : `cargo build --release -p llm-voice-core`, `npm run build`, `prove.sh --post-roll 3 --play-cmd "native-real.sh --inner"` ; `--inner` route le Core (`pactl set-default-sink`, `PIPEWIRE_PROPS` comme `native-sink-play.sh`, restauré par trap), `LLM_VOICE_CORE_STATE_DIR` jetable, `xvfb-run -a npx vscode-test --label native-real` ; sortie 0 seulement si test ET banc verts | exit 0 (vert), exit 1 (contre-preuve) |
| Run vert | `run-green.json` (stdout du script), durée ~31 s | `{"wer": 0.1364, "transcription": "Bonjour, ceci est un test de l'éture vocale. Le moteur natif joue chaque frais à son tour. La lecture se termine proprement.", "duration_s": 17.408, "silence_max_ms": 7640.0, "rms": 0.119934, "silent": false, "wer_ok": true, "pass": true}` ; mocha `1 passing (9s)` ; `test exit=0, prove exit=0` |
| Contre-preuve | `run-counterproof.json` | `{"wer": 0.9545, "transcription": "Sous-titres réalisés par la communauté d'Amara.org", "duration_s": 9.216, "silence_max_ms": 9200.0, "rms": 0.0, "silent": true, "wer_ok": false, "pass": false}` ; mocha `0 passing (679ms) 1 failing` : `journal reports a failure while playing: [error] start failed {"error":"Core: enqueue refused (invalid_request): requête invalide : segmentId \"session-1:0\" ne respecte pas ^[A-Za-z0-9_-]+$"}` ; `test exit=1, prove exit=1` (script exit 1) |
| Restauration | `git diff -- vscode-extension/src/playback/NativeAudioSink.ts` vide (0 ligne) ; `npm run build` refait après restauration | ok |

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->

## Deviations et notes

- Première contre-preuve (avant durcissement du test) : le test échouait seulement par délai (150 s, état `preparing` bloqué), car un enqueue refusé ne fait pas passer le contrôleur en `error` et le journal porte `start failed` (pas `chunk failed`). Le test surveille donc le journal toutes les 500 ms et échoue tout de suite ; motif élargi à `start failed`. Les deux sorties consignées sont celles de la version finale.
- Le journal est lu dans `context.logUri/LLM Voice.log` (le `LogOutputChannel` y écrit) ; l'assertion positive `llmVoice.audio.engine=native` présent garde contre un journal illisible.
- « Segments terminés » : l'API de test n'expose pas les événements du sink natif ; observé via l'index de chunk du contrôleur (chaque index vu en `playing`) et l'état final `completed`, qui n'arrive qu'après `segment_ended` du dernier segment. Non vérifié : un compte direct d'événements `segment_ended` côté Core.
- Le banc transcrit imparfaitement Piper (« l'éture », « frais » ; WER 0,1364 < 0,25) : bruit de transcription faster-whisper, pas de troncature.
- `package.json` non touché par cette carte (sa modification dans `git status` préexiste).
- `vitest run` (unit) : sortie non analysable par le filtre RTK, non vérifié ; aucun fichier `src/` modifié (contre-preuve restaurée octet pour octet).
