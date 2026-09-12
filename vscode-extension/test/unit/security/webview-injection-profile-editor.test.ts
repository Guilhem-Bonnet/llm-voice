/**
 * S8.2 — static gate on `media/profileEditor/profileEditor.js`, the same
 * property `test/unit/security/webview-injection.test.ts` proves for
 * `media/player/player.js`: no HTML-parsing sink anywhere in the file.
 *
 * `document.createElement` is *not* forbidden here, unlike the player's own
 * gate: this webview builds one input per `TtsParameterDescriptor`
 * dynamically (ADR-005, "generate the UI instead of hard-coding it"), and
 * `createElement` + `textContent`/`.value` is the safe way to do that — the
 * player never needed to build a node at all, which is why its gate is
 * stricter. What both files forbid identically is the actual HTML-parsing
 * family: a `textContent` assignment cannot execute markup, `innerHTML`
 * always can.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const profileEditorJsPath = resolve(__dirname, "../../../media/profileEditor/profileEditor.js");
const profileEditorJs = readFileSync(profileEditorJsPath, "utf8");

describe("AC-SEC-02 — media/profileEditor/profileEditor.js", () => {
  it("never uses an HTML-parsing sink", () => {
    for (const sink of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function"]) {
      expect(profileEditorJs).not.toContain(sink);
    }
  });

  it("only ever removes children via removeChild, never by resetting innerHTML", () => {
    expect(profileEditorJs).toContain("removeChild");
    expect(profileEditorJs).not.toMatch(/\.innerHTML\s*=/);
  });

  it("writes profile-controlled fields with textContent/.value, not markup", () => {
    // Every place a message field (label, description, style, voice id...)
    // is written back into the DOM goes through one of these two safe
    // sinks — the same proof `webview-injection.test.ts` makes for
    // `player.js`'s `title.textContent`/`profile.textContent`.
    expect(profileEditorJs).toMatch(/\.textContent\s*=/);
    expect(profileEditorJs).toMatch(/\.value\s*=/);
  });
});
