# Agentic Evidence Pack

## Summary

- Task id: phase-2
- Profile: starter
- Outcome: Architecture du MVP livrée et mergée : ADR-001..011 (`docs/adr/`), contrats TypeScript du cœur (`vscode-extension/src/core/`), schéma Zod des profils, outillage de test complet (fakes TTS/narrator, générateur WAV, fixtures Claude, mocks HTTP), Dependabot trié. 45 tests unitaires verts sur main, CI 9/9.
- Final state: done

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| PR #18 ADR-001..005 + src/core + zod | merge `2c1f19e` | general-purpose (Opus, Archie) | GO Sentinel, 9/9 CI |
| PR #16 ADR-006..011 + index | merge `2f0cf3b` | general-purpose (Sonnet) | GO Sentinel, 9/9 CI |
| PR #17 fakes/fixtures/mocks | merge `de77bb0` | creative-toolsmith (Sonnet) | GO Sentinel après alignement sur src/core, 45/45 tests |
| PR #15 docs phase 1 | mergée | concierge | 9/9 CI |
| Dependabot | #14 mergée ; #2 #3 #5 #6 #7 #8 #9 #11 étiquetées `deps-major` ; #12 en conflit (rebase auto) | pipeline-architect (Haiku) | trié |
| Revue indépendante | `_grimoire-output/team-build/test-reports/phase-2-sentinel-review.md` | general-purpose (Sonnet, Sentinel) | 3 GO avec corrections mineures appliquées |
| Bug de contrat trouvé en revue | FakeNarratorProvider rejetait au lieu de résoudre `degraded:true` (ADR-005) | Sentinel | corrigé avant merge |

## Validation

| Check | Command or method | Result | Notes |
|---|---|---|---|
| CI main | run 34262924118 | verte | lint, audit, unit, integration ×3, package, CodeQL |
| Tests unitaires | `npm run test:unit` sur main | 45/45 | — |
| Types sans dépendance vscode | revue Sentinel | 0 import `vscode` dans src/core | testable hors Extension Host |
| Gate Grimoire | `grimoire standard gate check --task-id phase-2 --strict` | voir sortie | — |

## Controls

| Control family | Applied? | Evidence | Gap |
|---|---|---|---|
| Governance | yes | 1 PR par agent, revue Sentinel consignée en commentaire, merges `--admin` selon la règle solo | — |
| Quality | yes | 45 tests, CI 3 OS | couverture non encore mesurée comme seuil |
| Runtime | no | — | n/a |
| Knowledge | yes | ADR citent D1-D12 et le CdC | — |
| Model/provider | yes | Opus limité à ADR-001..005 ; Sonnet et Haiku ailleurs | — |

## Deviations and accepted risks

| Deviation | Impact | Accepted by | Review trigger |
|---|---|---|---|
| Le hook PreToolUse Grimoire bloque `git push --force*` : rebases remplacés par des merges non destructifs | historique avec commits de merge sur les branches, résultat identique | concierge | garder cette pratique (elle respecte le profil de risque) |
| `zod` en dépendance de production, mais actuellement exclu du VSIX par `--no-dependencies` + `.vscodeignore` | latent jusqu'au câblage réel de `profile.schema.ts` en phase 3 | concierge | phase 3 : décider bundling esbuild de zod |
| `isRemoteProfile()` est lexical ; la garde réelle est `EgressGuard` (phase 3) | badge 🔒 non fiable tant qu'EgressGuard n'existe pas | concierge | phase 3, story EgressGuard en premier |
| 8 PR Dependabot majeures en attente | dette de mise à jour | concierge | phase 3, après EgressGuard |
| Worktrees créés à la main (le harness ne détectait pas le repo git) | aucun | concierge | — |

## Completion statement

Phase 2 complète : tout est mergé sur main avec CI verte et revue indépendante ; écarts documentés avec déclencheur.
