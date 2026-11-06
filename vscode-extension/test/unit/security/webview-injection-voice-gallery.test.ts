/**
 * The voice gallery, same three layers as `webview-injection.test.ts`: the document
 * and its CSP, the real page fed hostile values, and a static gate on what it may
 * call. `media-src` is narrower than the player's: no `blob:`, only what
 * `asWebviewUri` serves, because the only audio here is a file on this machine.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildVoiceGalleryHtml, voiceGalleryCsp } from "../../../src/views/voiceGallery/voiceGalleryHtml.js";

const js = readFileSync(resolve(__dirname, "../../../media/voiceGallery/voiceGallery.js"), "utf8");
const css = readFileSync(resolve(__dirname, "../../../media/voiceGallery/voiceGallery.css"), "utf8");

const CSP_SOURCE = "https://file+.vscode-resource.vscode-cdn.net";
const inputs = {
  nonce: "NONCE",
  cspSource: CSP_SOURCE,
  scriptUri: `${CSP_SOURCE}/media/voiceGallery/voiceGallery.js`,
  styleUri: `${CSP_SOURCE}/media/voiceGallery/voiceGallery.css`
};

const PAYLOADS = [
  "<script>window.__pwned = true</script>",
  '<img src=x onerror="window.__pwned = true">',
  '" onmouseover="window.__pwned=1" x="',
  "</script><script>window.__pwned=1</script>"
];

describe("the gallery document", () => {
  const html = buildVoiceGalleryHtml(inputs);

  it("carries a strict CSP", () => {
    const csp = voiceGalleryCsp("NONCE", CSP_SOURCE);
    expect(html).toContain(csp);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'nonce-NONCE'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/(script|style|media|img|font)-src[^;]*\*/);
  });

  it("limits audio to what VS Code serves from this machine", () => {
    const media = /media-src ([^;]+)/.exec(voiceGalleryCsp("NONCE", CSP_SOURCE))?.[1];
    expect(media).toBe(CSP_SOURCE);
  });

  it("has exactly one script, with the nonce and no inline body", () => {
    const scripts = [...html.matchAll(/<script\b[^>]*>/gi)];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.[0]).toContain('nonce="NONCE"');
    expect(html).not.toMatch(/<script[^>]*>[^<]+<\/script>/i);
  });

  it("interpolates nothing but the nonce and the URIs", () => {
    const blank = buildVoiceGalleryHtml({ nonce: "", cspSource: "", scriptUri: "", styleUri: "" });
    const other = buildVoiceGalleryHtml({ nonce: "A", cspSource: "B", scriptUri: "C", styleUri: "D" });
    expect(blank.replace(/\s/g, "").length).toBeLessThan(other.replace(/\s/g, "").length + 10);
    for (const payload of PAYLOADS) {
      expect(html).not.toContain(payload);
    }
    expect(html).not.toContain("undefined");
  });

  it("loads nothing from outside", () => {
    const urls = [...html.matchAll(/https?:\/\/[^\s"'<>]+/g)].map((match) => match[0]);
    expect(urls.filter((url) => !url.startsWith(CSP_SOURCE))).toEqual([]);
    expect(css).not.toMatch(/url\(|@import/);
  });
});

describe("the gallery page", () => {
  it("never builds markup from a string", () => {
    expect(js).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
  });

  it("does no network of its own and opens nothing itself", () => {
    expect(js).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|window\.open|importScripts/);
    // The one address in the file names the SVG namespace; nothing fetches it.
    expect(js.replace("http://www.w3.org/2000/svg", "")).not.toMatch(/https?:\/\//);
  });

  it("writes a hostile label as text", () => {
    const written: string[] = [];
    const makeElement = (): Record<string, unknown> => {
      const element: Record<string, unknown> = {
        hidden: false,
        value: "",
        style: {},
        dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        setAttribute() {},
        removeAttribute() {},
        getAttribute: () => undefined,
        addEventListener() {},
        appendChild() {},
        append() {},
        replaceChildren() {},
        pause() {},
        load() {},
        play: () => Promise.resolve()
      };
      Object.defineProperty(element, "textContent", {
        set: (value: string) => written.push(value),
        get: () => ""
      });
      Object.defineProperty(element, "innerHTML", {
        set: () => {
          throw new Error("innerHTML written");
        }
      });
      return element;
    };
    const elements = new Map<string, Record<string, unknown>>();
    const handlers: ((event: { data: unknown }) => void)[] = [];
    new Function("acquireVsCodeApi", "document", "window", js)(
      () => ({ postMessage() {} }),
      {
        getElementById: (id: string) => {
          const existing = elements.get(id) ?? makeElement();
          elements.set(id, existing);
          return existing;
        },
        createElement: makeElement,
        createElementNS: makeElement
      },
      { addEventListener: (_type: string, handler: (event: { data: unknown }) => void) => handlers.push(handler), setInterval: () => 1, clearInterval() {} }
    );

    for (const payload of PAYLOADS) {
      for (const handler of handlers) {
        handler({
          data: {
            type: "state",
            activeLabel: payload,
            favorites: [],
            engines: {},
            cards: [{ id: "x", label: payload, detail: payload, section: "kyutai", state: payload, canChoose: true, canListen: true }],
            credits: { subtitle: payload, clause: payload, groups: [{ source: payload, licence: payload, voices: payload }], links: [{ label: payload, url: payload }] }
          }
        });
      }
      expect(written).toContain(payload);
    }
  });

  it("ignores messages it does not know and malformed ones", () => {
    const handlers: ((event: { data: unknown }) => void)[] = [];
    const makeElement = (): Record<string, unknown> => ({
      style: {},
      dataset: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      setAttribute() {},
      removeAttribute() {},
      addEventListener() {},
      appendChild() {},
      append() {},
      replaceChildren() {},
      pause() {},
      load() {},
      play: () => Promise.resolve()
    });
    const cache = new Map<string, Record<string, unknown>>();
    new Function("acquireVsCodeApi", "document", "window", js)(
      () => ({ postMessage() {} }),
      {
        getElementById: (id: string) => {
          const existing = cache.get(id) ?? makeElement();
          cache.set(id, existing);
          return existing;
        },
        createElement: makeElement,
        createElementNS: makeElement
      },
      { addEventListener: (_type: string, handler: (event: { data: unknown }) => void) => handlers.push(handler), setInterval: () => 1, clearInterval() {} }
    );

    for (const data of [null, undefined, "x", 3, {}, { type: "state" }, { type: "state", cards: "x" }, { type: "exec" }]) {
      expect(() => handlers.forEach((handler) => handler({ data }))).not.toThrow();
    }
  });
});
