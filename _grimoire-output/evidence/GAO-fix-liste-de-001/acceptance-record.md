# Agentic Acceptance Record

Un livrable métier n'est accepté que par celui qui le reçoit. Ce dossier relie
chaque critère d'acceptation à sa preuve et porte la décision du client ou du
validateur : accepter, refuser, demander un ajustement.

- Task id: GAO-fix-liste-de-001
- Profile: controlled
- Deliverable: fix: liste des profils illisible pour un utilisateur réel (jargon technique visible, description utile cachée en tooltip)
- Validator: guilhem-bonnet

## Critères d'acceptation

| ID | Critère | Preuve | Statut |
|---|---|---|---|
| AC-001 | gate: grimoire standard gate check --strict vert | `grimoire standard gate check --task-id GAO-fix-liste-de-001 --strict` (2026-11-05) | passé |
| AC-002 | test: npm --prefix vscode-extension run test:unit vert | 108 fichiers / 1872 tests verts, `_grimoire-output/evidence/GAO-fix-liste-de-001/test-run.json` | passé |

Statuts : `passé`, `partiel`, `échoué`, `à vérifier`. Preuve : un test, une
capture, une revue, une commande ou un document — un chemin ou une commande,
pas une phrase.

## Vérifications

| Vérification | Résultat | Preuve |
|---|---|---|
| Tests | vert (108/108, 1872/1872) | `npm --prefix vscode-extension run test:unit` via grimoire standard gate run-tests --task-id GAO-fix-liste-de-001 (_grimoire-output/evidence/GAO-fix-liste-de-001/test-run.json) |
| Build / lint | vert | `npx tsc -p ./ --noEmit` → No errors ; `npx eslint ... --max-warnings=0` → No issues ; `npm run package:linux-x64` → exit 0, réinstallé, confirmé sur le build réel |
| Sécurité | non applicable | changement de rendu texte uniquement, aucun appel réseau ni donnée sensible |
| Design / accessibilité | amélioré | texte en clair remplace un jargon technique illisible ; infobulle conserve l'information technique pour qui la veut |
| Evals IA |  |  |

## Risques et limites

| Risque ou limite | Impact | Décision |
|---|---|---|
| `profileQuickPick.ts` (sélecteur rapide de profil) garde le format technique | incohérence entre les deux surfaces (panneau vs palette de commandes) | accepté pour l'instant, amélioration séparée possible |
| Aucun profil Kyutai par défaut ajouté | la découvrabilité de Kyutai dépend toujours de l'éditeur de profil (GAO-fix-provider-001) | décision de migration volontairement non tranchée ici |

## Décision

| Décision | Validateur | Date | Commentaire |
|---|---|---|---|
| en attente |  |  |  |

Décisions : `accepté`, `refusé`, `ajustement demandé`, `en attente`. Une
décision `accepté` sans validateur ni date n'en est pas une.
