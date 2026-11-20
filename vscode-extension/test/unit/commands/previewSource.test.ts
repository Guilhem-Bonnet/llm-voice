import { describe, expect, it } from "vitest";
import { matchPreviewSource, previewFileName } from "../../../src/commands/previewSource.js";

describe("finding the source of a Markdown preview", () => {
  it("reads the file name from the tab, whatever the language of VS Code", () => {
    expect(previewFileName("Preview notes.md")).toBe("notes.md");
    expect(previewFileName("Aperçu mes notes.md")).toBe("mes notes.md");
    expect(previewFileName("Aperçu")).toBeUndefined();
  });

  it("finds the only open document with that name, spaces included", () => {
    expect(matchPreviewSource("mes notes.md", ["file:///a/mes%20notes.md", "file:///a/autre.md"])).toEqual({ kind: "found", uri: "file:///a/mes%20notes.md" });
  });

  it("does not take a file whose name merely ends the same way", () => {
    expect(matchPreviewSource("notes.md", ["file:///a/vieilles-notes.md"])).toEqual({ kind: "none" });
  });

  it("refuses to guess between two files of the same name", () => {
    expect(matchPreviewSource("notes.md", ["file:///a/notes.md", "file:///b/notes.md"]).kind).toBe("ambiguous");
  });
});
