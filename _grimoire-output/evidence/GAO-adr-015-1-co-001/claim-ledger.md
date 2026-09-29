# Agentic Claim Ledger

- Task id: GAO-adr-015-1-co-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | 14 exemples valides et 40 invalides, tous rendus avec le verdict du manifeste par ajv ET Zod, qui s'accordent | résultat | `direction-v1.contract.test.ts` : 62/62 | prouvé | élevée | utiliser |
| CL-002 | Une partition neutre reproduit au champ près les `TtsRequest` et les `NarrationSegment` d'aujourd'hui (lecture fidèle et narrée, 3 liaisons) | résultat | `direction.test.ts` bloc « compatibility », `AudioQueue` réel + `FakeTtsProvider` | prouvé | élevée | utiliser |
| CL-003 | Toute sortie brute aléatoire (1 000 tirages, valeurs extrêmes) est ramenée dans les bornes de l'ADR §7 et valide pour Zod et pour le JSON Schema | résultat | `direction.test.ts` bloc « boundPartition », 5 graines x 200 (prouvé sur ces tirages, non exhaustif) | prouvé | élevée | utiliser |
| CL-004 | Les tests détectent une dérive de borne, une perte de champ de requête et un silence cumulé non borné | résultat | 3 mutations manuelles : 8, 2 et 6 échecs, fichier restauré | prouvé | élevée | utiliser |
| CL-005 | Aucune régression : 1036 -> 1127 tests verts, typecheck 0 erreur, lint propre | résultat | `npm run test:unit`, `typecheck`, `lint` ; revérifié par le coordinateur | prouvé | élevée | utiliser |
| CL-006 | Un fait `analyst`/`director` ou une attribution `casting` est invalide hors portée `document`, par le schéma seul | fait | exemples `bible.series-*`, `bible.user-*` rejetés par ajv et Zod | prouvé | élevée | utiliser |
| CL-007 | Étendre la règle d'écriture à `casting` et `analysis` est fidèle à l'intention de l'ADR §4 | hypothèse | interprétation ; l'ADR ne cite que « faits LLM » | hypothèse | moyenne | vérifier (relecture humaine) |
| CL-008 | Respect des bornes `minimum`/`maximum` par la grammaire `format` d'Ollama | fait (repris) | ADR-015 §3 : « non vérifié » | non vérifié | — | hors périmètre |

Types : `fait`, `hypothèse`, `résultat`, `décision`. Statuts : `prouvé`, `hypothèse`, `contredit`.

## Synthèse

| Question | Réponse |
|---|---|
| Affirmations bloquantes non prouvées | aucune pour la livraison du contrat |
| Contradictions détectées | aucune |
| À relire | CL-007 et les écarts 1 à 3 de l'evidence pack |
