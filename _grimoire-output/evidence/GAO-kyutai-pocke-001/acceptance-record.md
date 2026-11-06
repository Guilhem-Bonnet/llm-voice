# Agentic Acceptance Record

Un livrable métier n'est accepté que par celui qui le reçoit. Ce dossier relie
chaque critère d'acceptation à sa preuve et porte la décision du client ou du
validateur : accepter, refuser, demander un ajustement.

- Task id: GAO-kyutai-pocke-001
- Profile: controlled
- Deliverable: kyutai-pocket : provider TtsProvider vers pocket-tts serve (voie intermédiaire HTTP, réglage avancé)
- Validator: guilhem-bonnet

## Critères d'acceptation

| ID | Critère | Preuve | Statut |
|---|---|---|---|
| AC-001 | gate: grimoire standard gate check --strict vert | `grimoire standard gate check --task-id GAO-kyutai-pocke-001 --strict` → OK (2026-11-05) | passé |
| AC-002 | test: npm --prefix vscode-extension run test:unit vert, provider testé contre un fake bâti sur une réponse réelle capturée | 108 fichiers / 1865 tests verts, `KyutaiPocketProvider.test.ts` (20 tests) contre un fake `node:http` reproduisant le contrat exact de `pocket_tts/main.py` (lecture directe du code source, cf. task-envelope.md) | passé |

Statuts : `passé`, `partiel`, `échoué`, `à vérifier`. Preuve : un test, une
capture, une revue, une commande ou un document — un chemin ou une commande,
pas une phrase.

## Vérifications

| Vérification | Résultat | Preuve |
|---|---|---|
| Tests |  | `npm --prefix vscode-extension run test:unit` via grimoire standard gate run-tests --task-id GAO-kyutai-pocke-001 (_grimoire-output/evidence/GAO-kyutai-pocke-001/test-run.json) |
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
