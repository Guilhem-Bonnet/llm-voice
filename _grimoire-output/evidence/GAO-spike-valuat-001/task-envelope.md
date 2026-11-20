# Agentic Task Envelope

## Task

- Task id: GAO-spike-valuat-001
- Request: Spike de comparaison, sur des réponses Claude réelles de l'inbox, de trois techniques de choix
  de profil de lecture (A = lecture intégrale, B = résumé, C = révision rapide) contre un témoin à règles :
  export d'un jeu de données non étiqueté, technique SemIf sur Ollama (`/api/generate`, logprobs), pistes
  embeddings (k-NN) et rapport comparatif `run-all.mjs`. Aucun code produit engagé — décision différée à
  après étiquetage utilisateur (§10 de `decision-models-jev-v1.md`).
- Owner agent: backend-engineer (Stack) — implémentation Node ESM sous `vscode-extension/scripts/decision-spike/`
- Profile: controlled
- Current state: `executing`
- Risk level: `low` (scripts d'outillage hors du code produit VSIX, aucune dépendance nouvelle, aucun réseau
  sortant hors `127.0.0.1`, aucune écriture dans `_grimoire/_memory/*`)

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---:|
| §5, §6, §10 de `decision-models-jev-v1.md` | `_grimoire-output/planning-artifacts/` | protocole du spike, arbitrage SemIf/Laya/Kev, preuve locale de logprobs Ollama | 2026-09-27 | ~4k |
| Entrée « Mode Auto : SemIf sur Ollama retenu » | `_grimoire/_memory/decisions-log.md` (lecture seule) | décision actée à respecter, non à modifier | 2026-09-27 | ~1k |
| `InboxMessageSchema` (`src/core/inbox.schema.ts`) | dépôt | schéma exact des fichiers d'inbox (`schemaVersion`, `provider`, `sessionId`, `capturedAt`, `cwd?`, `title?`, `message`) | main | ~1k |
| `InboxRepository.ts` | dépôt | convention `.tmp-*` et sous-dossier `archive/` à respecter dans l'export | main | ~1k |
| `eslint.config.mjs` (vscode-extension) | dépôt | confirme que `*.mjs` est déjà hors périmètre du lint | main | ~0.5k |
| Réponse réelle `POST /api/generate` (Ollama 0.21.0, `qwen2.5:3b`) | appel local de vérification | nom exact des champs `logprobs[].token/logprob/top_logprobs[]` avant d'écrire `semif-ollama.mjs` | 2026-09-27 | ~1k |
| Réponse réelle `POST /api/embed` (`nomic-embed-text`) | appel local de vérification | confirme `embeddings: number[][]` | 2026-09-27 | ~0.5k |

## Knowledge base usage

| Knowledge source | Query or index | Trust level | Used as source of truth? | Notes |
|---|---|---|---|---|
| Aucune (pas de recherche web pour cette tâche) | — | — | no | tâche d'implémentation, pas de recherche |

## Memory usage

| Memory surface | Read/write | Purpose | Integrity check |
|---|---|---|---|
| `_grimoire/_memory/decisions-log.md` | read-only | contexte de la décision SemIf/Laya, non modifié par cette tâche | interdiction explicite de modification respectée |
| `_grimoire/_memory/shared-context.md` | read-only | non consulté au-delà du protocole standard, non modifié | interdiction explicite de modification respectée |

## Confidentiality (AC-SEC-07)

- Le texte des messages d'inbox (`message`) ne doit apparaître dans aucun fichier versionné, aucune preuve,
  aucun log de sortie : uniquement des comptages et métriques dérivées (longueur, ratio de code, latences,
  distributions A/B/C).
- Le jeu de données `decision-spike-v1.jsonl` (qui contient `message` en clair pour permettre l'étiquetage
  manuel par l'utilisateur) est écrit sous `~/.llm-voice/eval/`, hors du dépôt git, jamais copié dans
  `_grimoire-output/`.

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| Lecture | read-only | dépôt, `~/.llm-voice/inbox/`, `~/.llm-voice/eval/` | aucune écriture hors `vscode-extension/scripts/decision-spike/` et `~/.llm-voice/eval/` |
| Écriture | write | `vscode-extension/scripts/decision-spike/**`, `~/.llm-voice/eval/**`, `_grimoire-output/evidence/GAO-spike-valuat-001/**` | jamais `vscode-extension/src/**`, jamais `_grimoire/_memory/**`, jamais un autre dossier de preuve |
| Exécution | execute | `node`, `curl` vers `127.0.0.1:11434` uniquement, `npm run lint` | aucun `git commit`, aucune sortie réseau hors loopback |

## LLM routing

| Step | Provider | Model | Fallback | Data policy |
|---|---|---|---|---|
| Implémentation des scripts et vérification du gate | Anthropic | sonnet | — | code public |
| Technique SemIf mesurée par les scripts (hors session Claude) | Ollama local | qwen2.5:3b (`/api/generate`) | dégradation propre si modèle/serveur absent | local uniquement, `127.0.0.1` |
| Piste embeddings mesurée par les scripts (hors session Claude) | Ollama local | nomic-embed-text (`/api/embed`) | dégradation propre si modèle/serveur absent | local uniquement, `127.0.0.1` |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | brief de dispatch reçu, protocole §10 lu et suivi (mode non étiqueté aujourd'hui) | recorded |
| Implementation complete | 5 scripts + 2 README écrits, `export-dataset.mjs` puis `run-all.mjs` exécutés réellement | pending |
| Validation complete | `npm run lint` (vscode-extension) vert ou dossier hors périmètre confirmé ; `grimoire standard gate check --task-id GAO-spike-valuat-001 --strict` vert | pending |
| Deviations documented | `evidence-pack.md` de cette tâche (inbox vide constatée, écarts au protocole) | pending |
