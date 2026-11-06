/**
 * ADR-017 V8, part 0-004: a published identifier stays executable (a user's shortcut
 * may name it), or is retired and named by §3 of the ADR. Cards 0-007 and 1-002 move
 * ids from `V0_3_*` to `RETIRED` in the same change that retires them.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const manifest = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
  contributes: {
    commands: { command: string; title: string }[];
    views: Record<string, { id: string; type?: string }[]>;
    menus: { commandPalette: { command: string; when?: string }[] };
    configuration: { properties: Record<string, { deprecationMessage?: string }> };
    walkthroughs: { steps: { id: string; description: string; completionEvents: string[] }[] }[];
  };
};

/** Frozen from `package.json` of version 0.3 (`git show HEAD:vscode-extension/package.json`). */
const V0_3_COMMANDS = [
  "llmVoice.speakDocument",
  "llmVoice.setupVoice",
  "llmVoice.walkthroughOpenExample",
  "llmVoice.speakSelection",
  "llmVoice.speakFromCursor",
  "llmVoice.speakSection",
  "llmVoice.speakClipboard",
  "llmVoice.play",
  "llmVoice.playPause",
  "llmVoice.pause",
  "llmVoice.stop",
  "llmVoice.previousSegment",
  "llmVoice.nextSegment",
  "llmVoice.selectProfile",
  "llmVoice.openProfiles",
  "llmVoice.duplicateProfile",
  "llmVoice.deleteProfile",
  "llmVoice.importProfile",
  "llmVoice.exportProfile",
  "llmVoice.setDefaultProfile",
  "llmVoice.testVoice",
  "llmVoice.providerStatus",
  "llmVoice.performanceReport",
  "llmVoice.setProviderApiKey",
  "llmVoice.clearProviderApiKey",
  "llmVoice.clearHighlight",
  "llmVoice.clearAudioCache",
  "llmVoice.verifyLocalMode",
  "llmVoice.openInbox",
  "llmVoice.speakLatestClaudeResponse",
  "llmVoice.installClaudeHook",
  "llmVoice.uninstallClaudeHook",
  "llmVoice.installPiperVoice",
  "llmVoice.browseVoices",
  "llmVoice.useOwnVoice",
  "llmVoice.editProfile"
];
const V0_3_VIEWS = ["llmVoice.player", "llmVoice.playerView", "llmVoice.inboxView", "llmVoice.profilesView"];

/** Nothing is retired by card 0-004: `profilesView.*` go with 1-002, `llmVoice.player` with 0-007. */
const RETIRED: readonly string[] = [];

const ALIASES = ["llmVoice.setupVoice", "llmVoice.browseVoices", "llmVoice.selectProfile", "llmVoice.speakLatestClaudeResponse"];

function source(relative: string): string {
  return readFileSync(resolve(ROOT, relative), "utf8");
}

describe("V8: identifiers (ADR-017 §3)", () => {
  const declared = new Set(manifest.contributes.commands.map((entry) => entry.command));
  const registered = source("src/commands/index.ts") + source("src/extension.ts");

  it.each(V0_3_COMMANDS.filter((id) => !RETIRED.includes(id)))("%s is still declared and registered", (id) => {
    expect(declared.has(id)).toBe(true);
    expect(registered).toContain(`"${id}"`);
  });

  it("every view of 0.3 is still declared", () => {
    const views = Object.values(manifest.contributes.views)
      .flat()
      .map((view) => view.id);
    for (const id of V0_3_VIEWS.filter((view) => !RETIRED.includes(view))) {
      expect(views).toContain(id);
    }
  });

  it("the two new commands are declared, registered and in the palette", () => {
    for (const id of ["llmVoice.chooseVoice", "llmVoice.chooseMode", "llmVoice.openVoiceGallery"]) {
      expect(declared.has(id)).toBe(true);
      expect(registered).toContain(`"${id}"`);
      expect(manifest.contributes.menus.commandPalette.find((entry) => entry.command === id)).toBeUndefined();
    }
  });

  it.each(ALIASES)("%s is an alias, hidden from the palette", (id) => {
    expect(manifest.contributes.menus.commandPalette.find((entry) => entry.command === id)?.when).toBe("false");
  });

  it("aliases do what their command does: the same call of the pipeline, no second implementation", () => {
    const commands = source("src/commands/index.ts");
    const call = (id: string): string | undefined =>
      new RegExp(`registerCommand\\("${id.replace(".", "\\.")}", \\(\\) => pipeline\\.(\\w+)\\(\\)\\)`).exec(commands)?.[1];
    expect(call("llmVoice.chooseVoice")).toBe("chooseVoice");
    expect(call("llmVoice.setupVoice")).toBe("chooseVoice");
    expect(call("llmVoice.browseVoices")).toBe("openVoiceGallery");
    expect(call("llmVoice.openVoiceGallery")).toBe("openVoiceGallery");
    expect(call("llmVoice.chooseMode")).toBe("chooseMode");
    expect(call("llmVoice.selectProfile")).toBe("chooseMode");
    expect(call("llmVoice.speakLatestResponse")).toBe("speakLatestResponse");
    expect(call("llmVoice.speakLatestClaudeResponse")).toBe("speakLatestResponse");
  });

  it("the walkthrough step goes to chooseMode, its id unchanged", () => {
    const step = manifest.contributes.walkthroughs[0]?.steps.find((candidate) => candidate.id === "chooseProfile");
    expect(step?.description).toContain("command:llmVoice.chooseMode");
    expect(step?.completionEvents).toEqual(["onCommand:llmVoice.chooseMode"]);
  });
});

describe("settings (ADR-017 §2)", () => {
  const properties = manifest.contributes.configuration.properties;

  it("llmVoice.defaultProfile is retired", () => {
    expect(properties["llmVoice.defaultProfile"]).toBeUndefined();
  });

  it("llmVoice.modes.bySource replaces the old one, which stays declared and says so", () => {
    expect(properties["llmVoice.modes.bySource"]).toBeDefined();
    expect(properties["llmVoice.profiles.bySource"]?.deprecationMessage).toContain("llmVoice.modes.bySource");
  });

  it("the engine and the URL settings are deprecated, not removed", () => {
    expect(properties["llmVoice.tts.provider"]?.deprecationMessage).toBeDefined();
    expect(properties["llmVoice.tts.baseUrl"]?.deprecationMessage).toBeDefined();
  });

  it("the write of a voice in a mode is gone from the pipeline (ADR-017 §1.3)", () => {
    const pipeline = source("src/pipeline/Pipeline.ts");
    expect(pipeline).not.toMatch(/\.\.\.current\.tts/);
    expect(pipeline).not.toMatch(/speakTestText\(\{ \.\.\.profile, tts: \{ \.\.\.profile\.tts/);
    expect(pipeline).not.toContain("applyVoiceToProfileById");
    expect(pipeline).not.toContain("friendlyTtsProviderLabel");
    const reads = pipeline.match(/this\.profiles\.getSelected\(/g) ?? [];
    expect(reads).toHaveLength(1);
    expect(pipeline).toMatch(/const selected = await this\.profiles\.getSelected\(\);/);
  });
});
