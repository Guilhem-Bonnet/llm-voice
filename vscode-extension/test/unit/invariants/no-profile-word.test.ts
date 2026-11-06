/**
 * ADR-017 V9, as a ratchet: the word "profil" leaves what the user reads. Every text
 * that still holds it is frozen below (`profile-word-exceptions.json`), file by file
 * and attributed to the card that removes it. A new occurrence fails; an occurrence
 * that is gone must leave the list in the same change. At card 1-005 only the
 * deprecated setting remains.
 *
 * What is read: titles, names and descriptions of `package.json`, and every string or
 * template with a space in it in `src/` and `media/`. A single word is an identifier
 * (`profiles.json`, `selectProfile`), not a sentence; a comment is not a surface.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import exceptions from "./profile-word-exceptions.json";
import { currentOccurrences, manifestSentences, ROOT, WORD, type ManifestShape } from "./profileWordScan.js";

const FROZEN = exceptions as { file: string; card: string; texts: string[] }[];

function frozenTexts(file: string): string[] {
  return FROZEN.filter((entry) => entry.file === file).flatMap((entry) => entry.texts);
}

describe("V9: the word, as a ratchet (ADR-017)", () => {
  const current = currentOccurrences();

  it("no new occurrence, in a file not on the list or on a listed one", () => {
    const fresh = Object.entries(current).flatMap(([file, texts]) => {
      const allowed = frozenTexts(file);
      return texts.flatMap((text) => {
        const at = allowed.indexOf(text);
        if (at === -1) {
          return [`${file}: ${text}`];
        }
        allowed.splice(at, 1);
        return [];
      });
    });
    expect(fresh).toEqual([]);
  });

  it("an occurrence that is gone leaves the list in the same change", () => {
    const files = [...new Set(FROZEN.map((entry) => entry.file))];
    const stale = files.flatMap((file) => {
      const present = [...(current[file] ?? [])];
      return frozenTexts(file).flatMap((text) => {
        const at = present.indexOf(text);
        if (at === -1) {
          return [`${file}: ${text}`];
        }
        present.splice(at, 1);
        return [];
      });
    });
    expect(stale).toEqual([]);
  });

  it("every exception is attributed to a card", () => {
    for (const { file, card } of FROZEN) {
      expect(card, file).toMatch(/^(0-005|0-007|0-009|1-001|1-002|1-003|1-004|1-005)$/);
    }
  });

  it("the new surfaces are not on the list", () => {
    const manifest = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as ManifestShape & {
      contributes: { commands: { command: string; title: string }[] };
    };
    for (const entry of manifest.contributes.commands) {
      if (entry.command === "llmVoice.chooseVoice" || entry.command === "llmVoice.chooseMode") {
        expect(entry.title).not.toMatch(WORD);
      }
    }
    expect(frozenTexts("package.json").join("\n")).not.toMatch(/llmVoice\.modes\.bySource.*profil/i);
    expect(manifestSentences().join("\n")).not.toContain("Choisir un profil");
    const pipeline = readFileSync(resolve(ROOT, "src/pipeline/Pipeline.ts"), "utf8");
    for (const marker of ["async chooseMode(", "private warnIfVoiceLanguageDiffers(", "async chooseVoice(", "private voiceTierActions("]) {
      expect(pipeline.indexOf(marker), `bornes du contrôle : ${marker}`).toBeGreaterThanOrEqual(0);
    }
    const chooseMode = pipeline.slice(pipeline.indexOf("async chooseMode("), pipeline.indexOf("private warnIfVoiceLanguageDiffers("));
    const chooseVoice = pipeline.slice(pipeline.indexOf("async chooseVoice("), pipeline.indexOf("private voiceTierActions("));
    expect(/"[^"\n]*profil[^"\n]*"/i.test(chooseMode)).toBe(false);
    expect(/"[^"\n]*profil[^"\n]*"/i.test(chooseVoice)).toBe(false);
  });
});
