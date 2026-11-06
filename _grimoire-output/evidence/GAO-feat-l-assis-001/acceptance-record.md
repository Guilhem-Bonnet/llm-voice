# Agentic Acceptance Record

Un livrable métier n'est accepté que par celui qui le reçoit. Ce dossier relie
chaque critère d'acceptation à sa preuve et porte la décision du client ou du
validateur : accepter, refuser, demander un ajustement.

- Task id: GAO-feat-l-assis-001
- Profile: controlled
- Deliverable: feat: l'assistant Choisir une voix ouvre enfin un vrai sélecteur de voix
- Validator: guilhem-bonnet

## Critères d'acceptation

| ID | Critère | Preuve | Statut |
|---|---|---|---|
| AC-001 | gate: grimoire standard gate check --strict vert | `grimoire standard gate check --task-id GAO-feat-l-assis-001 --strict` (2026-11-05) | passé |
| AC-002 | test: npm --prefix vscode-extension run test:unit vert | 109 fichiers / 1890 tests verts, `_grimoire-output/evidence/GAO-feat-l-assis-001/test-run.json` | passé |

Statuts : `passé`, `partiel`, `échoué`, `à vérifier`. Preuve : un test, une
capture, une revue, une commande ou un document — un chemin ou une commande,
pas une phrase.

## Vérifications

| Vérification | Résultat | Preuve |
|---|---|---|
| Tests | vert (109/109, 1890/1890) | `npm --prefix vscode-extension run test:unit` via grimoire standard gate run-tests --task-id GAO-feat-l-assis-001 (_grimoire-output/evidence/GAO-feat-l-assis-001/test-run.json) |
| Build / lint | vert | `npx tsc -p ./ --noEmit` → No errors ; `npx eslint ... --max-warnings=0` → No issues ; `npm run package:linux-x64` → exit 0, réinstallé, confirmé sur le build réel |
| Sécurité | non applicable | réutilise une commande/mécanique déjà existante et déjà exposée (`llmVoice.browseVoices`) |
| Design / accessibilité | amélioré | l'assistant mène enfin à un vrai sélecteur de voix au lieu de s'arrêter à un palier |
| Evals IA |  |  |

## Risques et limites

| Risque ou limite | Impact | Décision |
|---|---|---|
| Le palier Piper n'a qu'une seule voix disponible | le sélecteur s'ouvre avec une seule entrée pour ce palier | accepté, reflète la réalité honnêtement, pas un bug de cette carte |
| Le palier Chatterbox n'ouvre pas le sélecteur immédiatement | l'utilisateur doit lancer Docker puis utiliser "Parcourir les voix" séparément | accepté, son serveur peut ne pas être prêt au moment du choix |

## Décision

| Décision | Validateur | Date | Commentaire |
|---|---|---|---|
| en attente |  |  |  |

Décisions : `accepté`, `refusé`, `ajustement demandé`, `en attente`. Une
décision `accepté` sans validateur ni date n'en est pas une.
