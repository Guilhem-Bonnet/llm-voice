# Agentic Task Envelope

## Task

- Task id: GAO-adr-015-5-an-001
- Request: ADR-015 étape 5, **partie 5a seulement** — analyste, metteur en scène, anticipation, cache de partition et repli (panne, retard, mode jeu) derrière une interface `DirectionLlm`, testés avec un faux LLM. La partie 5b (client Ollama réel, prompts, mesures de latence, branchement `Pipeline.ts`) suit et ne fait pas partie de ce périmètre.
- Owner agent: backend-engineer (Stack) + skill `platform-reliability-sre`, modèle sonnet
- Profile: controlled
- Current state: `running` (non modifié par la partie 5a)
- Risk level: `low` (modules sans `vscode`, non branchés sur le pipeline de lecture, aucun appel réseau réel)

## Périmètre d'écriture

- Création seulement dans `vscode-extension/src/direction/director/**` et `vscode-extension/test/unit/direction/director/**`.
- `src/core/direction.ts`, `src/direction/{bible,controller,translator}/**`, `src/narrator/**`, `src/net/**` : lecture seule (importés, jamais modifiés).
- Aucun commit. Pas de `reset-session`.
- **Aucun LLM réel, aucun GPU** : tous les appels « LLM » passent par `FakeDirectionLlm`. Le mode jeu (`gpu-yield`) est simulé par un dossier temporaire en guise de `XDG_RUNTIME_DIR`. Les seules commandes lancées sont `test:unit`, `typecheck`, `lint` (CPU).

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---:|
| Décision | `docs/adr/ADR-015-reading-direction.md` §2 (rôles 1 et 3), §7 (garde-fous), §8 (latence, anticipation, cache, mode jeu), Tests 8, 10, 11, 12, 14 | contrat normatif | accepté 2026-09-29 | ~14k |
| Contrat | `vscode-extension/src/core/direction.ts` | `Cue`, `Partition`, `Bible`, `neutralCue`, schémas bruts | étape 1 | ~7k |
| Contrôleur | `src/direction/controller/PartitionController.ts` | `run(input, direct)`, `neutralPartitionForSource`, `SourceBlock` | étape 4 | ~6k |
| Bible | `src/direction/bible/{BibleStore,events,scopes}.ts` | `appendModelEvent`, `effective`, `DocumentScope` | étape 3 | ~8k |
| Client à imiter | `src/narrator/OllamaNarrator.ts`, `src/narrator/shared.ts`, `src/net/EgressGuard.ts` | EgressGuard, timeouts, classification des pannes | branche courante | ~5k |

## Knowledge base usage

| Knowledge source | Query or index | Trust level | Used as source of truth? | Notes |
|---|---|---|---|---|
| Fichiers du dépôt | lecture directe | high | yes | seules sources des faits cités |

## Memory usage

| Memory surface | Read/write | Purpose | Integrity check |
|---|---|---|---|
| `_grimoire/_memory/shared-context.md` | read | invariants P0 | — |

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| Read / Write / Edit | write | `vscode-extension/src/direction/director/**`, `vscode-extension/test/unit/direction/director/**`, `_grimoire-output/evidence/GAO-adr-015-5-an-001/` | jamais `src/core/`, jamais les autres modules de `src/direction/`, aucun commit |
| Bash | execute | `npm --prefix vscode-extension run test:unit / typecheck / lint`, `grimoire task context`, `grimoire standard decision trace` | pas de LLM réel, pas de GPU, pas de changement d'état de la carte |

## LLM routing

| Step | Provider | Model | Fallback | Data policy |
|---|---|---|---|---|
| Implémentation et tests | Anthropic | sonnet (backend-engineer) | — | code public, aucun contenu utilisateur |
| Tests de direction | `FakeDirectionLlm` (en processus) | — | — | aucune requête réseau |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | brief de dispatch du concierge ; ADR-015 accepté le 2026-09-29 | recorded |
| Implementation complete | modules `src/direction/director/` + tests | pending |
| Validation complete | `test:unit`, `typecheck`, `lint` verts (partie 5a) ; le gate strict est passé à la clôture de la carte (partie 5b) | pending |
| Deviations documented | `evidence-pack.md` (écarts avec l'ADR) | pending |
