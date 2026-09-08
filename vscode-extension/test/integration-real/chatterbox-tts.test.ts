/**
 * S4.3 — real E2E against a live Chatterbox-TTS-Server (`deploy/README.md`),
 * plain Node (no `vscode`), run via `npm run test:integration-real`
 * (`vitest.integration-real.config.ts`), never part of `npm run
 * test:integration` or CI: skipped unless `LLM_VOICE_E2E=1` is set, since it
 * needs a real container listening on `LLM_VOICE_E2E_TTS_URL`
 * (`http://127.0.0.1:8004` by default).
 *
 * This test hits the *real* Chatterbox-TTS-Server contract, which turned out
 * to differ from what `OpenAICompatibleTtsProvider` (`src/tts/`) assumes —
 * confirmed live on 2026-09-08, flagged in shared-context.md "Requêtes
 * inter-agents" for backend-engineer, not fixed here (ops scope, S4.3):
 *   1. `/v1/audio/speech` returns HTTP 422 without `model` *and* `voice` in
 *      the body — the provider only sends them `if (request.xxx !==
 *      undefined)`, so a `TtsRequest` without an explicit voice/model (the
 *      common case) fails against this server.
 *   2. `/v1/audio/voices` returns `{ status, voices: string[] }` (plain
 *      voice filenames, e.g. `"Emily.wav"`), not
 *      `{ voices: { id, name, language }[] }` — `listVoices()` would map
 *      every entry to `id: undefined`.
 *   3. `language` on `/v1/audio/speech` is a documented, optional field
 *      (`OpenAISpeechRequest`) but produces byte-identical audio with or
 *      without it — confirmed no-op, unlike the server's own `/tts`
 *      endpoint, which *does* change output for the same `language`. A
 *      user-reported "English-accented French" defect traces to this: the
 *      shipped provider has no way to make this server actually speak
 *      French, even with `language: "fr"` set. Relevant for `ChatterboxProvider`
 *      (PR #28) if this server is chosen as the shipped default.
 * This test therefore sends `model`/`voice`/`language` explicitly and reads
 * `voices` as `string[]`, to prove the *server* works end-to-end regardless
 * of that gap (it does not assert on accent/pronunciation quality — no
 * automated way to judge that here).
 */
import { describe, expect, test } from "vitest";
import { readWavHeader } from "../fakes/wav.js";

const RUN_E2E = process.env["LLM_VOICE_E2E"] === "1";
const BASE_URL = (process.env["LLM_VOICE_E2E_TTS_URL"] ?? "http://127.0.0.1:8004").replace(/\/+$/, "");
// Matches deploy/tts/config.yaml (model.repo_id, tts_engine.default_voice_id).
const MODEL = process.env["LLM_VOICE_E2E_TTS_MODEL"] ?? "chatterbox-multilingual";
const VOICE = process.env["LLM_VOICE_E2E_TTS_VOICE"] ?? "Emily.wav";

// CdC §50, "Test Voice" reference sentence.
const REFERENCE_TEXT =
  "Bonjour. Voici un exemple de ma voix. Nous allons maintenant examiner un " +
  "concept technique et voir comment l'expliquer clairement.";

interface VoicesResponseBody {
  voices?: string[];
}

describe.skipIf(!RUN_E2E)("Chatterbox-TTS-Server (S4.3, real E2E)", () => {
  test("health: /v1/audio/voices responds ok", async () => {
    const response = await fetch(`${BASE_URL}/v1/audio/voices`);
    expect(response.ok).toBe(true);
  });

  test("lists at least one voice", async () => {
    const response = await fetch(`${BASE_URL}/v1/audio/voices`);
    const body = (await response.json()) as VoicesResponseBody;
    expect(Array.isArray(body.voices)).toBe(true);
    expect((body.voices ?? []).length).toBeGreaterThan(0);
  });

  test("synthesizes the reference sentence to a valid WAV", async () => {
    const response = await fetch(`${BASE_URL}/v1/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        voice: VOICE,
        input: REFERENCE_TEXT,
        response_format: "wav",
        language: "fr"
      })
    });
    expect(response.ok).toBe(true);

    const buffer = Buffer.from(await response.arrayBuffer());
    const header = readWavHeader(buffer);
    expect(header.sampleRate).toBeGreaterThan(0);
    expect(header.numChannels).toBeGreaterThan(0);
    expect(header.durationMs).toBeGreaterThan(0);
  });
});
