# Agentic Claim Ledger

Une affirmation sans preuve reste une hypothèse. Ce registre relie chaque
affirmation qui pèse sur une décision ou une livraison à ce qui la prouve.

- Task id: GAO-qwen3-plusie-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | Les tests du serveur passent (96) | résultat | `python3 -P deploy/qwen3/test_server.py` → OK, relancé par l'orchestrateur le 2026-11-07 | prouvé | élevée | utiliser |
| CL-002 | Le service réel liste 9 voix dont les 8 créées | fait | `curl http://127.0.0.1:8021/voices` relu par l'orchestrateur : 9 noms | prouvé | élevée | utiliser |
| CL-003 | Les voix créées survivent au redémarrage | résultat | `_grimoire-output/evidence/GAO-qwen3-plusie-001/voices-after-restart.json` après `up --force-recreate` (agent) | prouvé (par l'agent) | moyenne | utiliser |
| CL-004 | Trois lectures réelles transcrites sans erreur | résultat | `_grimoire-output/evidence/GAO-qwen3-plusie-001/transcription-wer.json` : WER 0,0 ×3 | prouvé (par l'agent) | moyenne | utiliser |
| CL-005 | Les 8 voix sonnent différemment | hypothèse | `_grimoire-output/evidence/GAO-qwen3-plusie-001/speaker-similarities.json` 0,915-0,990 ; encodeur peu discriminant, aucune écoute | hypothèse | faible | vérifier |

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
| Affirmations bloquantes non prouvées |  |
| Contradictions détectées |  |
| Hypothèses acceptées temporairement |  |
| Preuves à obtenir avant livraison |  |
