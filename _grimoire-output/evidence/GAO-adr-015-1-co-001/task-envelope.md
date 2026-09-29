# Agentic Task Envelope

## Task

- Task id: GAO-adr-015-1-co-001
- Request: ADR-015 étape 1 (contrat) — `contracts/direction-v1/` (schémas JSON
  Schema 2020-12 de la partition et de la bible, exemples valides/invalides,
  README), `vscode-extension/src/core/direction.ts` (types + Zod équivalents,
  ramenage dans les bornes §7, conversion partition neutre <-> contrat actuel
  du narrateur), tests vitest 1 (contrat, Zod ET ajv), 2 (test doré de
  compatibilité ascendante) et tests de propriété du ramenage.
- Owner agent: backend-engineer (Stack), mode non-interactif
- Profile: controlled
- Current state: `running`
- Risk level: `low` (fichiers de contrat, module pur sans `vscode`, tests ; aucun
  appel réseau, aucun LLM local, aucun GPU)

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---:|
| Contrat partition, bible, portées, garde-fous, compatibilité, emplacement | `docs/adr/ADR-015-reading-direction.md` §3, §4, §7, §9, §11 (Accepté 2026-09-29) | source normative | 2026-09-29 | ~8k |
| Tests 1 et 2 | ADR-015 §« Tests qui prouvent la décision » | verdicts attendus | 2026-09-29 | ~1k |
| Contrat narrateur actuel `{sourceIds, spokenText}` | `vscode-extension/src/narrator/narrationContract.ts`, `src/core/narration.ts` | sous-ensemble de la consigne à convertir sans perte | 2026-09-29 | ~2k |
| Requête de synthèse d'aujourd'hui | `src/playback/AudioQueue.ts` (`requestFor`), `src/playback/PlaybackController.ts` (segment -> chunk) | définit « au champ près » du test doré | 2026-09-29 | ~2k |
| Organisation des contrats et exemples | `contracts/core-v1/**`, `test/unit/contracts/core-v1.contract.test.ts` | convention de dépôt (manifest, ajv `Ajv2020`) | 2026-09-29 | ~3k |
| Style Zod | `src/core/profile.schema.ts` | convention de dépôt | 2026-09-29 | ~1k |

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| Write/Edit | write | `contracts/direction-v1/**`, `vscode-extension/src/core/direction.ts` (+ export dans `src/core/index.ts`), `vscode-extension/test/unit/contracts/direction-v1.*.test.ts`, `vscode-extension/test/unit/core/direction*.test.ts`, `_grimoire-output/evidence/GAO-adr-015-1-co-001/**` | jamais `src/playback/**`, `src/pipeline/**`, `src/narrator/**` (lecture seule) |
| Bash | execute | `npm --prefix vscode-extension`, `grimoire` | pas de commit, pas de `git push`/`gh`, aucun LLM/GPU, jamais `policies reset-session` |

## LLM routing

| Step | Provider | Model | Fallback | Data policy |
|---|---|---|---|---|
| Rédaction contrat + tests (backend-engineer) | Anthropic | sonnet | — | code local uniquement |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | brief non-interactif explicite (orchestrateur) | recorded |
| Implementation complete | `contracts/direction-v1/**`, `src/core/direction.ts`, tests | en cours |
| Validation complete | `npm run test:unit`, `typecheck`, `lint` | en cours |
| Deviations documented | `evidence-pack.md` de cette tâche | en cours |
