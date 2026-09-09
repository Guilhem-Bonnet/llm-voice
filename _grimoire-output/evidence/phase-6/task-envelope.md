# Agentic Task Envelope

## Task

- Task id: phase-6
- Request: Hardening et release 0.1 : audit sécurité (S6.1, Opus), latence et performance (S6.2, Sonnet), docs, traçabilité AC ↔ tests, politique de confidentialité, CHANGELOG (S6.3, Haiku) ; revue Sentinel ; tag v0.1.0 et release GitHub avec VSIX (Convoy, Haiku) ; checklist E2E manuel utilisateur.
- Owner agent: concierge (Marcel)
- Profile: starter
- Current state: `done`
- Risk level: `medium` (release publique v0.1.0 ; pas de publication Marketplace)

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| worktree par story | write | branches `feat/s6-*`, PR vers main | jamais `--force` |
| tag + release | execute | `v0.1.0` après merge et CI verte | pas de `VSCE_PAT`, pas de Marketplace |
| E2E réel | execute | Chatterbox :8004, Ollama :11434 | lecture seule sur les conteneurs |

## LLM routing

| Step | Provider | Model or capability | Fallback | Data policy |
|---|---|---|---|---|
| S6.1 audit sécurité | Anthropic | **opus** | — | public |
| S6.2 latence | Anthropic | sonnet | opus si state machine | public |
| S6.3 docs, S6.4 release | Anthropic | haiku | sonnet | public |
| Revue | Anthropic | sonnet | — | public |
| Gate | Anthropic | fable | — | evidence-pack |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted | « Ok go » 2026-09-09 | recorded |
| Implementation complete | 3 PR mergées, release v0.1.0 publiée avec VSIX | pending |
| Validation complete | audit sans finding critique ouvert, CI verte, traçabilité AC complète | pending |
| Deviations documented | evidence-pack phase-6 ; DoD 1.0 partiellement (Windows/macOS non validés à la main) | pending |
