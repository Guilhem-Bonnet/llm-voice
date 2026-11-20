# Agentic Claim Ledger

Une affirmation sans preuve reste une hypothèse. Ce registre relie chaque
affirmation qui pèse sur une décision ou une livraison à ce qui la prouve.

- Task id: GAO-valuation-m-001
- Profile: controlled

> **Toutes les précisions ci-dessous mesurent l'accord avec des étiquettes PROPOSÉES par Claude, non
> validées par l'utilisateur.**

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | Le jeu `auto-eval-v1.jsonl` compte 51 cas, 16 catégories, 4 profils réels, tous `labelSource: "claude-proposed"` | fait | en-tête de `run-all-output.txt` ; ids vérifiés contre `src/profiles/defaults.ts` et `core/profile.schema.ts` | prouvé | élevée | utiliser |
| CL-002 | Les étiquettes reflètent le goût de l'utilisateur | hypothèse | aucune relecture utilisateur à ce jour | hypothèse | faible | vérifier — `LABELS-TO-REVIEW.md` puis `apply-labels.mjs` |
| CL-003 | `run-all.mjs` produit le tableau final (approche, précision, pire catégorie, p50, p95) et la gagnante en une commande | test | commande de l'evidence-pack, exit 0, `run-all-output.txt` | prouvé | élevée | utiliser |
| CL-004 | Meilleure variante à p95 < 1 s : hybride règles + k-NN qwen2.5:1.5b, 75 % (38/51), p95 125 ms ; ex æquo SemIf qwen2.5:7b prompt enrichi lettres, 75 %, p95 378 ms | résultat | `run-all-output.txt`, `run-all-results.json` | prouvé | moyenne | utiliser comme classement provisoire |
| CL-005 | Les gagnantes battent le témoin à règles v2 (33 %) de +41/+42 points | résultat | McNemar exact : 22 contre 1 et 24 contre 3, p < 0,0001 | prouvé | moyenne | utiliser — sous réserve de CL-002 |
| CL-006 | Le k-NN à k = 1 généralise hors de la catégorie du cas | hypothèse | variante `knn-*-group` codée, logique testée sur CPU, **non mesurée** (mode jeu, gpu-yield) | hypothèse | faible | vérifier — relancer run-all |
| CL-007 | Aucun réglage n'a été fait sur les cas de test sans validation croisée | fait | seuils/prompts/exemples figés a priori dans le code ; k par LOO imbriqué ; calibration sur « N/A » sans étiquette | prouvé | moyenne | utiliser — biais de sélection entre ~34 variantes déclaré |
| CL-008 | Les latences marquées * (k-NN nomic, 3b noms/calibration) reflètent la machine au repos | hypothèse | valeurs aberrantes, premier passage partiel à 35 ms / 254 ms | contredit | faible | rejeter ces latences, remesurer hors partie |
| CL-009 | gpt-oss:20b est un plafond de qualité | hypothèse | 67 % < 75 %, 33 s médians, modèle partiellement sur CPU | contredit | moyenne | rejeter pour ce jeu |

Types : `fait`, `hypothèse`, `résultat`, `décision`. Statuts : `prouvé`,
`hypothèse`, `contredit`. Confiance : `faible`, `moyenne`, `élevée`. Décision :
`utiliser`, `vérifier`, `rejeter`.

## Synthèse

| Question | Réponse |
|---|---|
| Affirmations bloquantes non prouvées | CL-002 (étiquettes utilisateur) — critère de la carte |
| Contradictions détectées | CL-008 (latences sous contention GPU), CL-009 (gpt-oss n'est pas un plafond ici) |
| Hypothèses acceptées temporairement | classement CL-004 en attendant la relecture |
| Preuves à obtenir avant clôture | relecture des 51 étiquettes (`acceptance-record.md`), relance hors mode jeu avec `knn-*-group` |
