# Agentic Task Envelope

## Task

- Task id: phase-9
- Request: Corriger les deux retours du test réel de l'utilisateur sur la version 0.2 : « Aucune voix configurée » après avoir choisi une voix, et point d'entrée par raccourci jugé non intuitif au profit d'une vue dédiée dans VS Code.
- Owner agent: concierge (Marcel)
- Profile: starter
- Current state: `done`
- Risk level: `low`

## Tool boundary

| Tool | Permission | Scope |
|---|---|---|
| worktree par story | write | branches dédiées, PR vers main |
| `~/.config/Code/` | lecture seule | diagnostic du `profiles.json` réel de l'utilisateur |

## LLM routing

| Step | Model |
|---|---|
| Correctif (fix-loop) | sonnet |
| Vue dédiée | sonnet |
| Revue et merge | sonnet |
| Orchestration et gate | opus |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted | retour utilisateur du 2026-09-12 | recorded |
| Implementation complete | PR #54 et #55 mergées | done |
| Validation complete | mutation-tests, 10 exécutions vertes, CI 9/9 | done |
| Deviations documented | evidence-pack phase-9 | done |
