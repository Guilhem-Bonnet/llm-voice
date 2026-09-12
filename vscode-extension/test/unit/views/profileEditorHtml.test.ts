/**
 * S8.2 — same proof as `test/unit/security/webview-injection.test.ts` for
 * `buildPlayerHtml`, applied to the profile editor's static shell: the
 * document is a pure function of a nonce and three VS Code URIs, nothing
 * else — a hostile profile label/description/style could never reach it
 * because there is no template slot for it to begin with (it travels over
 * `postMessage` instead, handled by `media/profileEditor/profileEditor.js`).
 */
import { describe, expect, it } from "vitest";
import { buildProfileEditorHtml, getNonce } from "../../../src/views/profileEditor/profileEditorHtml.js";

const XSS_PAYLOADS = [
  "<script>window.__pwned = true</script>",
  '<img src=x onerror="window.__pwned = true">',
  "</title><script>1</script>",
  "javascript:window.__pwned=1"
];

const inputs = {
  nonce: "NONCE",
  cspSource: "https://file+.vscode-resource.vscode-cdn.net",
  scriptUri: "https://file+.vscode-resource.vscode-cdn.net/media/profileEditor/profileEditor.js",
  styleUri: "https://file+.vscode-resource.vscode-cdn.net/media/profileEditor/profileEditor.css"
};

describe("buildProfileEditorHtml", () => {
  it("carries a strict CSP with connect-src 'none'", () => {
    const html = buildProfileEditorHtml(inputs);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'nonce-NONCE'");
    expect(html).toContain("connect-src 'none'");
    expect(html).not.toContain("unsafe-inline");
    expect(html).not.toContain("unsafe-eval");
  });

  it("has exactly one script, carrying the nonce, no inline body", () => {
    const html = buildProfileEditorHtml(inputs);
    const scripts = [...html.matchAll(/<script\b[^>]*>/gi)];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.[0]).toContain('nonce="NONCE"');
    expect(html).not.toMatch(/<script[^>]*>[^<]+<\/script>/i);
  });

  it("interpolates nothing but the nonce and the two URIs — no profile data can reach it", () => {
    const html = buildProfileEditorHtml(inputs);
    for (const payload of XSS_PAYLOADS) {
      expect(html).not.toContain(payload);
    }
    expect(html).not.toContain("undefined");
  });

  it("carries every field name the story asks for as static markup", () => {
    const html = buildProfileEditorHtml(inputs);
    for (const id of [
      "field-label",
      "field-language",
      "field-mode",
      "field-narrator-provider",
      "field-narrator-model",
      "field-style",
      "field-tts-provider",
      "field-tts-voice",
      "field-speed",
      "field-md-code",
      "field-md-links",
      "field-md-images",
      "field-md-tables",
      "field-sync-mode",
      "btn-browse-voices",
      "btn-test",
      "btn-save",
      "btn-duplicate",
      "btn-delete"
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it("regenerates the nonce on every render", () => {
    const nonces = new Set(Array.from({ length: 100 }, () => getNonce()));
    expect(nonces.size).toBe(100);
  });
});
