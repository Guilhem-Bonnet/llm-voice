# Agentic Acceptance Record

Un livrable métier n'est accepté que par celui qui le reçoit. Ce dossier relie
chaque critère d'acceptation à sa preuve et porte la décision du client ou du
validateur : accepter, refuser, demander un ajustement.

- Task id: GAO-moteur-qwen3-001
- Profile: controlled
- Deliverable: Moteur Qwen3 : serveur local hors ligne, voix figée et voix jouée
- Validator: guilhem-bonnet

## Critères d'acceptation

| ID | Critère | Preuve | Statut |
|---|---|---|---|
| AC-001 | test: serveur Qwen3 local répond avec --network none et gpu-yield respecté, preuve réelle en audio |  | à vérifier |
| AC-002 | gate: grimoire standard gate check --strict vert |  | à vérifier |

Statuts : `passé`, `partiel`, `échoué`, `à vérifier`. Preuve : un test, une
capture, une revue, une commande ou un document — un chemin ou une commande,
pas une phrase.

## Vérifications

| Vérification | Résultat | Preuve |
|---|---|---|
| Tests |  | `npm --prefix vscode-extension run test:unit` via grimoire standard gate run-tests --task-id GAO-moteur-qwen3-001 (_grimoire-output/evidence/GAO-moteur-qwen3-001/test-run.json) |
| Build / lint |  |  |
| Sécurité |  |  |
| Design / accessibilité |  |  |
| Evals IA |  |  |

## Risques et limites

| Risque ou limite | Impact | Décision |
|---|---|---|
|  |  |  |

## Décision

| Décision | Validateur | Date | Commentaire |
|---|---|---|---|
| en attente |  |  |  |

Décisions : `accepté`, `refusé`, `ajustement demandé`, `en attente`. Une
décision `accepté` sans validateur ni date n'en est pas une.
