# Agentic Acceptance Record

Un livrable métier n'est accepté que par celui qui le reçoit. Ce dossier relie
chaque critère d'acceptation à sa preuve et porte la décision du client ou du
validateur : accepter, refuser, demander un ajustement.

- Task id: GAO-essais-voix-001
- Profile: controlled
- Deliverable: Essais voix : textes d'essai et banc d'écoute pour le ton, les personnages et les mots techniques
- Validator: guilhem-bonnet

## Critères d'acceptation

| ID | Critère | Preuve | Statut |
|---|---|---|---|
| AC-001 | test: python3 -m unittest discover scripts/voice-lab vert |  | à vérifier |
| AC-002 | test: scripts/voice-lab/run.sh code de sortie 0 sur le serveur Pocket local, mesures dans evidence-pack |  | à vérifier |
| AC-003 | revue: notes d'écoute de guilhem-bonnet consignées dans acceptance-record |  | à vérifier |
| AC-004 | gate: grimoire standard gate check --strict vert |  | à vérifier |

Statuts : `passé`, `partiel`, `échoué`, `à vérifier`. Preuve : un test, une
capture, une revue, une commande ou un document — un chemin ou une commande,
pas une phrase.

## Vérifications

| Vérification | Résultat | Preuve |
|---|---|---|
| Tests |  | `npm --prefix vscode-extension run test:unit` via grimoire standard gate run-tests --task-id GAO-essais-voix-001 (_grimoire-output/evidence/GAO-essais-voix-001/test-run.json) |
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
