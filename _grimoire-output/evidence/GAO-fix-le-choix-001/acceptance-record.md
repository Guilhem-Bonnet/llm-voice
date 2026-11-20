# Agentic Acceptance Record

Un livrable métier n'est accepté que par celui qui le reçoit. Ce dossier relie
chaque critère d'acceptation à sa preuve et porte la décision du client ou du
validateur : accepter, refuser, demander un ajustement.

- Task id: GAO-fix-le-choix-001
- Profile: controlled
- Deliverable: fix: le choix de voix ne déclenche aucun rafraîchissement visuel immédiat (panneau lecture, barre de statut)
- Validator: guilhem-bonnet

## Critères d'acceptation

| ID | Critère | Preuve | Statut |
|---|---|---|---|
| AC-001 | gate: grimoire standard gate check --strict vert | `grimoire standard gate check --task-id GAO-fix-le-choix-001 --strict` (2026-11-05) | passé |
| AC-002 | test: npm --prefix vscode-extension run test:unit vert | 109 fichiers / 1881 tests verts, `_grimoire-output/evidence/GAO-fix-le-choix-001/test-run.json` | passé |

Statuts : `passé`, `partiel`, `échoué`, `à vérifier`. Preuve : un test, une
capture, une revue, une commande ou un document — un chemin ou une commande,
pas une phrase.

## Vérifications

| Vérification | Résultat | Preuve |
|---|---|---|
| Tests | vert (109/109, 1881/1881) | `npm --prefix vscode-extension run test:unit` via grimoire standard gate run-tests --task-id GAO-fix-le-choix-001 (_grimoire-output/evidence/GAO-fix-le-choix-001/test-run.json) |
| Build / lint | vert | `npx tsc -p ./ --noEmit` → No errors ; `npx eslint src/pipeline/Pipeline.ts --max-warnings=0` → No issues ; `npm run package:linux-x64` → exit 0, réinstallé, confirmé sur le build réel |
| Sécurité | non applicable | aucun changement de surface réseau, aucune donnée sensible |
| Design / accessibilité |  |  |
| Evals IA |  |  |

## Risques et limites

| Risque ou limite | Impact | Décision |
|---|---|---|
| Aucun test unitaire dédié à `applyVoiceTierChoice`/`browseVoices` (dépendance forte à `vscode`, hors `npm run test:unit`) | correctif prouvé par lecture de code + non-régression, pas par un test ciblant ce comportement précis | accepté, limite préexistante du fichier, pas introduite par ce correctif |
| Aucun outil de clic automatisé Wayland sur ce poste | confirmation visuelle finale impossible depuis cette session | accepté, revient à l'utilisateur |

## Décision

| Décision | Validateur | Date | Commentaire |
|---|---|---|---|
| en attente |  |  |  |

Décisions : `accepté`, `refusé`, `ajustement demandé`, `en attente`. Une
décision `accepté` sans validateur ni date n'en est pas une.
