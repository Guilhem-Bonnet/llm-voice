# Agentic Claim Ledger

- Task id: GAO-adr-015-4-co-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | `src/direction/controller/` n'importe ni `vscode` ni module réseau ; aucun I/O | fait | imports de `fidelity.ts`, `PartitionController.ts` (zod via `core/direction.js`, types) ; ESLint et `tsc` verts | prouvé | élevée | utiliser |
| CL-002 | Le contrôleur valide le schéma, borne, vérifie couverture, fidélité, locuteurs, et renvoie les segments fautifs avec un motif | fait | `partitionController.test.ts` (98 tests) | prouvé | élevée | utiliser |
| CL-003 | Au-delà de N renvois (défaut 2) la fenêtre retombe sur la partition neutre, sans blocage ni exception | fait | tests « test 10 » et propriété « flaky director » (10 graines) | prouvé | élevée | utiliser |
| CL-004 | Les 24 textes piégés lus tels quels ou en forme orale sont acceptés ; nombres, négations, identifiants supprimés sont détectés | fait | `fidelity.test.ts`, `partitionController.test.ts` | prouvé | élevée | utiliser |
| CL-005 | Les tests détectent une régression : 5 mutants de la production tués | mesure | mutations manuelles (voir evidence-pack) | prouvé | moyenne | utiliser |
| CL-006 | `npm run test:unit` 1 662 verts, `typecheck` et `lint` sans erreur | résultat | dernière exécution de la session | prouvé | élevée | utiliser |
| CL-007 | Le taux de faux positifs de la fidélité sur de vraies sorties du metteur en scène est faible | hypothèse | aucune mesure (textes synthétiques seulement) | non vérifié | faible | mesurer à l'étape 5/6 |
| CL-008 | Marge de longueur +40 caractères et ratio 2 conviennent | hypothèse | valeurs non mesurées (ADR §7 « non mesuré ») | non vérifié | faible | étalonner à l'étape 6 |
| CL-009 | `src/core/direction.ts` n'a pas été modifié | fait | aucun Edit/Write sur ce fichier | prouvé | élevée | utiliser |
