# Agentic Evidence Pack

## Summary

- Task id: phase-3
- Profile: starter
- Outcome: Slice vertical du MVP mergé sur main : EgressGuard (ADR-010), parser/segmenteur (ADR-006), PlaybackController + AudioQueue + cache (ADR-001/004/005), surface VS Code (mini-player Panel, highlight, status bar, CodeLens, commandes, ADR-011), intégration (sources, profils, provider TTS compatible OpenAI derrière EgressGuard, cache disque, bundle esbuild). AC-01..06 verts en intégration, invariant zéro autoplay testé, VSIX installé et activé sans crash.
- Final state: done

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| PR #20 EgressGuard + verifyLocalMode | merge `388df44` | general-purpose (Sonnet, Vault) | GO ; mode open testé ; type dupliqué supprimé |
| PR #23 parser/splitter/segmenter/normalizer | merge `6ce7d69` | backend-engineer (Sonnet) | GO ; couverture parser 93 % ; splitter maison (sentence-splitter coupait après « M. ») |
| PR #22 PlaybackController/AudioQueue/cache/SessionFactory | merge `62dc649` | general-purpose (**Opus**) | GO ; 84 tests, couverture 97 % |
| PR #21 surface VS Code | merge `3ca252d` | backend-engineer (Sonnet) | GO après alignement ADR-011 (status bar droite, inbox dans le menu) ; CodeQL js/xss résolu par `new URL()` après circuit breaker à 3 tentatives |
| PR #24 intégration S3.5 | merge `829fc1b` | backend-engineer (Sonnet) | GO ; 4 fix(review) dont réglage orphelin `tts.baseUrl` et bug macOS CI (socket IPC > 103 caractères) |
| Story | `_grimoire-output/team-build/stories/S3.5-integration-slice-vertical.md` | concierge | — |
| Revues | `_grimoire-output/team-build/test-reports/phase-3a-sentinel-review.md`, `phase-3b-sentinel-review.md` | Sentinel (Sonnet) | — |
| Bug trouvé en vérification | cache disque LRU partagé entre profils de test (`--user-data-dir`) | S3.5 | corrigé avant PR |

## Validation

| Check | Command or method | Result | Notes |
|---|---|---|---|
| Unit | `npm run test:unit -- --coverage` sur main 829fc1b | 281/281, couverture 93,5 % sur modules purs, seuil 80 % bloquant en CI | modules dépendant de `vscode` couverts en intégration |
| Intégration | `xvfb-run -a npm run test:integration` | 14/14 | AC-01..06 dans `test/integration/pipeline.test.ts` ; TTS indisponible sans crash dans `integration-real/tts-unavailable.test.ts` |
| Invariant zéro autoplay | `test/unit/invariants/no-autoplay.test.ts` | passe ; échec confirmé avec un import interdit temporaire | — |
| Aucun fetch nu hors src/net | `grep -rn "fetch(" src \| grep -v src/net` | 0 | AC-SEC-01 |
| Packaging | `npm run package` ; `code --install-extension` sous Xvfb | VSIX 222 Ko, activation sans erreur dans exthost.log | — |
| CI main | CI + CodeQL | verts | — |
| Gate Grimoire | `grimoire standard gate check --task-id phase-3 --strict` | voir sortie | — |

## Controls

| Control family | Applied? | Evidence | Gap |
|---|---|---|---|
| Governance | yes | 5 PR, revue Sentinel en commentaire, arbitrages orchestrateur consignés | — |
| Quality | yes | 281 unit + 14 intégration, seuil de couverture bloquant | AC-07..17 restent pour les phases 4-6 |
| Runtime | no | — | pas de serveur TTS réel encore (phase 4) |
| Knowledge | yes | ADR mis à jour (« Reporté phase 4 » dans ADR-004/005) | — |
| Model/provider | yes | Opus uniquement sur S3.3 ; Sonnet ailleurs | — |

## Deviations and accepted risks

| Deviation | Impact | Accepted by | Review trigger |
|---|---|---|---|
| Retry sans backoff, pas d'état buffering, pas de pinning anti-éviction, sidecar cache sans métadonnées | visibles seulement avec un provider réel lent | concierge | phase 4 (providers réels) |
| Contrôle n°9 de Verify Local Mode « non vérifiable » (pas de scanner statique) | badge affiche « non vérifiable » plutôt qu'un faux vert | concierge | phase 6 |
| Couverture globale 60 % ; seuil 80 % mesuré sur modules purs uniquement | modules VS Code testés seulement en intégration | concierge | garder ; ajouter des tests d'intégration en phases 5-6 |
| Bouton Retry vérifié par lecture de code, pas par assertion UI headless | faible | Sentinel | E2E manuel phase 6 |
| Le player webview ne joue pas d'audio sous xvfb : FakeAudioSink en test | l'audio réel n'a pas encore été entendu | concierge | E2E réel phase 4 sur la machine RDNA4 |
| 3 tentatives sur CodeQL avant circuit breaker (boucle stérile détectée par l'orchestrateur) | ~40 min | concierge | règle : `new URL()` d'emblée pour toute assignation d'URL dans un webview |

## Completion statement

Phase 3 complète : slice vertical mergé, AC-01..06 prouvés en intégration, invariant P0 testé, écarts documentés avec déclencheur.
