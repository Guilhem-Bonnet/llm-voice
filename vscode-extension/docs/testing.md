# Tester LLM Voice sans GPU ni réseau

Référence : cahier-des-charges.md §78-79, master-plan-llm-voice-v1.md §5
(pyramide de tests). Toute la chaîne `source → parser → queue → player`
doit pouvoir s'exécuter en CI sans Chatterbox ni Ollama réels.

## Pyramide (résumé)

```
E2E réel (~5%, hors CI) → Chatterbox + Ollama sur machine dev
Intégration (~20%)      → @vscode/test-electron + mocks HTTP
Unit (~70%)              → vitest, FakeTts/FakeNarrator
Statique (~5%)            → tsc strict, eslint
```

## Fakes disponibles (`test/fakes/`)

- **`wav.ts`** — `makeSilentWav(durationMs, sampleRate?)` et
  `makeToneWav(durationMs, freqHz, sampleRate?)` génèrent un WAV PCM 16 bits
  mono en mémoire ; `readWavHeader`/`getWavDurationMs` pour vérifier la sortie.
- **`FakeTtsProvider.ts`** — implémente `TtsProvider` (durée = nb de mots ×
  `msPerWord`), respecte `AbortSignal`, journalise les requêtes (`.requests`),
  supporte `failEveryNth` et `latencyMs`. `synthesizeStream()` émet 3 frames.
- **`FakeNarratorProvider.ts`** — implémente `NarratorProvider`, mapping 1:1
  (`spokenText = "[narrated] " + rawText`) par défaut, `merge: true` pour du
  N:1, `invalidJsonOnce` pour simuler une sortie structurée invalide.
- **`mockTtsServer.ts` / `mockOllamaServer.ts`** — serveurs `node:http` sur
  `127.0.0.1` (port éphémère) qui imitent l'API TTS (`/v1/audio/speech`,
  `/v1/audio/voices`, `/health`) et l'API Ollama (`POST /api/chat` avec
  `format` JSON Schema). Options `fail500` et `redirectExternal` pour tester
  la gestion d'erreurs et le garde-fou `localOnly` (§80).
- **`contracts.ts`** — copie locale minimale de `TtsProvider`/`NarratorProvider`
  (CdC §20/§23), marquée `// TODO align with src/core once merged`.

## Fixtures (`test/fixtures/`)

- **`claude-stop/`** — 8 fixtures du hook `Stop` : normal, long (~20 Ko), code
  fences, vide, unicode/emoji, français accentué, générateur `×10 concurrents`
  (`generate-concurrent.ts`), JSON invalide (`invalid.json`).
- **`markdown/`** — `kubernetes-course.md` (cours ~200 lignes : headings, code,
  tables, listes, liens, images, frontmatter), `short.md`, `pathological.md`
  (abréviations « M. », « etc. », URL nue, code inline, phrases sans point).

## Utilisation type

```ts
import { FakeTtsProvider } from "../fakes/FakeTtsProvider.js";

const tts = new FakeTtsProvider({ msPerWord: 60, failEveryNth: 5 });
const result = await tts.synthesize({ text: "Bonjour le monde" });
// result.durationMs === 3 mots * 60ms, result.audioUri est un data: URI WAV
```

Le test de concurrence Claude (`test/unit/claude-capture.concurrency.test.ts`)
lance 10 exécutions parallèles du collector réel via `child_process` sur un
inbox temporaire, et vérifie 10 fichiers distincts, permissions 0600, aucun
`.tmp` restant — invariant P0 : jamais d'appel `Inbox → Player.play()` (§44).
