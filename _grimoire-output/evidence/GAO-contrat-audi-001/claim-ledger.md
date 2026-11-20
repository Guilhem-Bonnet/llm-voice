# Agentic Claim Ledger

- Task id: GAO-contrat-audi-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | Deux chunks prêts sont enchaînés sans aller-retour `ended`→`load` | résultat | `audio-sink-v2.test.ts` « chains two ready chunks… » ; mutation : échoue sans `preloadAfter` (sur `FakeAudioSink`) | prouvé | élevée | utiliser |
| CL-002 | La position rapportée est monotone par chunk, y compris à travers une pause | résultat | test « monotone absolute position » (sur `FakeAudioSink`) | prouvé | élevée | utiliser |
| CL-003 | Pause/reprise conserve la position exacte, sans rechargement ni seek | résultat | test « pause and resume keep the exact position » (sur `FakeAudioSink`) | prouvé | élevée | utiliser |
| CL-004 | Un underrun est signalé quand le suivant n'est pas prêt, puis le chemin `load` prend le relais | résultat | test « signals an underrun… » (sur `FakeAudioSink`) | prouvé | élevée | utiliser |
| CL-005 | Le moteur webview reste utilisable via `SequencedAudioSink` | résultat | 6 tests adaptateur ; intégration `fake-tts` 63 passing (le fake remplace le webview : le webview réel n'est pas exercé) | prouvé | moyenne | utiliser |
| CL-006 | `ended` après vidange et position par échantillons sur le moteur natif | hypothèse | contrat seulement ; aucun moteur natif branché | hypothèse | faible | vérifier (carte Core) |
| CL-007 | Lecture sans blanc audible à la jonction | hypothèse | non mesuré (CL-005 du spike toujours ouvert) | hypothèse | faible | vérifier (banc, tonalités) |

## Synthèse

| Question | Réponse |
|---|---|
| Affirmations bloquantes non prouvées | aucune pour le contrat ; CL-006 et CL-007 relèvent de la carte Core |
| Contradictions détectées | aucune |
| Hypothèses acceptées temporairement | CL-006, CL-007 |
| Preuves à obtenir avant livraison | banc audio du `NativeAudioSink` (vidange, jonction sur tonalités) ; E2E webview réel du repli |
