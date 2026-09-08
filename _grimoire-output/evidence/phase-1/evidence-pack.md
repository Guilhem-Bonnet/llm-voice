# Agentic Evidence Pack

## Summary

- Task id: phase-1
- Profile: starter
- Outcome: Repo public `Guilhem-Bonnet/llm-voice` créé (MIT), gouvernance complète, CI matrice 3 OS verte (7/7 jobs), branch protection active, squelette extension VS Code et plugin Claude Code, trois études (local, Linux, UI) livrées et transformées en décisions D10-D12.
- Final state: done

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| Repo GitHub | https://github.com/Guilhem-Bonnet/llm-voice | pipeline-architect (Sonnet) | créé, public |
| Commit racine | `99c640e` ; HEAD main `17fbf8e` (après PR #10, #13) | Flow | — |
| Revue indépendante avant exécution | `_grimoire-output/team-build/test-reports/phase-1-sentinel-review.md` | agent-optimizer (Sonnet, contexte neuf) | GO avec corrections ; 2 bloquantes + 4 recommandées, toutes appliquées |
| CI run 34257377465 | GitHub Actions | Flow | lint, audit, unit, integration ×3 OS, package : 7/7 PASS |
| Branch protection | `gh api .../branches/main/protection` | Flow | strict, 7 contexts, 1 review, force-push interdit |
| gitleaks | `gitleaks detect --no-git -s . --redact --config .gitleaks.toml` | Flow + Sentinel | 0 leak |
| npm audit prod | `npm audit --omit=dev` | Sentinel | 0 vulnérabilité ; step `audit` bloquant en CI (AC-SEC-10) |
| Tests locaux | `npm run lint/typecheck/test:unit/test:integration` sous xvfb | Flow | PASS (7 unit, 2 intégration) |
| Étude garantie locale | `planning-artifacts/local-guarantee-v1.md` | general-purpose (Sonnet, web) | 18 points de sortie, 3 réels par défaut |
| Étude Linux first | `planning-artifacts/linux-first-v1.md` | idem | ROCm 7.2 gfx1201 natif ; Piper recommandé |
| Étude UI compacte | `planning-artifacts/ui-compact-v1.md` | idem | mini-player Panel, layout minimal/full |
| Décisions D10-D12 | `planning-artifacts/decisions-cadrage-v1.md`, decisions-log | concierge | consignées |

## Validation

| Check | Command or method | Result | Notes |
|---|---|---|---|
| Local = origin | `git status -sb` → `## main...origin/main` | synchronisé | — |
| CI verte sur HEAD | run 34257377465 | 7/7 PASS | 2 itérations de fix (coverage-v8 manquant ; test-electron 2.4.1 → 3.1.0 pour macOS) |
| Dependabot actif | `gh pr list` | 10 PR ouvertes le jour même | triage à planifier (Haiku/Flow) |
| Gate Grimoire | `grimoire standard gate check --task-id phase-1 --strict` | voir sortie | — |

## Controls

| Control family | Applied? | Evidence | Gap |
|---|---|---|---|
| Governance | yes | validation utilisateur explicite, revue Sentinel avant push, PR + squash pour les fixes | merges `--admin` utilisés en bootstrap (documenté) |
| Quality | yes | lint, typecheck, unit, intégration 3 OS, package | couverture non encore mesurée sur du vrai code |
| Runtime | no | — | aucun service déployé |
| Knowledge | yes | études sourcées, points « non vérifié » explicités | — |
| Model/provider | yes | Sonnet pour exécution et revue, Fable orchestration seulement | — |

## Deviations and accepted risks

| Deviation | Impact | Accepted by | Review trigger |
|---|---|---|---|
| Merges `gh pr merge --admin` pendant le bootstrap (pas de second humain) | faible | concierge, autorisé dans le brief | fin de bootstrap : plus d'`--admin` à partir de la phase 2 |
| 10 PR Dependabot ouvertes (majors : vitest 5, eslint 10, actions v7) | bruit, risque de casse CI si mergées à l'aveugle | concierge | triage Flow (Haiku) en début de phase 2 |
| 2 runs « Dependabot Updates » en échec sur le commit racine, non investigués | faible (les PR ont été créées ensuite) | Flow | même triage |
| `_grimoire/` et `_grimoire-output/evidence|planning-artifacts` publics | transparence voulue ; aucun secret (gitleaks 0) | concierge | si l'utilisateur préfère privé : `.gitignore` + purge |
| Repo créé depuis le dossier TTS-Voice (nom local ≠ nom du repo) | aucun | concierge | — |

## Completion statement

Phase 1 complète : livrables présents, CI verte, protection active, revue indépendante appliquée, écarts documentés avec déclencheur de revue.
