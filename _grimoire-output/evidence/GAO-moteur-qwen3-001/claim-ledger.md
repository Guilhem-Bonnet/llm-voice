# Agentic Claim Ledger

Une affirmation sans preuve reste une hypothèse. Ce registre relie chaque
affirmation qui pèse sur une décision ou une livraison à ce qui la prouve.

- Task id: GAO-moteur-qwen3-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | Les 80 tests du serveur passent avec un faux moteur | résultat | `python3 -P deploy/qwen3/test_server.py`, hôte et image | prouvé | élevée | utiliser |
| CL-002 | Le serveur synthétise en voix figée et jouée hors ligne | résultat | _grimoire-output/evidence/GAO-moteur-qwen3-001/proof-real.json:226 | prouvé | élevée | utiliser |
| CL-003 | Les deux modèles tiennent ensemble à côté de Kyutai | résultat | _grimoire-output/evidence/GAO-moteur-qwen3-001/proof-real.json:55 | prouvé (marge 172 Mio) | moyenne | vérifier |
| CL-004 | Le mode jeu coupe une synthèse et libère les modèles | résultat | _grimoire-output/evidence/GAO-moteur-qwen3-001/proof-real.json:536 | prouvé (drapeau de test) | élevée | utiliser |
| CL-005 | Les phrases sont intelligibles | résultat | _grimoire-output/evidence/GAO-moteur-qwen3-001/wer.json:1 | prouvé (machine) | moyenne | vérifier par écoute |
| CL-006 | La voix figée provisoire convient | hypothèse | aucun choix de guilhem-bonnet | hypothèse | faible | vérifier |

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
