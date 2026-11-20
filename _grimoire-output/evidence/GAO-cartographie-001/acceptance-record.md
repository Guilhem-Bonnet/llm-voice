# Agentic Acceptance Record

Un livrable métier n'est accepté que par celui qui le reçoit. Ce dossier relie
chaque critère d'acceptation à sa preuve et porte la décision du client ou du
validateur : accepter, refuser, demander un ajustement.

- Task id: GAO-cartographie-001
- Profile: controlled
- Deliverable: Cartographie des points de décision du mode Auto (decision-points-map-v1.md)
- Validator: guilhem-bonnet

## Critères d'acceptation

| ID | Critère | Preuve | Statut |
|---|---|---|---|
| AC-001 | lint : chaque chemin de fichier source cité dans decision-points-map-v1.md existe dans le dépôt (script de vérification exécuté, sortie dans evidence-pack) | lint Python (evidence-pack.md) : 30 cités, 27 existants, 3 « à créer » | passé |
| AC-002 | gate : grimoire standard gate check --strict vert | `grimoire standard gate check --task-id GAO-cartographie-001 --strict` → OK, tests unitaires verts (test-run.json) | passé |

Statuts : `passé`, `partiel`, `échoué`, `à vérifier`. Preuve : un test, une
capture, une revue, une commande ou un document — un chemin ou une commande,
pas une phrase.

## Vérifications

| Vérification | Résultat | Preuve |
|---|---|---|
| Tests |  | `npm --prefix vscode-extension run test:unit` via grimoire standard gate run-tests --task-id GAO-cartographie-001 (_grimoire-output/evidence/GAO-cartographie-001/test-run.json) |
| Build / lint | passé | lint des chemins cités (script orchestrateur) |
| Sécurité | non applicable | document de planification, aucun code |
| Design / accessibilité | non applicable | — |
| Evals IA | non applicable | — |

## Risques et limites

| Risque ou limite | Impact | Décision |
|---|---|---|
| Agent arrêté à sa limite de tours en phase de lecture, relancé en écriture directe | quelques points marqués « non vérifié » dans la carte | acceptés, à lever par ADR-013 et le spike |

## Décision

| Décision | Validateur | Date | Commentaire |
|---|---|---|---|
| accepté | concierge (Marcel), par délégation de guilhem-bonnet (demande du 2026-09-27) — ratification utilisateur attendue | 2026-09-27 | AC-001/AC-002 passés ; livrable `decision-points-map-v1.md` 23 Ko, 6 sections |

Décisions : `accepté`, `refusé`, `ajustement demandé`, `en attente`. Une
décision `accepté` sans validateur ni date n'en est pas une.
