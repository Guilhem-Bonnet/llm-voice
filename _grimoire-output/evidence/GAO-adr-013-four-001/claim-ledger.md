# Agentic Claim Ledger

Une affirmation sans preuve reste une hypothèse. Ce registre relie chaque
affirmation qui pèse sur une décision ou une livraison à ce qui la prouve.

- Task id: GAO-adr-013-four-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | L'ADR-013 reflète fidèlement la décision du journal du 2026-09-27 (SemIf sur `/api/generate`, Laya en réserve, Jev cloud jamais par défaut, repli bySource, 0.4 après ADR-012) | fait | `review-sentinel.md` grille point 2 : OK | prouvé | élevée | utiliser |
| CL-002 | Les cinq invariants P0 sont respectés, dont zéro autoplay et passage par EgressGuard | fait | `review-sentinel.md` point 3 : OK | prouvé | élevée | utiliser |
| CL-003 | `RESERVED_PROFILE_IDS` et `schemaVersion 3` n'existent pas encore dans `profile.schema.ts` | fait | lecture directe du relecteur (`profile.schema.ts:124,176`) ; ADR corrigé en « à créer » | prouvé | élevée | utiliser |
| CL-004 | Un modèle 1,5–7 B rend des distributions dégénérées à température 0 | hypothèse | une seule preuve (`qwen2.5:3b`), ADR reformulé en conséquence | hypothèse | moyenne | vérifier dans le spike |

Types : `fait`, `hypothèse`, `résultat`, `décision`. Statuts : `prouvé`,
`hypothèse`, `contredit`. Confiance : `faible`, `moyenne`, `élevée`. Décision :
`utiliser`, `vérifier`, `rejeter`.

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
| Affirmations bloquantes non prouvées | aucune |
| Contradictions détectées | aucune (deux temps verbaux corrigés) |
| Hypothèses acceptées temporairement | CL-004 |
| Preuves à obtenir avant livraison | spike GAO-spike-valuat-001 gagnant contre les règles, condition d'entrée de l'implémentation |
