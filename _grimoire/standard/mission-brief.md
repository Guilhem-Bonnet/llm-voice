# Agentic Mission Brief

## Identity

- Project: LLM Voice (repo TTS-Voice)
- Owner: guilhem-bonnet
- Selected profile: `controlled` (need `provider-neutral`, depuis Grimoire Kit 3.46.1 le 2026-09-13 ; `starter` du 2026-09-08 au 2026-09-12)
- Upstream standard reference: processus-developpement-agentique/docs/norme-structure-agentique.md
- Date: 2026-09-08 (mis à jour 2026-09-13)

## Scope

- In scope: extension VS Code TypeScript (lecture vocale locale, profils, highlight synchronisé, inbox Claude Code passive), scripts d'intégration hook Claude Code, docs d'installation Ollama/Chatterbox, CI/CD GitHub, tests (unit/intégration/E2E local/sécurité).
- Out of scope: STT, assistant vocal, scraping Copilot, alignement mot par mot, moteur TTS propriétaire, serveur cloud, entraînement de modèle (CdC §75).
- Critical assets: contenu des documents et réponses Claude de l'utilisateur (ne quittent jamais la machine), clés API cloud éventuelles (SecretStorage), `~/.claude/settings.json` (modifié par l'installeur de hook).
- Risk level: `medium`

## Flow objectives

| Objective | Expected outcome | Evidence required |
|---|---|---|
| Phase 0 cadrage | review, brainstorm, sécurité, plan repo, plan maître | evidence-pack bootstrap |
| Phases 1-6 MVP 0.1 | AC-01..AC-17 + AC-SEC-01..10 verts, VSIX publié | evidence-pack par phase, rapports QA, traçabilité AC ↔ tests |
| Phases 7-9 (0.1.1 → 0.2.1) | voix autonome sans Docker, vue dédiée, correctifs de sélection de voix | evidence-pack phase-7..9, releases GitHub |
| Phase 10 outillage | kit Grimoire 3.46.1, profil `controlled`, politiques temporelles, hooks git | evidence-pack phase-10, `grimoire standard verify` |

## Mandatory capabilities

| Capability | Required? | Grimoire artifact | Notes |
|---|---:|---|---|
| Workflow State Engine | yes | Task envelope | un envelope par phase |
| Advanced Context Orchestrator | profile-dependent | Task envelope, context policy | briefs autonomes, sections CdC ciblées |
| Knowledge Base Indexer | profile-dependent | Knowledge source registry | aucune source externe indexée pour l'instant |
| LLM Provider Registry | profile-dependent | Provider registry | Anthropic : Fable/Opus/Sonnet/Haiku selon rôle (plan maître §2-3) |
| Evidence-Gated Workflow | yes | Evidence pack | gate check --strict par phase |

## Governance assumptions

- Approved tools: Read/Bash lecture, Write/Edit sur `_grimoire-output/**`, `_grimoire/_memory/**`, code du repo ; Agent (sous-agents Sonnet/Haiku/Opus avec `model:` explicite) ; git/gh (push et création repo = confirmation utilisateur).
- Writable paths: `_grimoire-output/`, `_grimoire/_memory/`, `_grimoire/standard/`, futur repo `llm-voice/`.
- External services: GitHub (repo public, Actions), Ollama et Chatterbox en localhost uniquement.
- Data classes allowed in prompts: cahier des charges, code du projet, fixtures de test synthétiques.
- Data classes forbidden in prompts: secrets, clés API, contenu de `.env`, documents personnels de l'utilisateur hors repo.

## Known deviations

| Deviation | Reason | Expiry or review trigger |
|---|---|---|
| `knowledge-source-registry.yaml` non généré | aucune source externe indexée ; profil `controlled` ne l'exige pas | dès qu'une source documentaire est indexée (profil `orchestrated`) |
| ~~Repo GitHub non créé~~ | levée : repo `Guilhem-Bonnet/llm-voice` créé le 2026-09-08 sur confirmation utilisateur | — |
