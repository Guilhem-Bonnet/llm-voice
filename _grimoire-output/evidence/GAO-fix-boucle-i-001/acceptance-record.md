# Agentic Acceptance Record

Un livrable métier n'est accepté que par celui qui le reçoit. Ce dossier relie
chaque critère d'acceptation à sa preuve et porte la décision du client ou du
validateur : accepter, refuser, demander un ajustement.

- Task id: GAO-fix-boucle-i-001
- Profile: controlled
- Deliverable: fix: boucle infinie de retéléchargement de Piper, aucun moyen de choisir une voix
- Validator: guilhem-bonnet

## Critères d'acceptation

| ID | Critère | Preuve | Statut |
|---|---|---|---|
| AC-001 | gate: grimoire standard gate check --strict vert | `grimoire standard gate check --task-id GAO-fix-boucle-i-001 --strict` (2026-11-05) | passé |
| AC-002 | test: npm --prefix vscode-extension run test:unit vert | 109 fichiers / 1887 tests verts, `_grimoire-output/evidence/GAO-fix-boucle-i-001/test-run.json` | passé |

Statuts : `passé`, `partiel`, `échoué`, `à vérifier`. Preuve : un test, une
capture, une revue, une commande ou un document — un chemin ou une commande,
pas une phrase.

## Vérifications

| Vérification | Résultat | Preuve |
|---|---|---|
| Tests | vert (109/109, 1887/1887) | `npm --prefix vscode-extension run test:unit` via grimoire standard gate run-tests --task-id GAO-fix-boucle-i-001 (_grimoire-output/evidence/GAO-fix-boucle-i-001/test-run.json) |
| Build / lint | vert | `npx tsc -p ./ --noEmit` → No errors ; `npx eslint ... --max-warnings=0` → No issues ; `npm run package:linux-x64` → exit 0, réinstallé, confirmé sur le build réel |
| Sécurité | non applicable | aucun changement de surface réseau au-delà d'un court-circuit qui évite un téléchargement inutile |
| Design / accessibilité |  |  |
| Evals IA |  |  |

## Risques et limites

| Risque ou limite | Impact | Décision |
|---|---|---|
| Aucune commande "Forcer la réinstallation" | un utilisateur avec une installation corrompue doit la supprimer manuellement pour la réparer | accepté, hors demande actuelle, carte séparée si besoin |
| Confirmation visuelle finale non automatisable depuis cette session (pas d'outil de clic Wayland) | la preuve "ça ne boucle plus en vrai" revient à l'utilisateur | accepté |

## Décision

| Décision | Validateur | Date | Commentaire |
|---|---|---|---|
| en attente |  |  |  |

Décisions : `accepté`, `refusé`, `ajustement demandé`, `en attente`. Une
décision `accepté` sans validateur ni date n'en est pas une.
