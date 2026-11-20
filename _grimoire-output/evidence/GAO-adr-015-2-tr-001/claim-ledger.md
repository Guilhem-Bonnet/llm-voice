# Agentic Claim Ledger

- Task id: GAO-adr-015-2-tr-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | Une partition neutre donne, pour 3 liaisons x 6 moteurs, exactement les `TtsRequest` que l'`AudioQueue` réelle envoie, sans silence, avec les mêmes voix et paramètres de clé de cache | résultat | `translate.test.ts` bloc « test 2 » (18 cas + hors bornes + plages) | prouvé | élevée | utiliser |
| CL-002 | Toute sortie brute aléatoire (5 x 200 tirages, valeurs extrêmes) et toute cue non bornée (NaN, ±Infinity) donnent des paramètres dans les bornes de l'ADR §7 et dans celles de `getCapabilities()` des providers réels | résultat | `translate.property.test.ts` (prouvé sur ces tirages, non exhaustif) | prouvé | élevée | utiliser |
| CL-003 | Les silences durent exactement la pause demandée (WAV et pcm16le, 4 fréquences), le silence cumulé entre deux consignes est <= 3 000 ms, les identifiants respectent `^[A-Za-z0-9_-]+$` et sont uniques, y compris pour des `cueId` hostiles | résultat | `translate.test.ts` bloc « silence segments », test de propriété | prouvé | élevée | utiliser |
| CL-004 | Précédent/Suivant ne s'arrêtent jamais sur un silence et sautent le `-pre` ; le surlignage suit le §5.4, avec `FakeAudioSink` | résultat | `navigation.test.ts` | prouvé | élevée | utiliser |
| CL-005 | Ces règles de navigation sont appliquées par le vrai `PlaybackController` | hypothèse | contrôleur non modifié (hors périmètre) : il ne connaît pas les silences | non prouvé | — | signaler (écart 1) |
| CL-006 | Les tests détectent un plafond d'intensité supprimé, une borne cumulée supprimée, une borne moteur du tempo supprimée, une navigation passant par le `-pre` | résultat | 4 mutations manuelles : 13, 6, 11 et 4 échecs, fichiers restaurés | prouvé | élevée | utiliser |
| CL-007 | Aucune régression : 1127 -> 1188 tests verts, typecheck 0 erreur, lint propre sur mes fichiers | résultat | `npm run test:unit`, `typecheck`, `eslint` ciblé ; `npm run lint` global : 1 avertissement dans `src/direction/bible/scopes.ts` (autre agent) | prouvé | élevée | utiliser |
| CL-008 | `safeMax` d'`exaggeration` = 1 évite les artefacts de Chatterbox | hypothèse | valeur provisoire choisie ; ADR : artefacts non mesurés | non vérifié | faible | étalonner (étape 6) |
| CL-009 | `usesGpu: true` pour Kokoro et les moteurs OpenAI-compatibles génériques | hypothèse | prudence pour le mode jeu ; matériel réel non vérifié | non vérifié | moyenne | vérifier |
| CL-010 | La clé de cache d'aujourd'hui ignore `speed` | fait | lecture de `computeCacheKey` (`AudioCache.ts`) | prouvé (par lecture) | élevée | traiter à l'intégration |

Types : `fait`, `hypothèse`, `résultat`, `décision`. Statuts : `prouvé`, `hypothèse`, `contredit`.

## Synthèse

| Question | Réponse |
|---|---|
| Affirmations bloquantes non prouvées | CL-005 (intégration au contrôleur) : hors périmètre de cette carte, à confier à une carte suivante |
| Contradictions détectées | aucune |
| À relire | écarts 1 à 4 de l'evidence pack |
