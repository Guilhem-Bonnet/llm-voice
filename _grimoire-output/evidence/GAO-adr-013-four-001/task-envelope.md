# Agentic Task Envelope

## Task

- Task id: GAO-adr-013-four-001
- Request: Rédiger `docs/adr/ADR-013-decision-provider.md` (statut « Proposé ») : contrat `DecisionProvider` au format Jev (`choice` / `score` / `noul`) dans `src/core/decision.ts`, première implémentation `OllamaLogprobsDecisionProvider` (technique SemIf sur `POST /api/generate` natif), `NoneDecisionProvider` en repli statique, représentation du pseudo-profil « Auto » vis-à-vis de `VoiceProfileSchema`, extensions futures (`JevDecisionProvider` ☁, `LayaDecisionProvider`), invariants P0, alternatives rejetées, plan de vérification.
- Owner agent: platform-architect (Archie) — décision d'architecture documentée ; frontière d'outils : lecture et écriture de documents, pas de code applicatif, pas d'exécution
- Profile: controlled
- Current state: `executing`
- Risk level: `medium` (décision d'architecture : nouvelle famille de providers, nouveau format réseau vers Ollama sur le chemin de lecture, identifiant de profil réservé ; aucun code produit modifié par cette tâche)

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---:|
| Persona et règles | `_grimoire/kit/agents/platform-architect.md` | protocole de l'agent (ADR obligatoire, Mermaid, contrats avant implémentation) | kit 3.46.1 | ~2k |
| Invariants P0, organisation | `_grimoire/_memory/shared-context.md` | contraintes non négociables | 2026-09-27 | ~4k |
| Format ADR | `docs/adr/README.md`, `ADR-009-tts-tiers.md`, `ADR-010-egress-guard.md`, `ADR-005-provider-contracts.md` | gabarit MADR court, mode dégradé obligatoire, `EgressGuard` | main 88384dc | ~8k |
| Étude et arbitrage | `_grimoire-output/planning-artifacts/decision-models-jev-v1.md` (§10 corrige §5) | SemIf sur Ollama retenu, Laya en réserve, Jev jamais par défaut | 2026-09-27 | ~6k |
| Carte d'implémentation | `_grimoire-output/planning-artifacts/decision-points-map-v1.md` | points d'insertion `path:line`, esquisse de contrat, risques | 2026-09-27 | ~6k |
| Décision journalisée | `_grimoire/_memory/decisions-log.md`, entrée 2026-09-27 « Mode Auto » | décision validée par l'utilisateur | 2026-09-27 | ~1k |
| Contrats existants | `src/core/narration.ts`, `src/core/profile.schema.ts`, `src/core/health.ts`, `src/narrator/createNarratorProvider.ts`, `src/net/EgressGuard.ts`, `src/profiles/bySource.ts`, `src/profiles/migrations.ts`, `package.json` (réglages) | gabarits de contrat, fabrique, garde réseau, résolution de profil | main 88384dc | ~12k |

## Knowledge base usage

| Knowledge source | Query or index | Trust level | Used as source of truth? | Notes |
|---|---|---|---|---|
| Documentation API Ollama (web) | non consultée | — | no | la forme exacte des champs `logprobs`/`top_logprobs` et le plafond de `top_logprobs` sont marqués « non vérifié » dans l'ADR ; seule la preuve locale du 2026-09-27 (§10 de l'étude) est citée |
| Format filaire Jev `/v1/systemone` | non consulté | — | no | déclaré non vérifié par l'étude elle-même (§9, limites) |

## Memory usage

| Memory surface | Read/write | Purpose | Integrity check |
|---|---|---|---|
| `_grimoire/_memory/shared-context.md` | read | invariants P0 | — |
| `_grimoire/_memory/decisions-log.md` | read | décision du 2026-09-27 | — |

Aucune écriture mémoire : interdit par le brief de dispatch (`_grimoire/_memory/*` hors périmètre). La journalisation de l'ADR dans `decisions-log.md` revient à l'orchestrateur.

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| Read / Glob | read-only | dépôt | aucun |
| Write / Edit | write | `docs/adr/ADR-013-decision-provider.md`, `docs/adr/README.md` (index manuel, ligne ADR-013), `_grimoire-output/evidence/GAO-adr-013-four-001/` | jamais `vscode-extension/src`, jamais `_grimoire/_memory/*`, jamais un autre dossier de preuve |
| Bash | absent | — | aucune commande exécutée : rien n'est prouvé par exécution dans cette tâche |

## LLM routing

| Step | Provider | Model | Fallback | Data policy |
|---|---|---|---|---|
| Rédaction de l'ADR-013 (platform-architect) | Anthropic | opus | — | code public |
| Vérification indépendante | Anthropic | sonnet (agent distinct, contexte neuf) | — | ADR + evidence-pack |
| Orchestration et gate | Anthropic | boucle principale (concierge) | — | evidence-pack |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | dispatch de l'orchestrateur (carte `GAO-adr-013-four-001`, état `running`) avec contenu attendu détaillé | recorded |
| Implementation complete | `docs/adr/ADR-013-decision-provider.md` écrit, ligne ajoutée à `docs/adr/README.md` | pending |
| Validation complete | relecture par un vérificateur indépendant ; `grimoire standard gate check --task-id GAO-adr-013-four-001 --strict` (exécuté par l'orchestrateur, pas par cet agent) | pending |
| Deviations documented | `evidence-pack.md` de la tâche (choix tranchés, points ouverts, non vérifié) | pending |
