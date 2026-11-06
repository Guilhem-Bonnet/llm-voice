# Agentic Acceptance Record

Un livrable métier n'est accepté que par celui qui le reçoit. Ce dossier relie
chaque critère d'acceptation à sa preuve et porte la décision du client ou du
validateur : accepter, refuser, demander un ajustement.

- Task id: GAO-fix-l-url-du-001
- Profile: controlled
- Deliverable: fix: l'URL du serveur TTS ne suit pas le changement de provider dans l'éditeur de profil
- Validator: guilhem-bonnet

## Critères d'acceptation

| ID | Critère | Preuve | Statut |
|---|---|---|---|
| AC-001 | gate: grimoire standard gate check --strict vert | `grimoire standard gate check --task-id GAO-fix-l-url-du-001 --strict` (2026-11-05) | passé |
| AC-002 | test: npm --prefix vscode-extension run test:unit vert | 110 fichiers / 1894 tests verts, `_grimoire-output/evidence/GAO-fix-l-url-du-001/test-run.json` | passé |

Statuts : `passé`, `partiel`, `échoué`, `à vérifier`. Preuve : un test, une
capture, une revue, une commande ou un document — un chemin ou une commande,
pas une phrase.

## Vérifications

| Vérification | Résultat | Preuve |
|---|---|---|
| Tests | vert (110/110, 1894/1894) | `npm --prefix vscode-extension run test:unit` via grimoire standard gate run-tests --task-id GAO-fix-l-url-du-001 (_grimoire-output/evidence/GAO-fix-l-url-du-001/test-run.json) |
| Build / lint | vert | `npx eslint ... --max-warnings=0` → No issues ; `npm run package:linux-x64` → exit 0, réinstallé dans le profil réellement utilisé par le workspace, confirmé |
| Sécurité | non applicable | changement purement local au formulaire, aucun appel réseau nouveau |
| Design / accessibilité | amélioré | le champ se corrige tout seul dans le cas courant, sans jamais écraser une saisie manuelle |
| Evals IA |  |  |

## Risques et limites

| Risque ou limite | Impact | Décision |
|---|---|---|
| `KNOWN_DEFAULT_BASE_URLS` dupliqué à la main depuis `presets.ts` | peut diverger si un preset change son URL par défaut | accepté, documenté dans le code, risque faible (ces URLs changent rarement) |
| N'aide pas si l'utilisateur ne sauvegarde jamais, ou édite le JSON à la main | cas limite non couvert | accepté, hors scope de ce correctif ciblé |

## Décision

| Décision | Validateur | Date | Commentaire |
|---|---|---|---|
| en attente |  |  |  |

Décisions : `accepté`, `refusé`, `ajustement demandé`, `en attente`. Une
décision `accepté` sans validateur ni date n'en est pas une.
