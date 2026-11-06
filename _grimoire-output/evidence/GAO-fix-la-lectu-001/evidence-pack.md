# Agentic Evidence Pack

## Summary

- Task id: GAO-fix-la-lectu-001
- Profile: controlled
- Outcome: Fix : la lecture s'arrête après le premier groupe en mode narré ; lecture de tout fichier texte et depuis l'aperçu Markdown — critères : AC-001 test: npm --prefix vscode-extension run test:unit vert; AC-002 test: scripts/audio-proof/native-real.sh vert sur un document de plusieurs sections; AC-003 revue: essai de guilhem-bonnet consigné dans acceptance-record; AC-004 gate: grimoire standard gate check --strict vert
- Final state: in_progress (2026-11-06)

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| Point de départ git | HEAD 094c7db | git rev-parse --short HEAD | référence (2026-11-06) |

## Validation

| Check | Command or method | Result | Notes |
|---|---|---|---|
| Tests | `npm --prefix vscode-extension run test:unit` | non exécuté | grimoire standard gate run-tests --task-id GAO-fix-la-lectu-001 écrit _grimoire-output/evidence/GAO-fix-la-lectu-001/test-run.json |

## Controls

| Control family | Applied? | Evidence | Gap |
|---|---:|---|---|
| Governance | no |  |  |
| Quality | no |  |  |
| Runtime | no |  |  |
| Knowledge | no |  |  |
| Model/provider | no |  |  |

## Deviations and accepted risks

| Deviation | Impact | Accepted by | Review trigger |
|---|---|---|---|
|  |  |  |  |

## Completion statement

The task can be considered complete only when mandatory evidence gates for the selected profile are satisfied or explicitly marked non-applicable with justification.

## Preuves (2026-11-06)

- Cause : `Pipeline.startInternal` démarrait `sealed: true` sur `build.segments`, sans écouter `onSegmentsAppended`. Rouge constaté : « only 4 passages were played, the first group alone » (`test/integration/pipeline.test.ts`), avec un narrateur Ollama simulé.
- Après correctif : `fake-tts` 69 passing, dont document narré jusqu'à la dernière section, fichier texte entier et à partir du curseur, aperçu Markdown réel de VS Code.
- `previewSource.test.ts` : nom d'onglet, homonymes refusés.
- Non prouvé : narration réelle par Ollama sur un long document, clic droit dans l'aperçu (`webview/context`).
