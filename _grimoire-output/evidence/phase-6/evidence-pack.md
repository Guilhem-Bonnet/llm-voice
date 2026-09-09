# Agentic Evidence Pack

## Summary

- Task id: phase-6
- Profile: starter
- Outcome: Hardening et préparation de la release 0.1 : audit sécurité final (14 findings, tous corrigés, tests d'attaque), optimisation de latence (premier son de 33 s à ~4 s), documentation complète, matrice de traçabilité 27/27, politique de confidentialité, CHANGELOG 0.1.0, README refondu.
- Final state: done

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| PR #37 audit sécurité | merge `7be324c` | general-purpose (**Opus**, Vault) | 14 findings (1 critique, 3 élevés, 5 moyens, 5 faibles), tous corrigés avec test d'attaque |
| PR #38 performance | merge `6c6ffea` | reliability-engineer (Sonnet) | TTFA 33 s → 4,5 s ; cache 2 ms au second passage |
| PR #36 docs et traçabilité | merge `d987829` | project-navigator (Haiku) | matrice corrigée en revue : 27/27 couverts |
| Revue | `_grimoire-output/team-build/test-reports/phase-6-sentinel-review.md` | Sentinel (Sonnet) | mutation-tests sur F-01/F-02/F-04 |
| Leçons | `_grimoire/_memory/failure-museum.md` (3 entrées 2026-09-09) | Vault | référence de secret, rebinding DNS, exclusion VSIX |

## Validation

| Check | Command or method | Result |
|---|---|---|
| Unit | `npm run test:unit -- --coverage` | 751/751 |
| Intégration xvfb | `npm run test:integration` | 37/37 sur 5 profils |
| E2E réel | Chatterbox + Ollama | 6/6, TTFA 3873 ms |
| Packaging | `npm run package` + `check:vsix` + `check:licenses` | VSIX 14 fichiers, 259 Ko, 74 dépendances prod toutes MIT |
| Traçabilité | `node scripts/check-traceability.mjs` (câblé en CI) | 27/27 couverts |
| npm audit prod | `npm audit --omit=dev` | 0 |
| Gate | `grimoire standard gate check --task-id phase-6 --strict` | voir sortie |

## Trouvailles notables de la revue

- La faille critique (référence de secret contrôlée par un profil importé) n'était couverte par aucun test malgré sa correction : test ajouté sur la fonction de résolution.
- `check-vsix` et `check-licenses` existaient mais n'étaient jamais appelés en CI : câblés dans le job `package`.
- `check-traceability.mjs` ne fonctionnait que sur la machine de son auteur (chemin en dur) : corrigé et câblé dans le job `lint`.

## Deviations and accepted risks

| Deviation | Impact | Accepted by | Review trigger |
|---|---|---|---|
| 10 vulnérabilités npm de développement (2 critiques, 2 hautes) | hors VSIX, `npm audit --omit=dev` = 0 | concierge | mise à jour majeure de l'outillage de test (PR Dependabot `deps-major`) |
| Pas d'ACL Windows sur l'inbox (permissions POSIX seulement) | Windows non validé à la main | concierge | avant la 1.0 |
| Prompt injection du narrateur non traitée | contenu lu, pas exécuté | concierge | si un narrateur gagne des outils |
| Consentement voice cloning déclaratif | conforme au CdC §55 | concierge | — |
| DoD 1.0 : Windows et macOS non validés manuellement | la 0.1 est annoncée « Linux validé » | concierge | avant la 1.0 |
| 8 PR Dependabot majeures ouvertes | dette d'outillage | concierge | après la 0.1 |

## Completion statement

Phase 6 complète : audit, performance et documentation mergés, CI verte, prêt pour le tag v0.1.0.
