import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AudioChunk } from "../../../src/core/playback.js";
import { documentViewOf } from "../../../src/views/player/documentView.js";
import { charsOf, describeReading, passagesAhead } from "../../../src/views/player/readingText.js";

const range = (startLine: number, endLine: number) => ({ startLine, startColumn: 0, endLine, endColumn: 4 });
const chunk = (status: AudioChunk["status"]): AudioChunk => ({
  id: "c",
  sessionId: "s",
  spokenText: "x",
  sourceRanges: [],
  status
});

describe("documentViewOf", () => {
  it("is nothing when nothing is open, or for VS Code's output panel", () => {
    expect(documentViewOf(undefined)).toBeNull();
    expect(documentViewOf({ scheme: "output", path: "/x", selections: [] })).toBeNull();
  });

  it("gives the file name, and no passage for an empty selection", () => {
    const view = documentViewOf({ scheme: "file", path: "/a/Voice-System.md", selections: [{ ...range(3, 3), endColumn: 0 }] });
    expect(view).toEqual({ fileName: "Voice-System.md", passages: 0 });
  });

  it("counts merged passages and lists their lines from two up", () => {
    const view = documentViewOf({ scheme: "file", path: "/a.md", selections: [range(39, 43), range(11, 17), range(15, 17), range(89, 89)] });
    expect(view).toEqual({ fileName: "a.md", passages: 3, passagesText: "Passages : lignes 12-18, 40-44 et 90." });
    expect(documentViewOf({ scheme: "file", path: "/a.md", selections: [range(1, 2)] })?.passagesText).toBeUndefined();
  });
});

describe("passagesAhead", () => {
  it("counts the ready passages right after the current one", () => {
    expect(passagesAhead([chunk("playing"), chunk("ready"), chunk("ready"), chunk("pending"), chunk("ready")], 0)).toBe(2);
  });

  it("is zero when the next one is not there yet, and absent when nothing follows", () => {
    expect(passagesAhead([chunk("playing"), chunk("generating")], 0)).toBe(0);
    expect(passagesAhead([chunk("playing")], 0)).toBeUndefined();
  });
});

describe("describeReading", () => {
  const headings = [
    { id: "h1", type: "heading" as const, rawText: "# Début", sourceRange: range(0, 0) },
    { id: "h2", type: "heading" as const, rawText: "## Peut-il faire du TTS avancé ?", sourceRange: range(40, 40) }
  ];

  it("names the last heading above the passage, with its lines", () => {
    expect(describeReading(headings, [range(41, 50), range(51, 57)])).toBe("Lecture de : Peut-il faire du TTS avancé ?, lignes 42-58");
  });

  it("says nothing when no heading is known", () => {
    expect(describeReading([], [range(41, 50)])).toBeUndefined();
    expect(describeReading(headings, [])).toBeUndefined();
  });
});

describe("charsOf", () => {
  it("adds lengths, an absent text counting for nothing", () => {
    expect(charsOf(["abc", undefined, "de"])).toBe(5);
  });
});

describe("keyboard shortcuts of the mockup", () => {
  const manifest = JSON.parse(readFileSync(resolve(__dirname, "../../../package.json"), "utf8")) as {
    contributes: { keybindings: { key: string; command: string; when?: string }[] };
  };
  const binding = (key: string) => manifest.contributes.keybindings.find((entry) => entry.key === key);

  it("ctrl+alt+v f reads from here, ctrl+alt+v t the section", () => {
    expect(binding("ctrl+alt+v f")?.command).toBe("llmVoice.speakFromCursor");
    expect(binding("ctrl+alt+v t")?.command).toBe("llmVoice.speakSection");
    expect(binding("ctrl+alt+v t")?.when).toContain("editorLangId == markdown");
  });
});
