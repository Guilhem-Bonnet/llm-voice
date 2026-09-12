# Agentic Task Envelope

## Task

- Task id: phase-8
- Request: (S8.1) Résorber la dette Dependabot : 8 PR de montées majeures de l'outillage. (S8.2) Version 0.2, volet confort : éditeur de profils, navigateur de voix avec écoute, utilisation de sa propre voix enregistrée comme référence.
- Owner agent: concierge (Marcel)
- Profile: starter
- Current state: `done`
- Risk level: `low` (outillage de test et UI ; aucune donnée sortante nouvelle)

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| worktree par story | write | branches `feat/s8-*` et `chore/deps-*`, PR vers main | jamais `--force`, jamais de push direct |
| npm | execute | vscode-extension/ | local |
| microphone | non utilisé | — | l'agent n'enregistre rien, il fournit la commande à l'utilisateur |

## LLM routing

| Step | Provider | Model | Data policy |
|---|---|---|---|
| S8.1 dette outillage | Anthropic | sonnet | public |
| S8.2 confort voix et profils | Anthropic | sonnet | public |
| Revue | Anthropic | sonnet | public |
| Gate | Anthropic | opus (orchestrateur) | evidence-pack |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted | « reprend » 2026-09-11, mode économie toujours actif | recorded |
| Implementation complete | 2 PR mergées, CI verte | pending |
| Validation complete | revue Sentinel, test sur profil neuf conservé vert | pending |
| Deviations documented | evidence-pack phase-8 | pending |
