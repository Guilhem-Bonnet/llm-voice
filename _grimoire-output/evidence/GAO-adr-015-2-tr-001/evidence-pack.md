# Agentic Evidence Pack

- Task id: GAO-adr-015-2-tr-001
- Profile: controlled
- Owner: backend-engineer (Stack), mode non-interactif

## Livrables

| Fichier | Rôle |
|---|---|
| `vscode-extension/src/core/tts.ts` | type `DirectionCapabilities` et champ optionnel `TtsCapabilities.direction` (ADR-015 §5.2), additif |
| `vscode-extension/src/tts/ChatterboxProvider.ts` | `CHATTERBOX_DIRECTION` : intensité -> `exaggeration` (neutre 0,5, plafond provisoire 1), stabilité -> `cfg_weight` (0-1), pas de tempo, GPU |
| `vscode-extension/src/tts/SystemTtsProvider.ts` | tempo -> `speed` (0,5-2), CPU (Piper, espeak-ng, say, SAPI) |
| `vscode-extension/src/tts/KokoroProvider.ts`, `OpenAICompatibleTtsProvider.ts` | tempo `speed` (Kokoro) ; « voix et pauses seulement » (générique) ; `usesGpu: true` par prudence |
| `vscode-extension/src/direction/translator/translate.ts` | `translateCues` / `translatePartition` : consignes -> `TtsRequest` + segments de silence, trace (comptes seulement) |
| `vscode-extension/src/direction/translator/silence.ts` | WAV / `pcm16le` de silence exact, clé de cache durée + format + fréquence |
| `vscode-extension/src/direction/translator/navigation.ts` | `nextTarget`, `previousTarget`, `highlightOf`, `PlanCursor` (règles du §5.4) |
| `vscode-extension/test/unit/direction/translator/{translate,translate.property,navigation}.test.ts`, `support.ts` | tests 2, 3 et 15 |

## Vérifications exécutées

| Check | Commande | Résultat |
|---|---|---|
| Avant | `npm --prefix vscode-extension run test:unit` | 87 fichiers, 1127 tests verts |
| Après | idem | 90 fichiers, 1188 tests verts (+61 : 3 fichiers du traducteur ; les dossiers `bible/` et `controller/` des autres agents ne comptent pas encore de test) |
| Types | `npm run typecheck` | 0 erreur |
| Lint (mes fichiers) | `npx eslint src/direction/translator test/unit/direction/translator src/tts src/core/tts.ts --max-warnings=0` | propre ; `npm run lint` global : 1 avertissement dans `src/direction/bible/scopes.ts` (autre agent, hors périmètre) |
| Mutations | 5 mutations manuelles, fichier restauré | plafond d'intensité supprimé : 13 échecs ; borne cumulée : 6 ; borne moteur du tempo : 11 ; navigation via `-pre` : 4 ; garde « cue neutre » : 0 échec (voir ci-dessous) |

