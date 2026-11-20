# Agentic Claim Ledger

- Task id: GAO-adr-015-3-bi-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | Aucune séquence d'événements de modèle ne modifie une portée `series` ou `user` (réducteur et store, aucun fichier écrit) | résultat | `bible.properties.test.ts`, 5 graines ; mutation 1 : 19 échecs ; prouvé sur ces tirages, non exhaustif | prouvé | élevée | utiliser |
| CL-002 | Un fait `user` ou `locked` n'est jamais remplacé par un fait de modèle | résultat | `bible.properties.test.ts` (5 x 400) ; mutation 2 : 2 échecs | prouvé | élevée | utiliser |
| CL-003 | Ajout seul : seul `userRetract` retire un fait ; la projection reste une bible valide | résultat | `bible.properties.test.ts` (5 x 400) | prouvé | élevée | utiliser |
| CL-004 | Rejouer le journal donne toujours le même état (direct, texte, checkpoint, second store, après compactage) | résultat | `bible.properties.test.ts` ; mutation 5 : 8 échecs | prouvé | élevée | utiliser |
| CL-005 | Fichiers 0600 et répertoires 0700 ; document nommé par hash sans fuite de la clé | résultat | `BibleStore.test.ts` (Linux seulement, Windows non vérifié) ; mutation 3 : 1 échec | prouvé | élevée | utiliser |
| CL-006 | Fichiers corrompus, ligne tronquée, lien symbolique, répertoire, fichier trop gros, checkpoint hostile : aucune exception, rien d'écrasé, lecture du reste | résultat | `BibleStore.test.ts` bloc « corrupt and hostile files » | prouvé | élevée | utiliser |
| CL-007 | Le compactage retire du fichier les valeurs retirées, conserve état, révision et tombstones | résultat | `BibleStore.test.ts` bloc « compaction and oblivion » | prouvé | élevée | utiliser |
| CL-008 | Un document `persist: false` n'écrit rien et n'est pas relu | résultat | `BibleStore.test.ts` (arborescence vide) | prouvé | élevée | utiliser |
| CL-009 | La règle « modèle seulement dans le document » est appliquée aussi au rejeu d'un fichier trafiqué | résultat | `BibleStore.test.ts`, `reducer.test.ts` | prouvé | élevée | utiliser |
| CL-010 | Étendre la règle d'écriture à `casting` et `analysis` (héritée de la carte 1, CL-007) est fidèle à l'ADR | hypothèse | interprétation ; l'ADR ne cite que « faits LLM » | hypothèse | moyenne | vérifier (relecture humaine) |
| CL-011 | Le store empêche le code des rôles LLM d'utiliser la porte utilisateur | hypothèse | non : c'est un contrat d'appelant, le store ne peut pas authentifier | contredit (non garanti) | — | traiter à l'étape d'intégration |
| CL-012 | Deux fenêtres VS Code concurrentes sur le même journal sont sans perte | hypothèse | simulé avec deux instances seulement | non vérifié | faible | vérifier |

Types : `fait`, `hypothèse`, `résultat`, `décision`. Statuts : `prouvé`, `hypothèse`, `contredit`.

## Synthèse

Prouvés : CL-001 à CL-009 (propriétés prouvées sur des tirages à graine, non exhaustives). À relire : CL-010, CL-011, CL-012 et les écarts 1 à 3 de l'evidence pack.
