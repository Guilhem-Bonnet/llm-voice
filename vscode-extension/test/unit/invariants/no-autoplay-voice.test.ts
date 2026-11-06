/**
 * ADR-017 V14: zero autoplay covers the migration, `chooseVoice` and `chooseMode`.
 * Static, like `no-autoplay.test.ts`: it fails the moment such a call lands, without
 * depending on the feature being exercised. The preview is the one reading of the
 * voice list, behind its own button: it is checked to stay behind it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../../../src");
const READING = /PlaybackController|controller\.start|\.play\(\)|startInternal|speakTestText/;

/** The body of one method of a class, by the indentation of its closing brace. */
function methodBody(source: string, signature: string): string {
  const start = source.indexOf(`  ${signature}`);
  expect(start, `${signature} should exist`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf("\n  }\n", start);
  return source.slice(start, end);
}

describe("V14: nothing of the voice model starts a reading", () => {
  it.each(["profiles/migrations.ts", "profiles/globalVoiceStore.ts", "profiles/profileStore.ts", "profiles/voiceResolution.ts"])(
    "%s never reaches playback",
    (file) => {
      expect(readFileSync(resolve(SRC, file), "utf8")).not.toMatch(READING);
    }
  );

  const pipeline = readFileSync(resolve(SRC, "pipeline/Pipeline.ts"), "utf8");

  it.each([
    "async chooseMode(",
    "async selectProfileById(",
    "async chooseVoice(",
    "async chooseVoiceById(",
    "private async applyEngineVoice(",
    "private async afterGlobalVoiceChange(",
    "async applyVoiceTierChoice(",
    "async useGlobalVoiceForMode(",
    "private async chooseEngineVoice("
  ])("Pipeline.%s never starts a reading", (signature) => {
    expect(methodBody(pipeline, signature)).not.toMatch(READING);
  });

  it("the preview of a voice row only runs from its own button", () => {
    const pick = methodBody(pipeline, "private pickVoiceOrTier(");
    const previews = pick.match(/this\.previewVoice\(/g) ?? [];
    expect(previews).toHaveLength(1);
    expect(pick.indexOf("onDidTriggerItemButton")).toBeLessThan(pick.indexOf("this.previewVoice("));
    expect(pick.indexOf("this.previewVoice(")).toBeLessThan(pick.indexOf("onDidAccept"));
  });
});