Mutation sans échec : retirer la garde `!neutral` ne change rien tant que le profil est dans les
bornes du moteur, ce qui est attendu (une cue neutre n'a ni tempo ni émotion). Un test dédié
(« a neutral cue is passed through untouched… ») couvre désormais le cas d'un profil hors bornes ;
la mutation n'a pas été rejouée après l'ajout de ce test (non vérifié).

## Tests de l'ADR couverts

- Test 2 : 18 combinaisons (3 liaisons x 6 moteurs dont « aucune capacité ») — `translatePartition` d'une partition neutre = liste des `TtsRequest` de l'`AudioQueue` réelle + `FakeTtsProvider`, champ au champ, aucun silence, mêmes `voice`/`parameters` de clé de cache.
- Test 3 : 5 graines x 200 tirages x 5 jeux de capacités, sortie brute -> `boundPartition` -> traduction, puis cues non bornées (NaN, ±Infinity) directement au traducteur ; bornes du moteur lues dans `getCapabilities()` des providers réels.
- Test 15 : `FakeAudioSink` ; surlignage (aucun changement sur `-post`, le `-pre` avance sur sa consigne), Suivant/Précédent jamais sur un silence, saut sans `-pre`.

## Écarts avec l'ADR et points ouverts

1. **Rattachement des silences dans `AudioQueue` / `PlaybackController` (point ouvert 9)** : lu, **ne s'exprime pas sans changer le contrôleur**. `PlaybackController.chunksFrom` fait un chunk par `NarrationSegment` et `AudioQueue` synthétise `spokenText` par le TTS : un silence (fichier déjà fait, sans source, non navigable) n'a pas de chemin. Modification nécessaire, hors périmètre de cette carte : un `AudioChunk` de genre silence (audio fourni, pas de synthèse, pas de `sourceRanges`), et `next()`/`previous()`/`chunkChanged` du contrôleur qui appliquent `nextTarget` / `previousTarget` / `PlanCursor` de `navigation.ts`. Les règles sont prouvées ici en pur ; l'intégration au vrai contrôleur ne l'est pas.
2. **La clé de cache ignore `speed`** (`computeCacheKey`, `src/playback/AudioCache.ts`) : un texte dit à deux tempos Piper aurait la même clé. Le traducteur expose `cacheParameters` (avec le `speed` appliqué, seulement si le tempo a été appliqué, donc inchangé pour une cue neutre) et `cacheVoice` (ajoute l'échantillon de référence : deux personnages clonés différents ne partagent pas d'entrée). L'`AudioQueue` doit les utiliser à l'intégration ; elle ne le fait pas aujourd'hui. La clé ignore aussi le `referenceAudio` du profil (défaut antérieur, non touché).
3. **Pas de dimension « stabilité » dans la consigne** : la partition (§3) n'a aucun champ que `cfg_weight` puisse porter. Le traducteur se borne à ramener la valeur du profil dans `[min, max]` du moteur ; aucune projection depuis l'émotion (ce serait une règle de style). À trancher avec l'ADR si le metteur en scène doit piloter la stabilité.
4. **`safeMax` d'`exaggeration` = 1** : valeur **provisoire non mesurée** (l'ADR dit « à étalonner » ; artefacts non mesurés). Surchargeable par `intensityCalibration`, plafonnée par le descripteur (0-2). À étalonner à l'étape 6.
5. **Rendu des consignes** (`instructions`, balises non verbales) : aucun moteur actuel ne le porte ; emphase, note de jeu, états et balises sont ignorés et comptés dans la trace. La forme native d'un moteur à consignes relève de l'étape 9.
6. **`usesGpu`** : Chatterbox `true` (ADR), Kokoro et générique OpenAI-compatible `true` **par prudence, non vérifiés** (le mode jeu les évitera) ; système `false`.
7. **`voiceFor` fourni par l'appelant** : le traducteur ne lit pas la bible (étape 3 en parallèle) ; `VoiceChoice` (voix, modèle, `referenceAudio` ou `null`, paramètres). Locuteur inconnu = voix du narrateur/profil, compté dans `trace.unknownSpeakers`. Le choix de l'instance `ChatterboxProvider` par `referenceAudio` reste à faire dans `Pipeline.ttsFor` (non touché).
8. **Rien n'est branché** dans `Pipeline`/`PlaybackController` : module et tests seulement, direction désactivée par défaut.
9. Aucun manque bloquant dans `src/core/direction.ts` : `silenceSegmentId`, `isNeutralCue`, `baselineTtsRequest`, `clampNumber` et `DIRECTION_BOUNDS` ont suffi.

## Non vérifié

- Le rendu réel par Chatterbox d'un `exaggeration` élevé, la durée réelle des silences de bord des moteurs (point ouvert 2), la lecture d'un silence par le Core (test 4 de l'ADR, banc audio, hors carte) : rien n'a été joué, aucun LLM, aucun GPU.

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->
