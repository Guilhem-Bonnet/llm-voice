# Agentic Acceptance Record

Un livrable métier n'est accepté que par celui qui le reçoit. Ce dossier relie
chaque critère d'acceptation à sa preuve et porte la décision du client ou du
validateur : accepter, refuser, demander un ajustement.

- Task id: GAO-impl-mente-l-001
- Profile: controlled
- Deliverable: implémente les correctifs P1 de l'audit UX : retour visible du choix de voix + éditeur de profil sans jargon
- Validator: guilhem-bonnet

## Critères d'acceptation

| ID | Critère | Preuve | Statut |
|---|---|---|---|
| AC-001 | gate: grimoire standard gate check --strict vert | `grimoire standard gate check --task-id GAO-impl-mente-l-001 --strict` (2026-11-05) | passé |
| AC-002 | test: npm --prefix vscode-extension run test:unit vert | 109 fichiers / 1880 tests verts, `_grimoire-output/evidence/GAO-impl-mente-l-001/test-run.json` | passé |

Statuts : `passé`, `partiel`, `échoué`, `à vérifier`. Preuve : un test, une
capture, une revue, une commande ou un document — un chemin ou une commande,
pas une phrase.

## Vérifications

| Vérification | Résultat | Preuve |
|---|---|---|
| Tests | vert (109/109, 1880/1880) | `npm --prefix vscode-extension run test:unit` via grimoire standard gate run-tests --task-id GAO-impl-mente-l-001 (_grimoire-output/evidence/GAO-impl-mente-l-001/test-run.json) |
| Build / lint | vert | `npx tsc -p ./ --noEmit` → No errors ; `npx eslint ... --max-warnings=0` → No issues ; `npm run package:linux-x64` → exit 0, réinstallé, confirmé sur le build réel |
| Sécurité | vérifié | `test/unit/security/webview-injection.test.ts` (inclus dans la suite complète) toujours vert — le nouveau texte des `<select>`/`.field-hint` reste statique, jamais interpolé |
| Design / accessibilité | amélioré | jargon brut remplacé par des libellés explicatifs dans l'éditeur de profil ; retour visible permanent du choix de voix dans 2 surfaces (player, tooltip barre de statut) |
| Evals IA |  |  |

## Risques et limites

| Risque ou limite | Impact | Décision |
|---|---|---|
| Ambiguïté Piper/voix système non résolue (même `providerId`) | "Voix système" et "Voix française autonome" affichent le même libellé | accepté, documenté, carte séparée si retenue |
| Points "gênant"/"cosmétique" de l'audit non traités (traductions restantes, icônes Profils, sous-textes boutons) | confusion résiduelle sur des points secondaires | accepté pour cette carte, scope P1 uniquement |

## Décision

| Décision | Validateur | Date | Commentaire |
|---|---|---|---|
| en attente |  |  |  |

Décisions : `accepté`, `refusé`, `ajustement demandé`, `en attente`. Une
décision `accepté` sans validateur ni date n'en est pas une.
