# Phase 6 — Sentinel review + Flow merge

## PR #37 (sécurité) — MERGED
- SHA merge: 7be324c94aa37623aa056d68a517e54427a8b08b
- Mutation-tests: F-01 (gap trouvé + corrigé), F-02 (OK), F-04 (OK)
- check-vsix/check-licenses ajoutés au job `package` de la CI (n'étaient pas appelés)
- npm audit --omit=dev = 0 confirmé
- CI 9/9 verts, commit correctif e1da1af poussé avant merge
- Review postée en commentaire (pas review formelle: auto-approve bloqué par GitHub, même compte)

## PR #38 (performance) — MERGED
- SHA merge: 6c6ffea1468c2a46faf75d186a6d4055f111eedd
- Merge de main dans la branche: conflit résolu sur package.json (commandes, style expanded + performanceReport réintégré), Pipeline.ts auto-mergé
- (a) firstChunkSentences=1 : aucun effet en mode block (code path court-circuité), highlight correct (sourceRange recalculé sur le groupe réel)
- (b) bench-tts.mjs vs Chatterbox réel: TTFA 1 phrase 5072ms (doc 4542ms), même ordre de grandeur, RTF≈1
- (c) warmup: aucune requête si EgressGuard refuse (assertAllowed avant dial), aucune lecture audible (audio jamais envoyé au sink), désactivable
- (d) getMeta: lecture pure, ne touche pas pin/éviction
- CI: 1 échec initial (integration windows, ENOENT rename ProfileRepository — fichier non touché par PR38, flake connu), retry 1/2 -> vert. 9/9.

## PR #36 (docs/traçabilité) — MERGED
- SHA merge: d987829f1c63c223b841cf0a71e86d92cb0a69f8
- Merge de main sans conflit
- Matrice corrigée: AC-SEC-10 (job audit ~ligne 35), AC-SEC-02 (webview-injection/webview-csp), AC-SEC-09 (supply-chain-and-permissions), AC-11 (integration-real, gated pas manuel) -> 27/27 Couvert
- check-traceability.mjs: bug critique corrigé (chemin absolu hardcodé /mnt/Travail/... + regex perdait le préfixe vscode-extension/), câblé dans job lint CI
- CHANGELOG: ajout corrections sécurité #37 (sans détail exploitable) + gain latence #38
- README: chiffres latence à jour, mention VSIX vérifié
- CI: 9/9 verts

## Dependabot
- PR #29 (vitest/@vitest/mocker/@vitest/coverage-v8) et #5 (eslint 9->10) sont toutes deux étiquetées `deps-major` par Dependabot (bumps majeurs réels : vitest 2.1.9->5.0.0, eslint 9.39.5->10.10.0) -> non fusionnées, conforme à la consigne (majeures restent deps-major).
- PR #9,#8,#7,#6,#3,#2 : également deps-major (actions/checkout 4->7, codeql-action 3->4, setup-node 4->7, upload-artifact 4->7, @types/node 22->26, vitest 2->5) -> laissées.
- Aucune PR dependabot patch/minor trouvée à merger.

## Validation finale sur origin/main (après les 3 merges)
- HEAD: d987829f1c63c223b841cf0a71e86d92cb0a69f8 (docs #36) <- 6c6ffea (perf #38) <- 7be324c (sécurité #37)
- npm ci: OK (640 packages, 10 vuln dev uniquement)
- npm run lint: OK (0 issue)
- npm run typecheck: OK
- npm run test:unit -- --coverage: 751/751 tests, 63/63 fichiers
- xvfb-run -a npm run test:integration (5 profils): 37 passing / 0 failing (26+1+2+1+7), exit 0 partout
- npm run package: OK, VSIX 14 fichiers, 258.95 KB
- node scripts/check-traceability.mjs: OK, 27 Couvert / 0 Partiel / 0 Non couvert, 33 fichiers de test tous résolus
- LLM_VOICE_E2E=1 LLM_VOICE_E2E_OLLAMA=1 LLM_VOICE_E2E_OLLAMA_MODEL=qwen2.5:1.5b npm run test:integration-real: 6/6 tests (3 fichiers) vs Chatterbox :8004 + Ollama :11434 réels
  - warmup: ok=true, totalMs=14525ms
  - TTFA premier passage (après warmup): 3873ms (< 8s, cohérent avec docs/performance.md ~4-5s)
  - second passage (cache disque): 1ms, aucune requête TTS réémise
- Pas de tag/release créé (étape suivante, hors périmètre).
