# Agentic Evidence Pack

## Summary

- Task id: GAO-refonte-ux-0-003
- Profile: controlled
- Outcome: Refonte UX 03 · Catalogue de voix Kyutai : 24 voix, licence vérifiée voix par voix, statut et échantillon — critères : AC-001 test: chaque voix du catalogue porte une licence vérifiée et sa source, aucune voix NC; AC-002 test: npm --prefix vscode-extension run test:unit vert; AC-003 gate: grimoire standard gate check --strict vert
- Final state: in_progress (2026-11-06)

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| Point de départ git | HEAD de4d8b5 | git rev-parse --short HEAD | référence (2026-11-06) |

## Validation

| Check | Command or method | Result | Notes |
|---|---|---|---|
| Tests | `npm --prefix vscode-extension run test:unit` | non exécuté | grimoire standard gate run-tests --task-id GAO-refonte-ux-0-003 écrit _grimoire-output/evidence/GAO-refonte-ux-0-003/test-run.json |

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

## Vérification des licences (2026-11-05, agent en lecture seule, à recouper avant publication)

Sources : pocket_tts/utils/utils.py 4.0.1 (cache uv local, _ORIGINS_OF_PREDEFINED_VOICES) et https://huggingface.co/kyutai/tts-voices (résumé WebFetch, pas de texte verbatim).

- Autorisées, CC BY 4.0 (attribution) : VCTK anna, vera, fantine, charles, paul, eponine, azelma, george, mary, jane, michael, eve ; alba-mackenna alba.
- Autorisées, CC0 : voice-donations marius, javert ; voice-zero bill_boerst, peter_yearsley, stuart_bell, caro_davy.
- Autorisée avec réserve : estelle (unmute-prod-website, CC0 par absence d'exception, non citée individuellement).
- À retirer, CC BY-NC 4.0 : cosette, jean.
- Non vérifiées, à exclure : giovanni, lola, juergen, rafael, daan (fichiers de kyutai/pocket-tts sans licence lue).
- Modèle : CC BY 4.0 (métadonnées kyutai/pocket-tts) ; code MIT ; clause « Prohibited use » sur le clonage sans consentement.
- À éclaircir : accès gated annoncé sur kyutai/pocket-tts, licence du dépôt kyutai/pocket-tts-without-voice-cloning.
- Prérequis lus : Python >=3.10,<3.15 ; PyTorch >=2.5 ; sous Linux environ 3 Go avec CUDA, environ 200 Mo avec l'index CPU.

## Relecture directe et implémentation (2026-11-05)

- Texte exact lu avec `curl` : `huggingface.co/kyutai/tts-voices/raw/main/README.md` (VCTK et Alba CC BY 4.0, dons et Voice Zero CC0, Unmute « our own recordings and you may use them as CC0 », Expresso et EARS non commerciaux).
- API Hugging Face : `kyutai/pocket-tts` gated « auto », `kyutai/pocket-tts-without-voice-cloning` non gated, cc-by-4.0, liste des voix avec leurs fichiers.
- `src/tts/kyutaiVoiceCatalog.ts` : 20 voix, source et licence pour chacune. `test/unit/tts/kyutaiVoiceCatalog.test.ts`. `npm run test:unit` : 113 fichiers, 2001 tests verts.
- Échantillons : `scripts/encode-voice-samples.sh`, `media/voices/*.ogg`, 384 Ko au total, `media/voices/CREDITS.md`.
- Non prouvé : lecture des .ogg dans la webview VS Code (carte galerie) ; texte juridique non validé par un juriste.
