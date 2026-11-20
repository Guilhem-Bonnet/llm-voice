# Agentic Acceptance Record

Un livrable métier n'est accepté que par celui qui le reçoit. Ce dossier relie
chaque critère d'acceptation à sa preuve et porte la décision du client ou du
validateur : accepter, refuser, demander un ajustement.

- Task id: GAO-refonte-ux-0-002
- Profile: controlled
- Deliverable: Refonte UX 02 · ADR-017 Voix et mode de lecture : retrait du mot profil, migration, amendement d'ADR-011
- Validator: guilhem-bonnet

## Critères d'acceptation

| ID | Critère | Preuve | Statut |
|---|---|---|---|
| AC-001 | gate: ADR-017 versé dans docs/adr, relu par un vérificateur indépendant | _grimoire-output/reviews/GAO-refonte-ux-0-002/revue-adr-017.md et revue-adr-017-tour-2.md | passé |
| AC-002 | revue: accord de guilhem-bonnet consigné | _grimoire/_memory/decisions-log.md, « ADR-017 : choix validés » | passé |
| AC-003 | gate: grimoire standard gate check --strict vert |  | à vérifier |

Statuts : `passé`, `partiel`, `échoué`, `à vérifier`. Preuve : un test, une
capture, une revue, une commande ou un document — un chemin ou une commande,
pas une phrase.

## Vérifications

| Vérification | Résultat | Preuve |
|---|---|---|
| Tests |  | `npm --prefix vscode-extension run test:unit` via grimoire standard gate run-tests --task-id GAO-refonte-ux-0-002 (_grimoire-output/evidence/GAO-refonte-ux-0-002/test-run.json) |
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
