# Agentic Task Envelope

## Task

- Task id: phase-5
- Request: Inbox Claude Code (watcher, dépôt, Quick Pick + TreeView, hook/plugin, CLI inbox) (S5.1) ; profils par source, Select/Open Profiles, Test Voice, Provider Status, SecretStorage (S5.2) ; erreurs UX CdC §52, journalisation sans contenu, AC-16/17, guide utilisateur (S5.3). AC-12..17.
- Owner agent: concierge (Marcel)
- Profile: starter
- Current state: `done`
- Risk level: `medium` (édition optionnelle de `~/.claude/settings.json` derrière consentement explicite ; jamais silencieuse)

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| worktree par story | write | branches `feat/s5-*`, PR vers main | jamais de push direct, jamais `--force` |
| tests sur `~/.claude/settings.json` | read-only en test ; écriture uniquement sur un fichier temporaire | — | l'installeur réel n'est jamais exécuté par les agents |

## LLM routing

| Step | Provider | Model or capability | Fallback | Data policy |
|---|---|---|---|---|
| S5.1, S5.2, S5.3, revue | Anthropic | sonnet | opus après 2 échecs identiques | public |
| Gate | Anthropic | fable | — | evidence-pack |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted | « Go en mode économie » 2026-09-08 | recorded |
| Implementation complete | 3 PR mergées, AC-12..17 en intégration | pending |
| Validation complete | invariant zéro autoplay testé avec `src/claude` réel ; CI verte ; revue Sentinel | pending |
| Deviations documented | evidence-pack phase-5 | pending |
