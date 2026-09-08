# Agentic Task Envelope

## Task

- Task id: phase-3
- Request: Slice vertical du MVP : EgressGuard (S3.1), parser + segmenteur (S3.2), PlaybackController + AudioQueue + cache (S3.3), surface VS Code : mini-player webview, highlight, commandes, status bar, CodeLens (S3.4), puis intégration + tests d'acceptation AC-01..06 avec FakeTts (S3.5). Revue Sentinel et merge par lot.
- Owner agent: concierge (Marcel)
- Profile: starter
- Current state: `done`
- Risk level: `medium` (code applicatif, PR publiques, aucun service externe)

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---:|
| docs/adr/ADR-001..011 | repo main | contrats et décisions | 2026-09-08 | ~10k par agent (lecture ciblée) |
| src/core/*.ts | repo main | types à implémenter | 2026-09-08 | ~3k |
| test/fakes, test/fixtures | repo main | outillage | 2026-09-08 | ~2k |
| CdC §11-17, 29-37, 51-52, 62-65, 82 | cahier-des-charges.md | comportements attendus | 2026-09-08 | ~5k |

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| worktree dédié par story | write | branche `feat/s3-x-*`, PR vers main | jamais de push direct sur main, jamais de `push --force` (hook) |
| npm ci / lint / typecheck / test / xvfb-run test:integration | execute | vscode-extension/ | local |
| gh pr create / checks / merge | execute | merge par l'agent de revue seulement, après commentaire Sentinel | — |

## LLM routing

| Step | Provider | Model or capability | Fallback | Data policy |
|---|---|---|---|---|
| S3.1 EgressGuard, S3.2 parser, S3.4 surface VS Code, S3.5 intégration | Anthropic | sonnet | opus après 2 échecs | public |
| S3.3 PlaybackController (state machine, prefetch, cancellation) | Anthropic | opus | — | public |
| Revue + merge | Anthropic | sonnet (Sentinel) | — | public |
| Gate | Anthropic | fable | — | evidence-pack |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | « go phase 3 » 2026-09-08 | recorded |
| Implementation complete | 5 stories mergées, AC-01..06 verts en intégration | pending |
| Validation complete | CI verte, revue Sentinel par PR, invariant zéro autoplay testé | pending |
| Deviations documented | evidence-pack phase-3 | pending |
