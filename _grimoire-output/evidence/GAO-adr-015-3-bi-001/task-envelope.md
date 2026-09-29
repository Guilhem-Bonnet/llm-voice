# Agentic Task Envelope

## Task

- Task id: GAO-adr-015-3-bi-001
- Request: ADR-015 étape 3 (bible) — `BibleStore` sans `vscode` : journal en ajout seul par portée
  (document, série, préférences), projection (état reconstitué), application stricte des droits
  d'écriture (événement LLM hors portée document refusé et journalisé), promotion document -> série
  sur action utilisateur, édition utilisateur, oubli (tombstone, puis compactage explicite),
  identifiants de document par hash, fichiers sous globalStorage en 0600, résistance aux fichiers
  corrompus. Test 9 de l'ADR et tests de propriété.
- Owner agent: backend-engineer (Stack), mode non-interactif
- Profile: controlled
- Current state: `running`
- Risk level: `low` (module pur sans `vscode`, fichiers sous un répertoire fourni par l'appelant ; aucun
  réseau, aucun LLM local, aucun GPU)

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---:|
| Bible, portées, droit d'écriture, stockage, oubli, opt-in inbox | `docs/adr/ADR-015-reading-direction.md` §4, §11, test 9 (Accepté 2026-09-29) | source normative | 2026-09-29 | ~5k |
| Types et schémas Zod de la bible, `checkBible` | `vscode-extension/src/core/direction.ts` | projection à produire, validation | 2026-09-29 | ~4k |
| Règle d'écriture étendue à `casting` et `analysis` | `_grimoire-output/evidence/GAO-adr-015-1-co-001/claim-ledger.md` CL-007 (hypothèse) | portée du droit d'écriture | 2026-09-29 | ~1k |
| Écriture atomique, droits, chemins | `src/profiles/ProfileRepository.ts`, `src/claude/InboxRepository.ts`, `src/core/safePath.ts` | convention de dépôt | 2026-09-29 | ~3k |

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| Write/Edit | write | `vscode-extension/src/direction/bible/**`, `vscode-extension/test/unit/direction/bible/**`, `_grimoire-output/evidence/GAO-adr-015-3-bi-001/**` | jamais `src/core/direction.ts` (lecture seule) ni le code des étapes 2 et 4 (agents parallèles) |
| Bash | execute | `npm --prefix vscode-extension`, `grimoire` | pas de commit, pas de `git push`/`gh`, aucun LLM/GPU, jamais `policies reset-session` |

## LLM routing

| Step | Provider | Model | Fallback | Data policy |
|---|---|---|---|---|
| Implémentation + tests (backend-engineer) | Anthropic | sonnet | — | code local uniquement |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | brief non-interactif explicite (orchestrateur) | recorded |
| Implementation complete | `src/direction/bible/**`, tests | en cours |
| Validation complete | `npm run test:unit`, `typecheck`, `lint` | en cours |
| Deviations documented | `evidence-pack.md` de cette tâche | en cours |
