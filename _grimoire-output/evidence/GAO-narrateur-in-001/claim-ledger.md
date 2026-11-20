# Agentic Claim Ledger

Une affirmation sans preuve reste une hypothèse. Ce registre relie chaque
affirmation qui pèse sur une décision ou une livraison à ce qui la prouve.

- Task id: GAO-narrateur-in-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | `qwen2.5:7b` est installé sur la machine dev (4,7 Go) | fait | `ollama list` (evidence-pack.md, sortie brute) ; recontrôlé par l'orchestrateur le 2026-09-27 | prouvé | élevée | utiliser |
| CL-002 | `POST /api/chat` avec `format` = schéma `narration-segments` renvoie HTTP 200 et un JSON conforme (segments/sourceIds/spokenText) | test | `payload.json`, `response.json`, `headers.txt` ; validation JSON par script (evidence-pack.md) | prouvé | élevée | utiliser |
| CL-003 | Latence de la requête structurée : 11,47 s dont ≈ 4,96 s de chargement à froid | résultat | `curl -w time_total` + champ `load_duration` (evidence-pack.md) | prouvé | moyenne | utiliser — une seule mesure, à chaud non mesuré |
| CL-004 | Le narrateur de l'extension (`OllamaNarrator.ts`) ne tourne plus en mode dégradé `provider-unavailable` sur cette machine | hypothèse | déduit de CL-001/CL-002 ; non vérifié depuis l'extension elle-même | hypothèse | moyenne | vérifier lors du prochain E2E réel |

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
| Hypothèses acceptées temporairement | CL-004 (santé vue depuis l'extension) |
| Preuves à obtenir avant livraison | latence à chaud (2e requête) lors du prochain E2E |
