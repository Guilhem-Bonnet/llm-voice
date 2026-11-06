# Agentic Acceptance Record

Un livrable métier n'est accepté que par celui qui le reçoit. Ce dossier relie
chaque critère d'acceptation à sa preuve et porte la décision du client ou du
validateur : accepter, refuser, demander un ajustement.

- Task id: GAO-feat-v-rific-001
- Profile: controlled
- Deliverable: feat: vérification de connexion en direct dans l'éditeur de profil (solution durable)
- Validator: guilhem-bonnet

## Critères d'acceptation

| ID | Critère | Preuve | Statut |
|---|---|---|---|
| AC-001 | gate: grimoire standard gate check --strict vert | `grimoire standard gate check --task-id GAO-feat-v-rific-001 --strict` (2026-11-05) | passé |
| AC-002 | test: npm --prefix vscode-extension run test:unit vert | 110 fichiers / 1903 tests verts, `_grimoire-output/evidence/GAO-feat-v-rific-001/test-run.json` | passé |

Statuts : `passé`, `partiel`, `échoué`, `à vérifier`. Preuve : un test, une
capture, une revue, une commande ou un document — un chemin ou une commande,
pas une phrase.

## Vérifications

| Vérification | Résultat | Preuve |
|---|---|---|
| Tests | vert (110/110, 1903/1903) | `npm --prefix vscode-extension run test:unit` via grimoire standard gate run-tests --task-id GAO-feat-v-rific-001 (_grimoire-output/evidence/GAO-feat-v-rific-001/test-run.json) |
| Build / lint | vert | `npx tsc -p ./ --noEmit` → No errors ; `npx eslint ... --max-warnings=0` → No issues ; `npm run package:linux-x64` → exit 0, réinstallé, confirmé sur le build réel |
| Sécurité | non applicable | réutilise `health()`, déjà établi partout dans le projet (ADR-005) |
| Design / accessibilité | amélioré | statut annoncé via `aria-live="polite"` ; couleurs issues des tokens VS Code (`--vscode-charts-green`, `--vscode-editorError-foreground`), pas de couleur codée en dur |
| Evals IA |  |  |

## Risques et limites

| Risque ou limite | Impact | Décision |
|---|---|---|
| `ProfileEditorPanel.ts` n'a pas de test unitaire dédié pour `handleCheckHealth` | couvert seulement par les tests d'intégration (hors `npm run test:unit`), même limite préexistante que `handleTest`/`handleBrowseVoices` | accepté, cohérent avec le reste du fichier |
| La vérification ne teste que `health()`, pas une synthèse réelle | un serveur "healthy" mais défaillant sur un texte précis ne serait pas détecté | accepté, comportement volontaire (rapide, sans effet de bord audio) |

## Décision

| Décision | Validateur | Date | Commentaire |
|---|---|---|---|
| en attente |  |  |  |

Décisions : `accepté`, `refusé`, `ajustement demandé`, `en attente`. Une
décision `accepté` sans validateur ni date n'en est pas une.
