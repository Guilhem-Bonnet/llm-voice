# Agentic Acceptance Record

Un livrable métier n'est accepté que par celui qui le reçoit. Ce dossier relie
chaque critère d'acceptation à sa preuve et porte la décision du client ou du
validateur : accepter, refuser, demander un ajustement.

- Task id: GAO-fix-provider-001
- Profile: controlled
- Deliverable: fix: provider Kyutai Pocket TTS absent du sélecteur UI et de la liste de voix parcourable
- Validator: guilhem-bonnet

## Critères d'acceptation

| ID | Critère | Preuve | Statut |
|---|---|---|---|
| AC-001 | gate: grimoire standard gate check --strict vert | `grimoire standard gate check --task-id GAO-fix-provider-001 --strict` (2026-11-05) | passé |
| AC-002 | test: npm --prefix vscode-extension run test:unit vert | 108 fichiers / 1870 tests verts, `_grimoire-output/evidence/GAO-fix-provider-001/test-run.json` | passé |
| AC-003 | test: kyutai-pocket apparaît dans le <select> du profil et « Parcourir les voix » retourne estelle/alba sans appel réseau | `src/views/profileEditor/profileEditorHtml.ts` ligne 93 (option ajoutée) ; `test/unit/tts/KyutaiPocketProvider.test.ts` ("listVoices() resolves the static catalogue with no network call at all") ; confirmé sur le build réellement installé (`~/.vscode/extensions/guilhem-bonnet.llm-voice-0.3.0/dist/extension.js` contient la chaîne du `<option>`) | passé |

Statuts : `passé`, `partiel`, `échoué`, `à vérifier`. Preuve : un test, une
capture, une revue, une commande ou un document — un chemin ou une commande,
pas une phrase.

## Vérifications

| Vérification | Résultat | Preuve |
|---|---|---|
| Tests | vert (108/108, 1870/1870) | `npm --prefix vscode-extension run test:unit` via grimoire standard gate run-tests --task-id GAO-fix-provider-001 (_grimoire-output/evidence/GAO-fix-provider-001/test-run.json) |
| Build / lint | vert | `npx tsc -p ./ --noEmit` → No errors ; `npx eslint ... --max-warnings=0` → No issues ; `npm run package:linux-x64` → exit 0 |
| Sécurité | non applicable | aucun changement de surface réseau ou de secret ; `listVoices()` n'ajoute aucun appel sortant (test dédié) |
| Design / accessibilité |  |  |
| Evals IA |  |  |

## Risques et limites

| Risque ou limite | Impact | Décision |
|---|---|---|
| Catalogue de voix minimal (estelle/alba) | l'utilisateur ne voit que 2 voix dans « Parcourir les voix » pour ce provider | accepté, carte séparée ADR-016 §4 déjà annoncée |
| kyutai-pocket absent de l'onboarding simplifié | un nouvel utilisateur ne découvre ce provider qu'en éditant un profil existant | décision volontaire (palier avancé optionnel), non modifié ici |

## Décision

| Décision | Validateur | Date | Commentaire |
|---|---|---|---|
| en attente |  |  |  |

Décisions : `accepté`, `refusé`, `ajustement demandé`, `en attente`. Une
décision `accepté` sans validateur ni date n'en est pas une.
