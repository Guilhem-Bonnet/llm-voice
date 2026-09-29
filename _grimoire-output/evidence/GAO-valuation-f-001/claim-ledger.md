# Agentic Claim Ledger

- Task id: GAO-valuation-f-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | Le banc appelle le vrai `OllamaNarrator.transform` compilé avec les styles réels des 3 profils narrés | résultat | `run-narrator-eval.mjs` (require de `out/src/...`) | prouvé | élevée | utiliser |
| CL-002 | Fidélité essentielle baseline : teacher 86,8 % (7b) / 83,8 % (3b) ; summary 96,3 % / 85,9 % ; review 97,1 % / 91,9 % | résultat | `baseline.json`, `baseline-table.md` | prouvé (1 passage, contrôles lexicaux) | moyenne | utiliser avec réserve |
| CL-003 | Les négations sont la perte la plus fréquente (55 à 89 %) | résultat | `baseline-table.md` | prouvé (approximation lexicale) | moyenne | utiliser avec réserve |
| CL-004 | Aucune sortie JSON invalide sur 144 appels | résultat | champ `degraded` = 0 sur 144 | prouvé | élevée | utiliser |
| CL-005 | Latences p50/p95 fiables | résultat | perturbées par le mode jeu gpu-yield | non prouvé | faible | ne pas utiliser |
| CL-006 | Le prompt `styles-v2.json` améliore la fidélité | hypothèse | 2e tentative invalide : gpu-yield réapparu en cours de run (71/72 appels dégradés) | non prouvé | faible | mesurer plus tard |
