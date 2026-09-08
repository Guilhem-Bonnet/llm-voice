# Agentic Evidence Pack

## Summary

- Task id: phase-4
- Profile: starter
- Outcome: Providers réels mergés : OllamaNarrator + OpenAICompatibleNarrator (structured output, réparation, mode dégradé, « lire sans narration » persistant), ChatterboxProvider sur le endpoint natif `/tts` avec clonage de voix (CdC §55), KokoroProvider, presets, registre, santé, backoff, état buffering, pinning et sidecar du cache ; ops Linux : compose ROCm 7.2.3 RDNA4 épinglé, profil Piper léger, guide d'installation, script E2E, rapport E2E réel. Chaîne locale complète Ollama + Chatterbox validée à l'oreille par l'utilisateur (AC-11), voix française par défaut choisie par l'utilisateur.
- Final state: done

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| PR #27 narrateurs | merge `c31ead3` | backend-engineer (Sonnet) | GO ; collision mocha/vitest sur integration-real corrigée ; test réel Ollama (qwen2.5:1.5b) 4,2 s |
| PR #28 providers TTS + résilience | merge `e58dad9` | backend-engineer (Sonnet) | GO après réécriture Chatterbox sur `/tts` (vérifié sur `/openapi.json` réel), clonage, preset SIWIS |
| PR #30 ops Linux + E2E | merge `3b9d6ba` | ops-engineer (Sonnet) | GO ; 0 chemin personnel, ports loopback, attribution CC BY 4.0 |
| Rapport E2E réel | `docs/e2e/report-2026-09-08.md`, `docs/voices.md` | Forge | GPU RX 9070 via ROCm 7.2.3 conteneurisé ; cold start ≈ 38 s ; clone ≈ 7-8 s pour 7 s d'audio |
| Écoutes utilisateur | conversation du 2026-09-08 | guilhem-bonnet | 5 candidats ; voix SIWIS + `exaggeration 0.4 / cfg_weight 0.5 / temperature 0.6` retenue |
| Revue | `_grimoire-output/team-build/test-reports/phase-4-sentinel-review.md` | Sentinel (Sonnet) | — |
| Dependabot #29 (vitest 2 → 5) | étiquetée deps-major | Sentinel | non mergée |

## Validation

| Check | Command or method | Result | Notes |
|---|---|---|---|
| Unit | `npm run test:unit -- --coverage` | 369/369, 92,8 % lignes sur modules purs | seuil 80 % bloquant |
| Intégration xvfb | `npm run test:integration` | 14/14 | — |
| E2E réel | `LLM_VOICE_E2E=1 LLM_VOICE_E2E_OLLAMA=1 npm run test:integration-real` | 5/5 contre Chatterbox :8004 et Ollama :11434 | AC-11 |
| Écoute humaine | phrase de référence CdC §50 rejouée | accent français correct avec référence SIWIS | AC-07 (voix par profil) validé à l'oreille, AC-08 (prompt personnalisé) via test réel Ollama |
| Packaging | `npm run package` | VSIX OK | — |
| Gate | `grimoire standard gate check --task-id phase-4 --strict` | voir sortie | — |

## Deviations and accepted risks

| Deviation | Impact | Accepted by | Review trigger |
|---|---|---|---|
| Latence Chatterbox ≈ 1 s de calcul par seconde d'audio (RTF ≈ 1) sur RX 9070 | premier son après ≈ 3-5 s par chunk, prefetch masque la suite | concierge | phase 6 : fp16, chunks plus courts, mesure `prefetchChunks` |
| `Dockerfile.rdna4` communautaire cassé (base dérivée vers ROCm 10) | épinglé 7.2.3 via `dockerfile_inline` | Forge | surveiller le dépôt communautaire |
| Voix prédéfinies du serveur toutes anglophones | mode `predefined` déconseillé pour le FR, clone par défaut | utilisateur | — |
| `/v1/audio/speech` ignore la langue | réservé au provider générique ; Chatterbox utilise `/tts` | Sentinel | — |
| AC-07/08 validés en E2E réel mais pas encore depuis l'UI VS Code avec Chatterbox réel | faible | concierge | phase 6 E2E manuel complet |
| Commande « Provider Status » (CdC §51) non câblée dans l'UI | backend `healthAll()` prêt | concierge | phase 5 |

## Completion statement

Phase 4 complète : providers réels mergés et prouvés contre les services locaux réels, voix validée par l'utilisateur, écarts documentés.
