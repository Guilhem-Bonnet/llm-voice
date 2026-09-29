# Agentic Task Envelope

## Task

- Task id: GAO-adr-015-4-co-001
- Request: ADR-015 étape 4 — contrôleur de partition (rôle 5, code pur). `PartitionController` sans `vscode` ni réseau : prend source + sortie brute du metteur en scène + état de bible ; rend un verdict (schéma valide, couverture des blocs source, fidélité du texte sonore, cohérence avec la bible) et la liste des segments à renvoyer avec un motif ; politique de renvois (au-delà de N, repli sur la partition neutre, jamais de blocage). Tests 7 (fidélité, échantillon des textes piégés copiés en fixtures) et 10 (renvois et repli), plus tests de propriété.
- Owner agent: backend-engineer (Stack), modèle sonnet
- Profile: controlled
- Current state: `running`
- Risk level: `low` (module pur, aucun I/O, aucun import `vscode`, non branché sur le pipeline)

## Périmètre d'écriture (deux autres agents travaillent en parallèle : étape 2 traducteur, étape 3 bible)

- Création seulement dans `vscode-extension/src/direction/controller/**` et `vscode-extension/test/unit/direction/controller/**`.
- `vscode-extension/src/core/direction.ts` : lecture seule (si un manque bloque, il est décrit, pas corrigé).
- Aucun commit. Pas de `reset-session`. Aucune commande qui appelle un LLM local ou le GPU (mode jeu actif : `test:unit`, `typecheck`, `lint` sont des commandes CPU).

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---:|
| Décision et tests | `docs/adr/ADR-015-reading-direction.md` §2 (rôle 5), §6 (texte sonore et fidélité), §7 (garde-fous), tests 7 et 10 | contrat normatif du contrôleur | accepté 2026-09-29 | ~12k |
| Contrat | `vscode-extension/src/core/direction.ts` | `RawDirectionOutputSchema`, `boundPartition`, `checkPartition`, `checkBible`, `neutralCue` à réutiliser | étape 1 (commit b560281) | ~7k |
| Logique de fidélité | `vscode-extension/scripts/narrator-eval/` (script de mesure) | nombres en lettres, négations ±8 mots, `novelNumbers` : à réimplémenter en TypeScript de production (pas d'import depuis `scripts/`) | branche courante | ~4k |
| Textes piégés | `scripts/narrator-eval/dataset/narrator-eval-v1.jsonl` (24 textes) | copiés en fixtures de test | branche courante | ~8k |
| Segments source | `src/core/source.ts`, `src/narrator/shared.ts` (`spokenText ?? rawText`) | forme du texte de référence | branche courante | ~1k |

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
| Read / Write / Edit | write | `vscode-extension/src/direction/controller/**`, `vscode-extension/test/unit/direction/controller/**`, `_grimoire-output/evidence/GAO-adr-015-4-co-001/` | jamais `src/core/direction.ts`, jamais `scripts/`, aucun commit |
| Bash | execute | `npm --prefix vscode-extension run test:unit / typecheck / lint`, `grimoire task|standard …` | pas de LLM local, pas de GPU |

## LLM routing

| Step | Provider | Model | Fallback | Data policy |
|---|---|---|---|---|
| Implémentation et tests | Anthropic | sonnet (backend-engineer) | — | code public, aucun contenu utilisateur |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | brief de dispatch du concierge ; ADR-015 accepté le 2026-09-29 | recorded |
| Implementation complete | module `src/direction/controller/` + tests | pending |
| Validation complete | `test:unit`, `typecheck`, `lint` verts ; `grimoire standard gate check --task-id GAO-adr-015-4-co-001 --strict` | pending |
| Deviations documented | `evidence-pack.md` (écarts avec l'ADR) | pending |
