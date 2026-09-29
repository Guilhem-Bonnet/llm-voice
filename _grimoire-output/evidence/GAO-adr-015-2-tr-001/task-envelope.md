# Agentic Task Envelope

## Task

- Task id: GAO-adr-015-2-tr-001
- Request: ADR-015 étape 2 (traducteur moteur) — `TtsCapabilities.direction`
  déclaré par chaque provider ; traducteur partition -> requêtes de synthèse +
  segments de silence (pauses exactes, identifiants conformes au contrat Core
  `^[A-Za-z0-9_-]+$`) ; Chatterbox : voix de référence par locuteur,
  `exaggeration` et `cfg_weight` bornés ; Piper : vitesse bornée ; moteur sans
  style : paramètres ignorés proprement ; tests 2, 3 et 15.
- Owner agent: backend-engineer (Stack), mode non-interactif
- Profile: controlled
- Current state: `running`
- Risk level: `low` (module pur sans `vscode`, déclarations de capacités
  additives, tests ; aucun appel réseau, aucun LLM local, aucun GPU)

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---|
| Traduction par capacités, table moteur, silences, garde-fous | `docs/adr/ADR-015-reading-direction.md` §5, §7, §8 (Accepté 2026-09-29) | source normative | 2026-09-29 | ~6k |
| Tests 2, 3, 15 | ADR-015 §« Tests qui prouvent la décision » | verdicts attendus | 2026-09-29 | ~1k |
| Contrat livré (Cue, Partition, bornes, cue neutre, `baselineTtsRequest`, `silenceSegmentId`) | `vscode-extension/src/core/direction.ts` (lecture seule) | entrée du traducteur | 2026-09-29 | ~8k |
| Capacités et paramètres des providers | `src/core/tts.ts`, `src/tts/ChatterboxProvider.ts`, `SystemTtsProvider.ts`, `KokoroProvider.ts`, `OpenAICompatibleTtsProvider.ts` | où déclarer `direction` | 2026-09-29 | ~6k |
| File de synthèse, clé de cache, navigation | `src/playback/AudioQueue.ts`, `AudioCache.ts`, `PlaybackController.ts` (lecture seule) | requête d'aujourd'hui, rattachement des silences (point ouvert 9) | 2026-09-29 | ~8k |

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| Write/Edit | write | `vscode-extension/src/direction/translator/**`, `vscode-extension/test/unit/direction/translator/**`, `src/core/tts.ts` (type `DirectionCapabilities`), `src/tts/*Provider.ts` (déclaration `direction`), `_grimoire-output/evidence/GAO-adr-015-2-tr-001/**` | jamais `src/core/direction.ts`, `src/playback/**`, `src/pipeline/**` (lecture seule) ; deux autres agents travaillent en parallèle (étape 3 bible, étape 4 contrôleur) |
| Bash | execute | `npm --prefix vscode-extension`, `grimoire` | pas de commit, pas de `git push`/`gh`, aucun LLM/GPU, jamais `policies reset-session` |

## LLM routing

| Step | Provider | Model | Fallback | Data policy |
|---|---|---|---|---|
| Rédaction traducteur + tests (backend-engineer) | Anthropic | sonnet | — | code local uniquement |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | brief non-interactif explicite (orchestrateur) | recorded |
| Implementation complete | `src/direction/translator/**`, capacités des providers, tests | en cours |
| Validation complete | `npm run test:unit`, `typecheck`, `lint` | en cours |
| Deviations documented | `evidence-pack.md` de cette tâche | en cours |
