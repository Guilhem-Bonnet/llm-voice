/**
 * Optional real-service test (S4.1): exercises `OllamaNarrator` against an
 * actual Ollama instance on `localhost:11434`. Not part of `npm run
 * test:unit` (outside `test/unit/**`, vitest.config.ts's `include`) and
 * self-skips unless `LLM_VOICE_E2E_OLLAMA` is set, since it depends on a
 * locally running model this repo cannot provide in CI.
 *
 * Run explicitly with a model already pulled (`ollama list`):
 *   LLM_VOICE_E2E_OLLAMA=1 LLM_VOICE_E2E_OLLAMA_MODEL=qwen2.5:1.5b \
 *     npx vitest run test/integration-real/ollama-narrator.test.ts
 */
import { describe, expect, it } from "vitest";
import { createEgressGuard } from "../../src/net/EgressGuard.js";
import { OllamaNarrator } from "../../src/narrator/OllamaNarrator.js";

const enabled = process.env.LLM_VOICE_E2E_OLLAMA !== undefined;
const model = process.env.LLM_VOICE_E2E_OLLAMA_MODEL ?? "qwen2.5:7b";

describe.skipIf(!enabled)("OllamaNarrator against a real localhost:11434 (S4.1)", () => {
  it("narrates a French paragraph into non-empty segments", async () => {
    const egress = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
    const narrator = new OllamaNarrator({
      baseUrl: "http://127.0.0.1:11434",
      model,
      egress,
      timeoutMs: 60_000
    });

    const health = await narrator.health();
    expect(["ok", "degraded"]).toContain(health.status);

    const result = await narrator.transform({
      segments: [
        {
          id: "src-0",
          type: "paragraph",
          rawText:
            "La readiness probe détermine si un Pod peut recevoir du trafic. " +
            "Elle diffère de la liveness probe, qui décide si le conteneur doit être redémarré.",
          sourceRange: { startLine: 0, startColumn: 0, endLine: 1, endColumn: 0 }
        }
      ],
      profileId: "technical-teacher",
      language: "fr-FR",
      mode: "narrated",
      style:
        "Transforme la section en explication orale pédagogique et naturelle. " +
        "Ne donne jamais l'impression de lire des notes.",
      outputContract: "narration-segments"
    });

    expect(result.segments.length).toBeGreaterThan(0);
    for (const segment of result.segments) {
      expect(segment.spokenText.trim().length).toBeGreaterThan(0);
    }
  }, 90_000);
});
