# Agentic Evidence Pack

## Summary

- Task id: GAO-essais-voix-001
- Profile: controlled
- Outcome: Essais voix : textes d'essai et banc d'écoute pour le ton, les personnages et les mots techniques — critères : AC-001 test: python3 -m unittest discover scripts/voice-lab vert; AC-002 test: scripts/voice-lab/run.sh code de sortie 0 sur le serveur Pocket local, mesures dans evidence-pack; AC-003 revue: notes d'écoute de guilhem-bonnet consignées dans acceptance-record; AC-004 gate: grimoire standard gate check --strict vert
- Final state: in_progress (2026-11-06)

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| Point de départ git | HEAD 033a91f | git rev-parse --short HEAD | référence (2026-11-06) |

## Validation

| Check | Command or method | Result | Notes |
|---|---|---|---|
| Tests | `npm --prefix vscode-extension run test:unit` | non exécuté | grimoire standard gate run-tests --task-id GAO-essais-voix-001 écrit _grimoire-output/evidence/GAO-essais-voix-001/test-run.json |

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

## Banc réel (2026-11-06)

- `python3 -m unittest discover -s scripts/voice-lab` : 12 tests OK.
- `scripts/voice-lab/run.sh` : 119 extraits en 871 s, serveur Pocket local. Deux erreurs à ce passage, la température, car `serve` n'a pas cette option ; corrigé en passant par `generate`, `--only-temperature` rejoué avec code 0 : 121 extraits, `errors: []` dans `ecoute/results.json`. Le passage complet n'a pas été rejoué après cette correction.
- Ton (estelle, 8 styles) : écart de 2,56 s, 3 pauses, 14 Hz de hauteur. Température 0,4 contre 1,0 : 0,6 s, hauteur identique.
- Scène à 4 voix : 43,5 s d'audio générés en 13,1 s.
- Mots techniques : erreurs de transcription 53 % tels quels, 45 % en phonétique, indicatif car la transcription juge mal ces mots. Chiffres : 59,5 %.
- Limites : hauteur sujette aux erreurs d'octave, écoute de guilhem-bonnet non encore faite.
