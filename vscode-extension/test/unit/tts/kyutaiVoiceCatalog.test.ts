import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KYUTAI_POCKET_VOICE_CATALOG } from "../../../src/tts/kyutaiVoiceCatalog.js";

const MEDIA = join(__dirname, "..", "..", "..", "media");

describe("Kyutai voice catalogue (ADR-016 §4)", () => {
  it("offers the 20 voices whose licence was read, Estelle first", () => {
    expect(KYUTAI_POCKET_VOICE_CATALOG).toHaveLength(20);
    expect(KYUTAI_POCKET_VOICE_CATALOG[0]?.id).toBe("estelle");
    expect(new Set(KYUTAI_POCKET_VOICE_CATALOG.map((voice) => voice.id)).size).toBe(20);
  });

  it.each(["cosette", "jean", "giovanni", "lola", "juergen", "rafael", "daan"])(
    "leaves out %s: non-commercial or no licence found",
    (id) => {
      expect(KYUTAI_POCKET_VOICE_CATALOG.some((voice) => voice.id === id)).toBe(false);
    }
  );

  it.each(KYUTAI_POCKET_VOICE_CATALOG.map((voice) => [voice.id, voice] as const))(
    "%s has a permissive licence and a source",
    (_id, voice) => {
      expect(["CC0-1.0", "CC-BY-4.0"]).toContain(voice.licence?.spdx);
      expect(voice.licence?.sourceUrl).toMatch(/^https:\/\/huggingface\.co\/kyutai\/tts-voices\/blob\/main\//);
      expect(voice.licence?.attributionRequired).toBe(voice.licence?.spdx === "CC-BY-4.0");
    }
  );

  it.each(KYUTAI_POCKET_VOICE_CATALOG.map((voice) => [voice.id, voice] as const))(
    "%s ships a small sample",
    (_id, voice) => {
      const sample = join(MEDIA, voice.preview ?? "missing");
      expect(existsSync(sample)).toBe(true);
      expect(readFileSync(sample).subarray(0, 4).toString("latin1")).toBe("OggS");
      expect(statSync(sample).size).toBeLessThan(100_000);
    }
  );

  it("credits every voice that requires attribution", () => {
    const credits = readFileSync(join(MEDIA, "voices", "CREDITS.md"), "utf8");
    for (const voice of KYUTAI_POCKET_VOICE_CATALOG) {
      if (voice.licence?.attributionRequired) {
        expect(credits).toContain(voice.label);
      }
    }
  });
});
