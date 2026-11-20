# Agentic Task Envelope

## Task

- Task id: GAO-narrateur-in-001
- Request: Installer `qwen2.5:7b` (modèle par défaut de `llmVoice.narrator.model`, absent de la machine dev au 2026-09-27) et prouver la santé du narrateur Ollama : `ollama list` le contient, une requête `POST /api/chat` avec `format` = JSON Schema `narration-segments` renvoie un JSON valide.
- Owner agent: ops-engineer (Forge) — installation et vérification d'infrastructure locale
- Profile: controlled
- Current state: `executing`
- Risk level: `low` (pull d'un modèle Ollama public depuis le registre officiel ; aucun code produit modifié ; aucune donnée sensible)

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---:|
| Réglage `llmVoice.narrator.model` | `vscode-extension/package.json` | valeur par défaut à installer | main | ~0.2k |
| `ollama list` du 2026-09-27 | commande shell | constat de l'absence du modèle sur la machine dev | jour même | ~0.2k |
| `vscode-extension/src/narrator/OllamaNarrator.ts` | dépôt | forme exacte de la requête `POST /api/chat` (`stream: false`, `format`, messages) | main | ~1k |
| `vscode-extension/src/narrator/narrationContract.ts` | dépôt | JSON Schema `NARRATION_JSON_SCHEMA` et `narrationSystemPrompt()` | main | ~0.5k |
| `vscode-extension/src/narrator/parseNarration.ts` | dépôt | format du message utilisateur (`buildBlockPrompt`, labels `BLOCK_xxx`) | main | ~0.3k |

## Knowledge base usage

| Knowledge source | Query or index | Trust level | Used as source of truth? | Notes |
|---|---|---|---|---|
| Registre Ollama (`ollama pull`) | `qwen2.5:7b` | haute (registre officiel Ollama) | yes | pull standard, pas de miroir tiers |

## Memory usage

Aucune écriture mémoire pour cette tâche : opération d'infrastructure locale ponctuelle, sans décision d'architecture ni leçon nouvelle à consigner. `_grimoire/_memory/*` non touché, conformément au périmètre de la tâche.

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| Bash (ops-engineer) | execute | `ollama pull`, `ollama list`, `curl` local vers `127.0.0.1:11434`, `df -h` | aucune suppression, aucun autre dossier de preuve, `_grimoire/_memory/*` et `vscode-extension/src` non modifiés |
| Read | read-only | dépôt (sources narrateur, evidence de référence) | aucun |
| Write | execute | `_grimoire-output/evidence/GAO-narrateur-in-001/` uniquement | aucun autre chemin de preuve |

## LLM routing

| Step | Provider | Model | Fallback | Data policy |
|---|---|---|---|---|
| Exécution de la tâche (ops-engineer) | Anthropic | sonnet | — | code public / infra locale |
| Test de santé du narrateur | Ollama local | qwen2.5:7b | — | requête locale, texte français court synthétique, aucune donnée d'inbox |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | dispatch de la tâche par l'orchestrateur (carte `GAO-narrateur-in-001`, état `running`) | recorded |
| Implementation complete | `ollama pull qwen2.5:7b` terminé, `ollama list` mis à jour | pending |
| Validation complete | requête `POST /api/chat` structurée réussie, latence mesurée, JSON conforme au schéma | pending |
| Deviations documented | `evidence-pack.md` de la tâche | pending |
