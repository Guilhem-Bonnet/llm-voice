# Agentic Acceptance Record

Un livrable métier n'est accepté que par celui qui le reçoit. Ce dossier relie
chaque critère d'acceptation à sa preuve et porte la décision du client ou du
validateur : accepter, refuser, demander un ajustement.

- Task id: GAO-refonte-ux-0-005
- Profile: controlled
- Deliverable: Refonte UX 05 · Galerie de voix en onglet : cartes, écoute, préparation, recherche, favorites, phrase d'essai
- Validator: guilhem-bonnet

## Critères d'acceptation

| ID | Critère | Preuve | Statut |
|---|---|---|---|
| AC-001 | test: l'écoute ne se lance jamais sans clic |  | à vérifier |
| AC-002 | test: aucun bouton ne passe à la ligne ni ne s'étire à 260, 320 et 500 px |  | à vérifier |
| AC-003 | revue: écoute et validation par guilhem-bonnet |  | à vérifier |
| AC-004 | test: npm --prefix vscode-extension run test:unit vert |  | à vérifier |
| AC-005 | gate: grimoire standard gate check --strict vert |  | à vérifier |

Statuts : `passé`, `partiel`, `échoué`, `à vérifier`. Preuve : un test, une
capture, une revue, une commande ou un document — un chemin ou une commande,
pas une phrase.

## Vérifications

| Vérification | Résultat | Preuve |
|---|---|---|
| Tests |  | `npm --prefix vscode-extension run test:unit` via grimoire standard gate run-tests --task-id GAO-refonte-ux-0-005 (_grimoire-output/evidence/GAO-refonte-ux-0-005/test-run.json) |
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
