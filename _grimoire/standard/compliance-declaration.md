# Agentic Compliance Declaration

## Declaration

- Project: TTS-Voice
- Declared profile: `controlled`
- Standard reference: processus-developpement-agentique/docs/norme-structure-agentique.md
- Declaration owner: guilhem-bonnet
- Review cadence: à chaque montée de version du kit Grimoire et à chaque release de l'extension

## Profile coverage

| Requirement or capability | Status | Evidence | Gap |
|---|---|---|---|
| Workflow State Engine | implemented | un `task-envelope.md` par phase sous `_grimoire-output/evidence/phase-1..10/` ; état déclaré dans chaque enveloppe | — |
| Advanced Context Orchestrator | implemented | table « Context orchestration » de chaque enveloppe ; agents 3.46 chargent uniquement leur `context:` déclaré | — |
| Evidence-Gated Workflow FSM | implemented | `grimoire standard gate check --task-id <phase> --strict` avant chaque clôture ; hook `Stop` câblé dans `.claude/settings.json` | le hook `Stop` ne bloque qu'aux profils `governed`/`production` |
| Agent Telemetry Plane | partial | journal de traces `_grimoire-output/traces/` (dispatchs, non-choix `agent-miss`) ; `grimoire dispatch stats` | moins de 5 dispatchs résolus journalisés : coût par tâche et pass^k non encore jugés |
| Tool Blast-Radius Limiter | implemented | hook `PreToolUse` (profil de risque) + `_grimoire/standard/policies.yaml` (approbation par session, refroidissement, budget) + `permissions.deny/ask` | — |
| Knowledge Base Indexer | not applicable | aucune source externe indexée ; `knowledge-source-registry.yaml` réservé au profil `orchestrated` | à revoir si une documentation externe est indexée |
| LLM Provider Abstraction | implemented | `_grimoire/standard/llm-provider-registry.yaml` : Anthropic (4 paliers) + Ollama local, chaîne de repli, classes de données | — |

## Provider compatibility

| Provider | Status | Allowed use | Data policy |
|---|---|---|---|
| GitHub Copilot | not used | hôte possible des agents Grimoire (Copilot Chat), jamais fournisseur appelé par le projet | — |
| OpenAI Codex/OpenAI | not used | — | — |
| Anthropic Claude | enabled | Fable = orchestration ; Opus = ADR/audits ; Sonnet = code/tests/revues ; Haiku = CI/docs | code du projet, CdC, fixtures synthétiques ; jamais secrets, `.env`, documents personnels, audio utilisateur |
| Google Gemini | not used | — | — |
| Local/open-weight | enabled | Ollama `qwen2.5:7b` : narrateur de l'extension et embeddings de la mémoire Grimoire | texte narré traité en local uniquement (invariant P0 local-first) |

## Traceability

- Matrix: `grimoire standard traceability .` — requirement, control, evidence and verdict for every required artifact
- Level reached: profil `controlled` (need `provider-neutral`, pattern `provider-routing-contract`)
- Last verdict: `grimoire standard verify .` du 2026-09-13 — voir `_grimoire-output/evidence/phase-10/evidence-pack.md`

## Non-conformities

| Item | Severity | Remediation | Owner |
|---|---|---|---|
| Télémétrie de dispatch insuffisante pour juger le coût par tâche résolue (< 5 dispatchs) | faible | dispatcher les prochaines phases via `grimoire task dispatch` pour alimenter `dispatch stats` | guilhem-bonnet |
| Windows et macOS non validés manuellement pour l'extension | moyenne | test d'acceptation sur profil VS Code neuf par OS avant la 1.0 | guilhem-bonnet |

## Statement

This declaration describes the Grimoire Kit implementation state for a selected profile. It does not replace the upstream normative corpus.
