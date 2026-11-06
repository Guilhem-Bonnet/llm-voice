# Agentic Claim Ledger

Une affirmation sans preuve reste une hypothèse. Ce registre relie chaque
affirmation qui pèse sur une décision ou une livraison à ce qui la prouve.

- Task id: GAO-cartographie-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | Les 27 chemins de fichiers existants cités dans `decision-points-map-v1.md` existent dans le dépôt | fait | lint Python de l'orchestrateur (evidence-pack.md, section « Lint des chemins cités ») | prouvé | élevée | utiliser |
| CL-002 | Les 3 chemins introuvables (`src/core/decision.ts`, `src/decision/OllamaDecisionProvider.ts`, `src/decision/createDecisionProvider.ts`) sont des fichiers à créer, marqués « À créer » dans la carte (§2.1–2.3) | fait | `decision-points-map-v1.md` lignes 46-48 | prouvé | élevée | utiliser |
| CL-003 | L'API native Ollama `/api/generate` renvoie `logprobs`/`top_logprobs` (base de l'approche SemIf) | hypothèse | citée d'après decisions-log 2026-09-27 (preuve d'une autre session), non re-testée dans cette carte | hypothèse | moyenne | vérifier dans GAO-spike-valuat-001 |
| CL-004 | Le contrat de données proposé (§3) est compatible avec `NarrationRequest`/`NarrationResult` | décision | `vscode-extension/src/core/narration.ts` lu ; proposition non implémentée | hypothèse | moyenne | vérifier dans ADR-013 (GAO-adr-013-four-001) |

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
| Contradictions détectées | aucune |
| Hypothèses acceptées temporairement | CL-003, CL-004 (portées par le spike et l'ADR-013) |
| Preuves à obtenir avant livraison | aucune pour cette carte (cartographie, aucun code produit) |
