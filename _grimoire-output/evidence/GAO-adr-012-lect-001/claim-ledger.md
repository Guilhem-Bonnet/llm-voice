# Agentic Claim Ledger

Une affirmation sans preuve reste une hypothèse. Ce registre relie chaque
affirmation qui pèse sur une décision ou une livraison à ce qui la prouve.

- Task id: GAO-adr-012-lect-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | L'utilisateur a validé l'option E le 2026-09-27 | décision | `decisions-log.md`, entrée « option E validée par l'utilisateur » (« Ok, je valide l'option E ») | prouvé | élevée | utiliser |
| CL-002 | Un webview VS Code refuse `audio.play()` sans geste utilisateur, y compris en muet ; 0 flux PipeWire | fait | `evidence/GAO-diagnostic-s-001/evidence-pack.md`, section « Cause racine » (reproduit deux fois) | prouvé | élevée | utiliser |
| CL-003 | `autoplayPolicy: "user-gesture-required"` est imposé par VS Code | hypothèse | veille `lecture-audio-native.md` (« contexte de la tâche ») ; aucune preuve binaire trouvée dans le pack de diagnostic | hypothèse | moyenne | l'ADR la présente comme « cohérente avec » la mesure, pas comme preuve |
| CL-004 | Aucune voie Node sans compilation ne fournit pause, seek et position | fait | `controle-lecture-native-et-gapless.md`, `lecture-audio-native.md` ; synthèse §A.1 | prouvé | élevée | utiliser |
| CL-005 | `AudioSink` expose `load`/`play`/`pause`/`stop`/`seek` et `timeupdate`/`ended`/`error` ; `load()` remplace le chunk chargé | fait | `vscode-extension/src/playback/AudioSink.ts` lu | prouvé | élevée | utiliser |
| CL-006 | `extensionKind: ["ui"]` est déclaré | fait | `vscode-extension/package.json` lignes 24-26 | prouvé | élevée | utiliser |
| CL-007 | Scores du débat E 82,1 / D 81,6 / F 72,1 / A 66,4 / C 59,9 / B 54,4 | résultat | synthèse §B.3 (notes d'arbitre, pas des mesures) | prouvé | élevée | utiliser |
| CL-008 | Seuils de blanc, dérive, reprise ; tailles de binaires ; signature macOS | hypothèse | non mesurés | hypothèse | faible | vérifier au spike et à la carte packaging |

Types : `fait`, `hypothèse`, `résultat`, `décision`. Statuts : `prouvé`,
`hypothèse`, `contredit`. Confiance : `faible`, `moyenne`, `élevée`. Décision :
`utiliser`, `vérifier`, `rejeter`.

## Synthèse

| Question | Réponse |
|---|---|
| Affirmations bloquantes non prouvées | aucune (CL-003 n'est pas porteuse : la mesure CL-002 suffit) |
| Contradictions détectées | le brief annonçait la politique « confirmée dans le binaire » ; non retrouvé dans le pack cité |
| Hypothèses acceptées temporairement | CL-003, CL-008 |
| Preuves à obtenir avant livraison du code | spike `llm-voice-audio` contre mpv au banc de preuve audio |
