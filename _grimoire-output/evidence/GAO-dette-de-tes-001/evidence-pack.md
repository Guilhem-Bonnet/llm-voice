# Agentic Evidence Pack

## Summary

- Task id: GAO-dette-de-tes-001
- Profile: controlled
- Outcome: Dette de test : system-tts.test.ts attend espeak-ng même quand Piper est installé (échoue sur la machine dev) — critères : AC-001 test : npm run test:integration-real vert sur une machine avec Piper installé; AC-002 gate : grimoire standard gate check --strict vert
- Final state: in_progress (2026-09-29)

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| Point de départ git | HEAD e898d23 | git rev-parse --short HEAD | référence (2026-09-29) |

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->

## Validation

| Check | Command or method | Result | Notes |
|---|---|---|---|
| Tests | `npm --prefix vscode-extension run test:unit` | non exécuté | grimoire standard gate run-tests --task-id GAO-dette-de-tes-001 écrit _grimoire-output/evidence/GAO-dette-de-tes-001/test-run.json |

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

## Correctif (concierge, 2026-09-29)

Cause : `system-tts.test.ts` construisait `SystemTtsProvider` sans `homeDir` ; sur une machine avec Piper (binaire dans le PATH
et voix française dans `~/.llm-voice/voices`), le provider préfère légitimement Piper, donc `endpoint` valait `local:piper`.
Correctif : un dossier personnel vide (`ESPEAK_ONLY_HOME`, `mkdtempSync`) injecté dans les 5 constructions du bloc espeak-ng.
Preuve : `LLM_VOICE_E2E=1 LLM_VOICE_E2E_OLLAMA=1 npm run test:integration-real` → 11 passed (11) ; typecheck 0 erreur ; lint OK.
