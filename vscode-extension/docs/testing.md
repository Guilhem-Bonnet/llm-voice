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

## Slice vertical câblé (S3.5) : `LLM_VOICE_TEST_FAKE_TTS`

Depuis S3.5, `src/pipeline/Pipeline.ts` est le vrai `PipelineFacade` (plus
`NotWiredPipeline`). Les tests d'intégration ne peuvent ni lancer Chatterbox,
ni décoder de l'audio dans la Webview sous `xvfb` : `extension.ts` remplace
donc les deux dépendances réseau/audio par des fakes, **uniquement** quand :

1. `context.extensionMode !== vscode.ExtensionMode.Production` (jamais dans un
   VSIX installé — un `profiles.json` ou un environnement trafiqué ne peuvent
   pas activer ce chemin sur une install réelle) ; **et**
2. la variable d'environnement `LLM_VOICE_TEST_FAKE_TTS=1` est présente au
   lancement du process Extension Host.

Quand c'est le cas, `activate()` charge dynamiquement
`out/test/fakes/FakeTtsProvider.js` et `out/test/fakes/FakeAudioSink.js` via
un `require()` dont le chemin est construit à l'exécution (jamais un littéral
qu'`esbuild` pourrait résoudre au bundling) : `dist/extension.js` n'embarque
donc jamais `test/fakes/**`, qui est de toute façon exclu du VSIX par
`.vscodeignore` (`test/**`, `out/**`). Les deux instances sont exposées par
`ExtensionTestApi` (`activate()`) sous `audioSink`/`ttsProvider`, pour que les
tests observent l'état de lecture (`FakeAudioSink.loads`/`.commands`,
`FakeTtsProvider.requests`) sans dépendre du rendu réel de la Webview.

### Profils `.vscode-test.mjs`

`.vscode-test.mjs` définit plusieurs configurations (`@vscode/test-cli`
supporte un tableau de configs, chacune lançant sa propre instance de
VS Code) :

| Profil | `LLM_VOICE_TEST_FAKE_TTS` | Fichiers | Ce qu'il prouve |
|---|---|---|---|
| `fake-tts` | `1` | `out/test/integration/**` | AC-01..06 : session, highlight, pause, stop, Speak Selection — via `FakeTtsProvider` + `FakeAudioSink`. |
| `tts-auto-fallback-succeeds` | non défini | `out/test/integration-real/tts-fallback-succeeds.test.js` | Chaîne `"auto"` (ADR-009) : Chatterbox et Piper local injoignables (`LLM_VOICE_TEST_AUTO_*_BASE_URL`, ports fermés fixes — jamais un vrai serveur du poste de dev), repli sur `SystemTtsProvider` avec un `espeak-ng` factice isolé sur `PATH` : la lecture réussit, aucune fenêtre d'erreur. Revue coordinateur 2026-09-12 : remplace `real-provider-unavailable`, dont le résultat dépendait de la présence réelle d'un Chatterbox sur la machine. |
| `tts-auto-fallback-fails` | non défini | `out/test/integration-real/tts-fallback-fails.test.js` | Même chaîne `"auto"`, mais `PATH` dépouillé comme `system-no-engine` : aucun repli nulle part, sur aucune machine — le dialogue « TTS indisponible » apparaît, aucune exception non gérée. |

`npm run test:integration` (= `npm run build && vscode-test`) exécute tous les
profils l'un après l'autre.

## E2E réel (S4.3) : `npm run test:integration-real`

`test/integration-real/chatterbox-tts.test.ts` est un test **vitest**
(pas `@vscode/test-cli` — pas d'import `vscode`), donc exécuté séparément
via `vitest.integration-real.config.ts` (`npm run test:integration-real`),
jamais par `.vscode-test.mjs` ni par `npm run test:integration`. Il est
`skip` sauf `LLM_VOICE_E2E=1`, et cible `LLM_VOICE_E2E_TTS_URL`
(`http://127.0.0.1:8004` par défaut) : health, liste des voix, synthèse
d'une phrase FR de référence (CdC §50) → WAV valide. Orchestré par
`scripts/e2e-local.sh` (racine du repo), qui écrit un rapport dans
`~/.llm-voice/e2e/`.
