/**
 * `friendlyTtsProviderLabel` (audit `docs/ux/audit-2026-11-05.md`, P1): the
 * single source of truth for the human-facing provider/voice label shown in
 * the player panel and the status bar tooltip.
 */
import { describe, expect, it } from "vitest";
import { friendlyTtsProviderLabel } from "../../../src/profiles/ttsProviderLabel.js";

describe("friendlyTtsProviderLabel", () => {
  it("translates every known providerId into its exact plain-language label (Sentinel review: a bare toContain would pass even for an untranslated raw id)", () => {
    expect(friendlyTtsProviderLabel("system")).toBe("Voix système");
    expect(friendlyTtsProviderLabel("chatterbox")).toBe("Chatterbox (qualité maximale)");
    expect(friendlyTtsProviderLabel("kokoro")).toBe("Kokoro (voix locale rapide)");
    expect(friendlyTtsProviderLabel("kyutai-pocket")).toBe("Kyutai Pocket TTS (avancé)");
    expect(friendlyTtsProviderLabel("openai-compatible")).toBe("Compatible OpenAI (distant)");
  });

  it("never returns the raw providerId unchanged for a known id — proves translation actually happened, not just a passthrough", () => {
    for (const id of ["system", "chatterbox", "kokoro", "kyutai-pocket", "openai-compatible"]) {
      expect(friendlyTtsProviderLabel(id)).not.toBe(id);
    }
  });

  it("falls back to 'Voix automatique' when providerId is omitted (profile.tts.providerId is optional, means 'auto')", () => {
    expect(friendlyTtsProviderLabel(undefined)).toBe("Voix automatique");
  });

  it("falls back to the raw id for an unknown providerId rather than throwing", () => {
    expect(friendlyTtsProviderLabel("some-future-provider")).toBe("some-future-provider");
  });
});
