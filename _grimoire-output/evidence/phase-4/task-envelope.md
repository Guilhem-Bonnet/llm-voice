# Agentic Task Envelope

## Task

- Task id: phase-4
- Request: Providers réels : OllamaNarrator (S4.1), ChatterboxProvider/Kokoro/Piper preset + registre + santé + backoff + buffering + pinning (S4.2), ops Linux : compose ROCm RDNA4, doc d'installation, script E2E réel et exécution time-boxée sur la machine dev (S4.3). AC-07..11.
- Owner agent: concierge (Marcel)
- Profile: starter
- Current state: `done`
- Risk level: `medium` (téléchargement de modèles sur la machine dev, conteneurs GPU ; aucune action destructive)

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| worktree par story | write | branches `feat/s4-*`, PR vers main | jamais de push direct, jamais `--force` |
| docker compose up (S4.3) | execute | services Chatterbox + Ollama en localhost, volumes sous `~/.llm-voice/` | pas de `--rm -v`, pas de suppression d'images ; time-box 3 itérations |
| ollama pull / téléchargement HF | execute | modèles nécessaires à l'E2E | volontaire, documenté, une fois |

## LLM routing

| Step | Provider | Model or capability | Fallback | Data policy |
|---|---|---|---|---|
| S4.1, S4.2, S4.3, revue | Anthropic | sonnet | opus après 2 échecs identiques | public |
| Gate | Anthropic | fable | — | evidence-pack |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted | « ok go avec le mode économie » 2026-09-08 | recorded |
| Implementation complete | 3 PR mergées, E2E réel tenté et rapporté | pending |
| Validation complete | CI verte, revue Sentinel, AC-07..11 (ou écarts explicites) | pending |
| Deviations documented | evidence-pack phase-4 | pending |
