# Performance — latence de lecture (S6.2, CdC §63)

Mesures réelles, RX 9070 (ROCm 7.2.3, `deploy/docker-compose.tts.yml`),
Chatterbox `chatterbox-multilingual` clone (référence SIWIS FR),
`node scripts/bench-tts.mjs` le 2026-09-09, GPU déjà chaud :

| Taille de chunk | Caractères | TTFA moyen | Audio | RTF |
|---|---|---|---|---|
| 1 phrase | 58 | 4 542 ms | 4 040 ms | 1.12 |
| 2 phrases | 155 | 8 762 ms | 9 040 ms | 0.97 |
| 3 phrases | 213 | 16 420 ms | 15 240 ms | 1.08 |
| paragraphe (6 phrases) | 447 | 33 120 ms | 31 800 ms | 1.04 |

Cold start (GPU froid, compilation ROCm/hipBLASLt, `docs/e2e/report-2026-09-08.md`) :
**≈ 38 s** sur le tout premier appel du process. **RTF ≈ 1** : la taille du
*premier* chunk borne directement le TTFA — 1 phrase répond en ~4.5 s là où
le paragraphe entier met ~33 s pour le même contenu additionnel.

## Réglages qui comptent

- **`llmVoice.audio.firstChunkSentences` (défaut `1`)** : seul le premier
  chunk est raccourci à N phrases (`Segmenter.ts`, `groupSentences`) ; les
  suivants gardent `chunking.maxSentences` du profil (3 par défaut).
- **`llmVoice.audio.prefetchChunks` (défaut `2`, inchangé)** : règle
  (`AudioQueue.recommendedPrefetchChunks(rtf)`, §32/§65) = `ceil(rtf)+1` ; à
  `rtf≈1`, 2 suffit. Au-delà de `rtf=1` plus de prefetch retarde le premier
  trou sans l'éliminer — changer de provider, pas monter ce réglage.
- **`llmVoice.tts.warmup` (défaut `true`)** : `health()` + synthèse de 3 mots
  jetable (`src/tts/warmup.ts`), en tâche de fond, jamais attendue.
- **Keep-alive HTTP** : vérifié empiriquement — `fetch` (Node 22/undici)
  réutilise déjà le pool par hôte (4 requêtes → 2 sockets). Rien à configurer
  côté `EgressGuard.fetch` ; aucune dépendance ajoutée (ADR-005).
- **Cache disque (ADR-004)** : un second passage ne réémet aucune requête TTS
  (`test/integration-real/latency.test.ts`, gated). Gap corrigé ici : un
  cache *hit* ne restaurait pas `durationMs`/`format` (`AudioCacheStore
  .getMeta`, `AudioQueue.run()`).

## Instrumentation

Niveau `debug` uniquement, jamais de `spokenText`/audio (CdC §81) : TTFA
(`Pipeline.recordTtfaOnce`), durée de synthèse et cache hit/miss par chunk
(`AudioQueue.onChunkTiming`), taille de file. Commande **`LLM Voice: Show
Performance Report`** (Quick Pick) affiche les compteurs de la session
courante.

## Conseils

- **GPU vs CPU** : RTF ≈ 1 sur GPU ici ; sur CPU, attendu largement > 1 (non
  mesuré) — un RTF > 1 soutenu n'est pas réparable côté extension.
- **Piper pour la latence** : moteur bien plus rapide (RTF très < 1 même sur
  CPU), voix moins naturelle — bon défaut sans GPU.
- **Non améliorable côté extension** : calcul du provider (GPU/CPU, modèle),
  latence réseau distante, cold start d'un serveur qui démarre —
  `readyTimeoutMs`/`warmup` absorbent ce coût, ne le suppriment pas.

## Reproduire

```bash
docker compose -f deploy/docker-compose.tts.yml up -d chatterbox
node scripts/bench-tts.mjs --out /tmp/bench.json
```
