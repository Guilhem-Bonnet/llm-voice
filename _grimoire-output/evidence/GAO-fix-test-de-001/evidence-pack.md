# Evidence pack — GAO-fix-test-de-001

## Causes établies

1. **Estelle muette.** `pocket-tts serve` streame un WAV dont l'en-tête annonce
   2 000 000 000 octets de données (mesuré : 121 004 octets réels). Le cœur natif
   décode avec `hound`, qui échoue : `Failed to read enough bytes` (reproduit avec
   `target/release/llm-voice-audio-play`).
2. **Échec invisible.** `Pipeline.handleChunkError` passait un échec d'origine
   `playback` en `skip` sans message : la session finissait en `completed`, en
   silence, et le bouton Test affichait « Lecture terminée. ».
3. **Cache empoisonné.** Le WAV cassé restait dans le cache disque de l'utilisateur
   (`34004912ff71…`), la clé ne dépendant ni du code ni de l'adresse.
4. **Pause.** `player.js` décidait sur `audio.paused`, toujours vrai en moteur
   natif : le bouton envoyait `play`, sans effet pendant la lecture.
5. **Port 8004.** `llmVoice.tts.baseUrl` vaut par défaut `http://127.0.0.1:8004`.
   Un profil `kyutai-pocket` sans adresse y retombait. Cela corrige le diagnostic de
   GAO-fix-l-url-du-001, qui attribuait cette adresse à un reste dans le champ.
6. **Angle mort des tests.** Le faux serveur de `KyutaiPocketProvider.test.ts`
   renvoyait des tailles exactes, contrairement au vrai serveur. L'anomalie
   `duration_s: 41666` avait été écartée à tort dans GAO-fix-voix-fra-001.

## Diff

- `src/tts/KyutaiPocketProvider.ts` : `repairStreamedWavSizes`.
- `media/player/player.js` : décision sur l'état `data-state`.
- `src/pipeline/Pipeline.ts`, `src/ui/notifications.ts` : notification d'échec de lecture.
- `src/pipeline/resolveProviderConfig.ts` : port propre à `kyutai-pocket`.
- `media/profileEditor/profileEditor.js` : « Lecture lancée. » au lieu de « Lecture terminée. ».
- `scripts/audio-proof/native-real.sh --kyutai`, `test/integration-native-real/kyutai-pause.test.ts`,
  `.vscode-test.mjs` : scénario de bout en bout.
- `scripts/audio-proof/analyze.py` : `silence_between_sounds_ms`, `vad_filter=True`.
- Cache utilisateur : en-tête de `34004912ff71….wav` réécrit en place (8 octets).

## Preuves exécutées

Chaîne : vrai VS Code sans écran, moteur natif, vrai cœur, vrai `pocket-tts serve`,
voix Estelle, chemin du bouton Test côté hôte, pause de 2,5 s, capture sur sink nul.

| Exécution | Test | WER | Silence mesuré | Verdict |
|---|---|---|---|---|
| Contrôle, sans `repairStreamedWavSizes` | échec : `completed` sans `playing` | 2,25 | capture muette | panne reproduite |
| Avec correctif, cache de test empoisonné par le contrôle | échec en 87 ms | 2,25 | capture muette | piège du cache reproduit |
| Avec correctif, cache vide | vert | 0,0 | 2500 ms | réussi |
| Build final, avant `vad_filter` | vert | 0,3 | 2500 ms | échec du banc : fin hallucinée par Whisper |
| Build final, avec `vad_filter`, 3 exécutions | vert 3/3 | 0,05 ; 0,0 ; 0,0 | 2460 ; 2500 ; 2500 ms | réussi 3/3 |
| Non-régression Piper (`native-real.sh`) | vert | 0,0455 | — | réussi |

`npm run test:unit` : 111 fichiers, 1909 tests verts. `tsc` et `eslint` sans erreur.
Dernière exécution conservée : `native-real-kyutai.log`.

## Relecture indépendante

`agent-optimizer`, modèle sonnet, 2026-11-05 : accepté avec réserves, aucune bloquante.

- **Seuil de pause absent : corrigé.** `native-real.sh --kyutai` échoue désormais sous
  2 s de silence. Validé dans les deux sens : pause de 2,5 s → 2480 ms, sortie 0 ;
  pause réduite à 0,2 s → 1000 ms, sortie 1.
- **Réarmement de la notification : écarté après vérification.** `startInternal` appelle
  `notificationGate.reset()` (`src/pipeline/Pipeline.ts:554`), ce qui réarme tous les types.
- **Bouton sans effet en `preparing`/`buffering` : conservé comme limite.**
- **`vad_filter` et capture partielle : conservé comme limite.**

## Limites

- Le clic physique sur le bouton n'est pas exercé : la pause de bout en bout passe par
  `llmVoice.pause`, qui appelle le même `pipeline.pause()` ; le bouton est prouvé par le
  vrai `player.js` sur DOM factice (`test/unit/views/player.behavior.test.ts`).
- Le test passe par le message `test` de l'éditeur, pas par un clic dans la webview.
- `vad_filter=True` change le banc pour tous les scénarios ; seul Piper a été recontrôlé.
- En `preparing` ou `buffering`, le bouton envoie `play`, sans effet (`src/commands/playDecision.ts`) ;
  l'absence de son dans ces états n'a pas été mesurée.
- `vad_filter=True` peut laisser passer une capture partielle : le WER ne compare que les
  passages détectés comme parole.
- Kokoro garde le même défaut de port quand un profil n'a pas d'adresse : non traité.
- Un WAV cassé déjà en cache ne se répare pas seul : seul le cache de cette machine a été traité.
- La qualité perçue de la voix reste à juger à l'oreille.

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->
