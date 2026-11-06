# Agentic Claim Ledger

Une affirmation sans preuve reste une hypothèse. Ce registre relie chaque
affirmation qui pèse sur une décision ou une livraison à ce qui la prouve.

- Task id: GAO-fix-wav-cass-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | Un WAV cassé en cache guérit à la lecture et produit du son | résultat | `_grimoire-output/evidence/GAO-fix-wav-cass-001/native-real-cache-empoisonne.log` ; `vscode-extension/test/unit/playback/disk-audio-cache.test.ts` | prouvé | élevée | utiliser |
| CL-002 | La fenêtre de l'utilisateur tournait sur un code antérieur au correctif | fait | `_grimoire-output/evidence/GAO-fix-wav-cass-001/evidence-pack.md` (journal et dates du cache) | prouvé | élevée | utiliser |
| CL-003 | La lecture d'un document chez l'utilisateur fonctionne après rechargement | hypothèse | à confirmer par l'utilisateur | hypothèse | moyenne | vérifier |

Types : `fait`, `hypothèse`, `résultat`, `décision`. Statuts : `prouvé`,
`hypothèse` (ou `non vérifié`, son synonyme), `contredit`, `réfuté`. Confiance :
`faible`, `moyenne`, `élevée`. Décision : `utiliser`, `vérifier`, `rejeter`,
`écarter`. Une précision entre parenthèses ou après `;` est tolérée
(`prouvé (par lecture)`) ; une barre dans une cellule s'écrit `\|`.

## Preuve minimale par type d'affirmation

| Type | Preuve minimale |
|---|---|
| Fichier ou code | chemin lu, diff ou extrait |
| Test | commande et résultat |
| API ou norme | contrat, documentation officielle ou code |
| Design | charte, design system, maquette ou validation |
| Sécurité | scan, règle, revue ou threat model |
| Mémoire | source originale, date, score, portée |
| Décision client | validation explicite ou ticket |

## Synthèse

| Question | Réponse |
|---|---|
| Affirmations bloquantes non prouvées | CL-003. |
| Contradictions détectées | Aucune. |
| Hypothèses acceptées temporairement | CL-003. |
| Preuves à obtenir avant livraison | Essai de l'utilisateur après rechargement. |
