# Agentic Claim Ledger

- Task id: GAO-bogue-un-seg-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | Cause : `NativeAudioSink.load()` rejetait sur ack `ok:false` (`post`, l.379-398) au lieu d'émettre `error` ; le rejet sortait de `PlaybackController.playIndex` l.596 sans politique d'erreur, état resté `preparing` | résultat | 6 tests rouges avant correctif (`Core: enqueue refused ...` levé depuis `playIndex`) | prouvé | élevée | utiliser |
| CL-002 | Un refus Core / échec réseau sur `load`/`enqueue`/`play` produit un événement `error` avec le message du Core | résultat | `native-audio-sink.test.ts` (4 nouveaux tests) verts | prouvé | élevée | utiliser |
| CL-003 | Contrôleur : politique stop -> `error`, skip -> segment suivant joué, jamais `preparing`, jamais `playing` pour le segment refusé même avec décision lente | résultat | `native-refusal.test.ts` 4 verts ; test « décision lente » rouge sans `generation += 1` | prouvé | élevée | utiliser |
| CL-004 | Aucune régression : unit 1036 verts, typecheck, lint, build, fake-tts 63 passing, native-real vert (WER 0,0455) | résultat | commandes du evidence-pack | prouvé | élevée | utiliser |
| CL-005 | La notification utilisateur réelle s'affiche pour ce cas dans VS Code | hypothèse | — | non vérifié | moyenne | vérifier (test manuel ou intégration) |
| CL-006 | Les autres sinks (Webview) ne rejettent pas sur `load` | hypothèse | — | non vérifié | faible | auditer si besoin |

## Synthèse

| Question | Réponse |
|---|---|
| Affirmations bloquantes non prouvées | aucune |
| Contradictions détectées | aucune |
| Hypothèses acceptées | CL-005, CL-006 |
