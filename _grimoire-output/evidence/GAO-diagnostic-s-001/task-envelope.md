# Agentic Task Envelope

## Task

- Task id: GAO-diagnostic-s-001
- Request: Établir la chaîne causale des symptômes rapportés sur la 0.2.1 installée (aucun son, surlignage faux et trop rapide, langue non définie après changement de profil ou de voix), puis trancher l'introduction d'un composant Rust dans le chemin audio et éventuellement dans la synthèse.
- Owner agent: concierge (Marcel) — orchestration et routage uniquement ; frontière d'outils : lecture et recherche
- Profile: controlled
- Current state: `executing`
- Risk level: `medium` (décision d'architecture pouvant introduire un binaire natif distribué ; aucun code produit modifié à ce stade)

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---:|
| Symptômes utilisateur | conversation du 2026-09-14 | source du besoin | jour même | ~1k |
| `src/playback/WebviewAudioSink.ts` | dépôt | pont audio suspecté, retour silencieux sans webview | main | ~2k |
| `media/player/player.js` | dépôt | gestion réelle de `audio.src`, `error`, `ended` | main | ~2k |
| `src/playback/PlaybackController.ts` | dépôt | politique sur chunk en erreur | main | ~3k |
| ADR-001, 005, 009, 010, 011 | `docs/adr/` | décisions existantes que l'ADR-012 doit respecter ou réviser | main | ~8k |

## Knowledge base usage

| Knowledge source | Query or index | Trust level | Used as source of truth? | Notes |
|---|---|---|---|---|
| Documentation des bibliothèques audio Rust et sherpa-onnx (web) | recherche par l'architecte | moyenne | no | tout fait non sourcé doit être marqué « non vérifié » |

## Memory usage

| Memory surface | Read/write | Purpose | Integrity check |
|---|---|---|---|
| `_grimoire/_memory/decisions-log.md` | write | consigner la décision Rust une fois tranchée | format respecté |
| `_grimoire/_memory/failure-museum.md` | write | consigner la leçon sur l'échec silencieux de la chaîne audio | — |

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| Lecture et recherche (concierge) | read-only | dépôt | aucun |
| Worktrees dédiés par agent | write | `scratchpad/wt/diag-audio`, `scratchpad/wt/rust-strategy` | jamais le clone réel, jamais `~/.config/Code` ni `~/.vscode` |
| Profil VS Code jetable | execute | `--user-data-dir` et `--extensions-dir` sous scratchpad | n'altère pas l'installation de l'utilisateur |
| Conteneur Chatterbox | read-only | `localhost:8004` interrogé, jamais arrêté | — |

## LLM routing

| Step | Provider | Model | Fallback | Data policy |
|---|---|---|---|---|
| Diagnostic système | Anthropic | sonnet | opus après 2 échecs identiques | code public |
| Décision d'architecture (ADR-012) | Anthropic | opus | — | code public |
| Orchestration et gates | Anthropic | opus (boucle principale) | — | evidence-pack |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | demande utilisateur du 2026-09-14, reformulée et confirmée dans la réponse d'ouverture | recorded |
| Implementation complete | diagnostic écrit avec preuves, ADR-012 tranché | pending |
| Validation complete | gate check --strict vert, décision présentée à l'utilisateur avant tout code produit | pending |
| Deviations documented | evidence-pack de la tâche | pending |
