# Agentic Task Envelope

## Task

- Task id: phase-2
- Request: Architecture du MVP : ADR-001..011, interfaces TypeScript, fakes et fixtures de test, triage Dependabot. Mode économie de tokens : Opus uniquement sur ADR-001..005 (audio, sync, hook, stockage, providers) ; Sonnet pour ADR-006..011 (transcription de décisions déjà prises), fakes/fixtures et revue ; Haiku pour le triage Dependabot ; Fable orchestration.
- Owner agent: concierge (Marcel)
- Profile: starter
- Current state: `done`
- Risk level: `medium` (code de test et docs ; PR sur repo public ; merges après revue Sentinel)

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---:|
| decisions-cadrage-v1.md D1-D12 | planning-artifacts | entrées des ADR | 2026-09-08 | ~8k |
| CdC §10, 14, 20, 23, 29-37, 60-62 | cahier-des-charges.md | contrats TS de référence | 2026-09-08 | ~6k |
| études local/linux/ui | planning-artifacts | ADR-009..011 | 2026-09-08 | ~6k |
| squelette vscode-extension/ | repo | conventions existantes | HEAD 17fbf8e | ~2k |

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| Agent worktree isolé | write | branche dédiée par agent, PR vers main | pas de push direct sur main |
| npm ci / test | execute | vscode-extension/ | local |
| gh pr merge | execute | après revue Sentinel consignée dans la PR ; `--admin` autorisé tant que le projet est solo (règle consignée) | — |

## LLM routing

| Step | Provider | Model or capability | Fallback | Data policy |
|---|---|---|---|---|
| ADR-001..005 + interfaces TS | Anthropic | opus | — | public |
| ADR-006..011 | Anthropic | sonnet | opus | public |
| Fakes, fixtures, mocks HTTP | Anthropic | sonnet | opus | public |
| Triage Dependabot | Anthropic | haiku | sonnet | public |
| Revue des PR | Anthropic | sonnet (Sentinel) | — | public |
| Gate | Anthropic | fable | — | evidence-pack seulement |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | « oui fais le tout » 2026-09-08 | recorded |
| Implementation complete | 11 ADR mergés, fakes mergés, Dependabot trié | pending |
| Validation complete | CI verte, revue Sentinel par PR | pending |
| Deviations documented | evidence-pack phase-2 | pending |
