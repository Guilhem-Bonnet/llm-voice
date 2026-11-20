# Agentic Evidence Pack

## Summary

- Task id: GAO-veille-moteu-001
- Profile: controlled
- Outcome: Veille — moteurs TTS expressifs à consignes en français (local) et voix de référence françaises libres de droits — critères : AC-001 gate : rapport sourcé dans _grimoire-output/research/reports avec shortlist testable; AC-002 gate : grimoire standard gate check --strict vert
- Final state: in_progress (2026-09-29)

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| Point de départ git | HEAD bf2355c | git rev-parse --short HEAD | référence (2026-09-29) |

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->

## Validation

| Check | Command or method | Result | Notes |
|---|---|---|---|
| Tests | `npm --prefix vscode-extension run test:unit` | non exécuté | grimoire standard gate run-tests --task-id GAO-veille-moteu-001 écrit _grimoire-output/evidence/GAO-veille-moteu-001/test-run.json |

## Controls

| Control family | Applied? | Evidence | Gap |
|---|---:|---|---|
| Governance | no |  |  |
| Quality | no |  |  |
| Runtime | no |  |  |
| Knowledge | no |  |  |
| Model/provider | no |  |  |

## Deviations and accepted risks

| Deviation | Impact | Accepted by | Review trigger |
|---|---|---|---|
|  |  |  |  |

## Completion statement

The task can be considered complete only when mandatory evidence gates for the selected profile are satisfied or explicitly marked non-applicable with justification.

## Livrables (2026-09-29)

| Preuve | Emplacement | Résultat |
|---|---|---|
| Note moteurs expressifs (URL par affirmation) | `_grimoire-output/research/research_notes/Direction de lecture expressive/moteurs-expressifs.md` | 1 274 mots, shortlist + protocole d'une journée |
| Note voix de référence | `…/voix-de-reference.md` | 782 mots, méthode 10–15 voix consenties |
| Rapport de synthèse | `_grimoire-output/research/reports/Moteurs expressifs et voix de référence.md` | shortlist Qwen3-TTS / Fish S2 Pro / Kyutai Pocket TTS, témoin Chatterbox |

Réserves : qualités françaises et support ROCm annoncés par les éditeurs, non mesurés ; droit à la voix français non vérifié.
