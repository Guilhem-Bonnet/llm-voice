# Agentic Acceptance Record

Un livrable métier n'est accepté que par celui qui le reçoit. Ce dossier relie
chaque critère d'acceptation à sa preuve et porte la décision du client ou du
validateur : accepter, refuser, demander un ajustement.

- Task id: GAO-fix-test-de-001
- Profile: controlled
- Deliverable: fix: test de la voix Estelle et bouton pause inopérants avec le moteur audio natif
- Validator: guilhem-bonnet

## Critères d'acceptation

| ID | Critère | Preuve | Statut |
|---|---|---|---|
| AC-001 | gate: grimoire standard gate check --strict vert | `grimoire standard gate check --task-id GAO-fix-test-de-001 --strict` | passé |
| AC-002 | test: npm --prefix vscode-extension run test:unit vert | `_grimoire-output/evidence/GAO-fix-test-de-001/test-run.json` | passé |

Statuts : `passé`, `partiel`, `échoué`, `à vérifier`. Preuve : un test, une
capture, une revue, une commande ou un document — un chemin ou une commande,
pas une phrase.

## Vérifications

| Vérification | Résultat | Preuve |
|---|---|---|
| Tests |  | `npm --prefix vscode-extension run test:unit` via grimoire standard gate run-tests --task-id GAO-fix-test-de-001 (_grimoire-output/evidence/GAO-fix-test-de-001/test-run.json) |
| Build / lint | vert | `npx tsc -p ./ --noEmit`, `npx eslint`, `npm run package:linux-x64` |
| Sécurité |  |  |
| Design / accessibilité |  |  |
| Evals IA |  |  |

## Risques et limites

| Risque ou limite | Impact | Décision |
|---|---|---|
| Clic réel non exercé | confirmation finale par l'utilisateur | accepté, déclaré |
| `vad_filter` change le banc pour tous les scénarios | seul Piper recontrôlé | accepté, déclaré |
| Kokoro sans adresse retombe sur le port 8004 | même panne possible | hors périmètre, signalé |

## Décision

| Décision | Validateur | Date | Commentaire |
|---|---|---|---|
| en attente |  |  |  |

Décisions : `accepté`, `refusé`, `ajustement demandé`, `en attente`. Une
décision `accepté` sans validateur ni date n'en est pas une.
