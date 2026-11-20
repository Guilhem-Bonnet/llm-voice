# Agentic Task Envelope

## Task

- Task id: GAO-cartographie-001
- Request: Cartographier les points d'usage et d'implémentation du futur pseudo-profil « Auto »
  (mode de décision SemIf sur Ollama, décision du 2026-09-27) dans le dépôt existant, sans écrire de code.
- Owner agent: platform-architect (Archie) — lecture et écriture de documentation uniquement
- Profile: controlled
- Current state: `executing`
- Risk level: `low` (aucun code produit modifié ; document de cartographie uniquement)

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---:|
| `_grimoire-output/planning-artifacts/decision-models-jev-v1.md` §2,5,6,10 | dépôt | décision et mémo technique de branchement des fournisseurs | 2026-09-27 | ~6k |
| Entrée « Mode Auto : SemIf sur Ollama retenu » | `_grimoire/_memory/decisions-log.md` | décision tranchée à respecter | 2026-09-27 | ~1k |
| Fichiers `vscode-extension/src/{core,narrator,profiles,pipeline,claude,ui,commands,views}` cités dans le livrable | dépôt, ouverts un à un | localiser les points d'usage/implémentation réels avant de les citer | main | ~20k |
| `vscode-extension/package.json` (section `contributes.configuration`) | dépôt | connaître les réglages `llmVoice.*` existants et leur forme | main | ~3k |

## Knowledge base usage

| Knowledge source | Query or index | Trust level | Used as source of truth? | Notes |
|---|---|---|---|---|
| — | — | — | no | Aucune recherche web pour cette tâche ; uniquement lecture du dépôt et de la mémoire projet. |

## Memory usage

| Memory surface | Read/write | Purpose | Integrity check |
|---|---|---|---|
| `_grimoire/_memory/decisions-log.md` | read | contexte de la décision du 2026-09-27 à respecter | format déjà conforme, non modifié |
| `_grimoire/_memory/shared-context.md` | read | invariants P0 n°1-5 à citer dans le livrable | non modifié |

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| Read | read-only | dépôt entier | aucun |
| Edit/Write | write | `_grimoire-output/planning-artifacts/decision-points-map-v1.md`, `_grimoire-output/evidence/GAO-cartographie-001/*` | jamais `vscode-extension/src`, jamais `_grimoire/_memory/*` |

## LLM routing

| Step | Provider | Model | Fallback | Data policy |
|---|---|---|---|---|
| Cartographie | Anthropic | sonnet | — | code public, lecture seule |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | brief de dispatch de l'orchestrateur, cité ci-dessus | recorded |
| Implementation complete | `decision-points-map-v1.md` écrit, chemins vérifiés par lecture directe | pending → done à l'écriture du livrable |
| Validation complete | lint des chemins et gate exécutés par l'orchestrateur (hors frontière de cet agent) | pending |
| Deviations documented | `evidence-pack.md` de cette tâche | pending → done à l'écriture du pack |
