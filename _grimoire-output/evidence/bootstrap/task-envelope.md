# Agentic Task Envelope

## Task

- Task id: bootstrap
- Request: Review du cahier des charges LLM Voice, brainstorm produit/technique, plan de délégation multi-agents (agent → LLM → vérificateur), pyramide de tests, plan de création et maintenance d'un repo GitHub public.
- Owner agent: concierge (Marcel) — orchestration ; sous-agents : platform-architect, backend-engineer, security-hardener, pipeline-architect
- Profile: starter (agentic-standard, non encore initialisé via `grimoire standard init`)
- Current state: `executing`
- Risk level: `low` (aucune modification de code applicatif ; artefacts de planification uniquement ; création du repo public soumise à confirmation utilisateur)

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---:|
| cahier-des-charges.md | repo racine | Source unique du besoin | 2026-09-08 | ~35k |
| concierge.md + agent-base-compact.md | _grimoire/kit | Persona + protocole obligatoire | kit 3.38.0 | ~6k |
| archetype.dna.*.yaml | _grimoire/kit | Contraintes (evidence, fix-loop, provider-neutral) | kit 3.38.0 | ~5k |
| model_affinity des 18 agents | _grimoire/kit/agents/*.md | Base du routage LLM par agent | kit 3.38.0 | ~1k |
| team-build.yaml | _grimoire/kit/teams | Phases build/QA de référence | kit 3.38.0 | ~2k |

## Knowledge base usage

| Knowledge source | Query or index | Trust level | Used as source of truth? | Notes |
|---|---|---|---:|---|
| Aucune source externe indexée | — | — | no | Les URLs citées dans le CdC ne sont pas re-vérifiées dans cette tâche |

## Memory usage

| Memory surface | Read/write | Purpose | Integrity check |
|---|---|---|---|
| _grimoire/_memory/shared-context.md | read/write | Remplir le contexte projet (first run) | relecture après écriture |
| _grimoire/_memory/decisions-log.md | write | Logger les décisions de routage/plan | format respecté |
| _grimoire/_memory/session-state.md | write | first_run → false | — |

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| Read/Bash (cat, ls, grep) | read-only | projet entier | aucun |
| Write/Bash heredoc | write | _grimoire-output/**, _grimoire/_memory/**, docs de plan | pas de code applicatif, pas de suppression |
| Agent (sonnet/haiku) | spawn | 4 sous-agents en parallèle, écriture limitée à _grimoire-output/planning-artifacts/ | rapports ≤ 300 lignes chacun |
| gh / git | read-only | `gh auth status` uniquement | création repo public = confirmation utilisateur requise |

## LLM routing

| Step | Provider | Model or capability | Fallback | Data policy |
|---|---|---|---|---|
| Orchestration, synthèse, plan de délégation | Anthropic | claude-fable-5-1 | — | CdC non confidentiel |
| Review CdC (platform-architect) | Anthropic | sonnet | opus | idem |
| Brainstorm (backend-engineer) | Anthropic | sonnet | opus | idem |
| Review sécurité/confidentialité (security-hardener) | Anthropic | sonnet | opus | idem |
| Plan repo GitHub + CI (pipeline-architect) | Anthropic | haiku | sonnet | idem |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | Hypothèse autonome : plan = livrable ; repo public créé seulement après confirmation | recorded |
| Implementation complete | 4 rapports sous-agents + plan maître écrits | pending |
| Validation complete | relecture croisée des rapports par l'orchestrateur ; gate check | pending |
| Deviations documented | `_grimoire/standard/` absent → verify attendu en échec, documenté | pending |
