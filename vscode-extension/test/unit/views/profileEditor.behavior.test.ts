/**
 * Runs the real `media/profileEditor/profileEditor.js` against a minimal
 * DOM double — same technique as `test/unit/security/webview-injection.
 * test.ts` for the player. Covers the real-user bug (2026-11-05): the
 * "Base URL" field never followed a TTS provider change, so a profile
 * created with Chatterbox then switched to Kyutai Pocket TTS kept pointing
 * at Chatterbox's port and failed with "fetch failed" — a confusing error
 * with no visible cause in the UI.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const profileEditorJsPath = resolve(__dirname, "../../../media/profileEditor/profileEditor.js");
const profileEditorJs = readFileSync(profileEditorJsPath, "utf8");

const FIELD_IDS = [
  "field-label",
  "field-language",
  "field-description",
  "field-mode",
  "field-narrator-provider",
  "field-narrator-model",
  "field-style",
  "field-tts-provider",
  "field-tts-base-url",
  "field-tts-voice",
  "field-speed",
  "field-md-code",
  "field-md-links",
  "field-md-images",
  "field-md-tables",
  "field-sync-mode"
];

function makeElement(id: string) {
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const attributes: Record<string, string> = {};
  return {
    id,
    value: "",
    textContent: "",
    hidden: false,
    style: {} as Record<string, string>,
    className: "",
    dataset: {} as Record<string, string>,
    attributes,
    children: [] as unknown[],
    setAttribute(name: string, v: string) {
      attributes[name] = v;
    },
    addEventListener(type: string, handler: (event: unknown) => void) {
      const existing = listeners.get(type) ?? [];
      existing.push(handler);
      listeners.set(type, existing);
    },
    dispatch(type: string) {
      for (const handler of listeners.get(type) ?? []) {
        handler({ preventDefault: () => undefined });
      }
    },
    appendChild(child: unknown) {
      this.children.push(child);
      return child;
    },
    removeChild(child: unknown) {
      this.children = this.children.filter((c) => c !== child);
    },
    get firstChild() {
      return this.children[0];
    },
    querySelectorAll() {
      return [];
    }
  };
}

function makeDom() {
  const elements = new Map<string, ReturnType<typeof makeElement>>();
  for (const id of [
    ...FIELD_IDS,
    "profile-form",
    "narrator-fields",
    "tts-parameters",
    "validation-errors",
    "voice-warning",
    "test-status",
    "connection-status",
    "btn-test",
    "btn-duplicate",
    "btn-delete",
    "btn-browse-voices",
    "btn-check-health"
  ]) {
    elements.set(id, makeElement(id));
  }
  const posted: unknown[] = [];
  const windowListeners = new Map<string, ((event: unknown) => void)[]>();
  const sandbox = {
    acquireVsCodeApi: () => ({ postMessage: (message: unknown) => posted.push(message) }),
    document: {
      getElementById: (id: string) => elements.get(id) ?? makeElement(id),
      createElement: (tag: string) => makeElement(`<${tag}>`)
    },
    window: {
      addEventListener(type: string, handler: (event: unknown) => void) {
        const existing = windowListeners.get(type) ?? [];
        existing.push(handler);
        windowListeners.set(type, existing);
      }
    },
    Array,
    Object,
    String,
    Number,
    Boolean,
    console
  };
  return { sandbox, elements, posted, windowListeners };
}

function runProfileEditor() {
  const dom = makeDom();
  const factory = new Function(
    "acquireVsCodeApi",
    "document",
    "window",
    `${profileEditorJs}\n//# sourceURL=profileEditor.js`
  );
  factory(dom.sandbox.acquireVsCodeApi, dom.sandbox.document, dom.sandbox.window);
  const send = (data: unknown) => {
    for (const handler of dom.windowListeners.get("message") ?? []) {
      handler({ data });
    }
  };
  return { ...dom, send };
}

describe("profileEditor.js — TTS provider change auto-fills the base URL (GAO fix, 2026-11-05)", () => {
  it("fills the Kyutai default URL when switching from the empty/untouched field", () => {
    const { elements } = runProfileEditor();
    const provider = elements.get("field-tts-provider")!;
    const baseUrl = elements.get("field-tts-base-url")!;

    provider.value = "kyutai-pocket";
    provider.dispatch("change");

    expect(baseUrl.value).toBe("http://localhost:8000");
  });

  it("replaces a leftover Chatterbox default (8004) with Kyutai's (8000)", () => {
    const { elements } = runProfileEditor();
    const provider = elements.get("field-tts-provider")!;
    const baseUrl = elements.get("field-tts-base-url")!;

    baseUrl.value = "http://localhost:8004"; // left over from a Chatterbox-backed profile
    provider.value = "kyutai-pocket";
    provider.dispatch("change");

    expect(baseUrl.value).toBe("http://localhost:8000");
  });

  it("recognizes the 127.0.0.1 spelling too — the exact value the user's error named (Sentinel review: the first fix only matched 'localhost')", () => {
    const { elements } = runProfileEditor();
    const provider = elements.get("field-tts-provider")!;
    const baseUrl = elements.get("field-tts-base-url")!;

    baseUrl.value = "http://127.0.0.1:8004";
    provider.value = "kyutai-pocket";
    provider.dispatch("change");

    expect(baseUrl.value).toBe("http://localhost:8000");
  });

  it("also recognizes a trailing slash or different case on a known default", () => {
    const { elements } = runProfileEditor();
    const provider = elements.get("field-tts-provider")!;
    const baseUrl = elements.get("field-tts-base-url")!;

    baseUrl.value = "HTTP://127.0.0.1:8004/";
    provider.value = "kyutai-pocket";
    provider.dispatch("change");

    expect(baseUrl.value).toBe("http://localhost:8000");
  });

  it("never overwrites a URL the user typed by hand", () => {
    const { elements } = runProfileEditor();
    const provider = elements.get("field-tts-provider")!;
    const baseUrl = elements.get("field-tts-base-url")!;

    baseUrl.value = "http://my-own-server.example:9999";
    provider.value = "kyutai-pocket";
    provider.dispatch("change");

    expect(baseUrl.value).toBe("http://my-own-server.example:9999");
  });

  it("never overwrites a custom loopback URL on a non-default port — normalization matches hostnames, not every 127.0.0.1 address", () => {
    const { elements } = runProfileEditor();
    const provider = elements.get("field-tts-provider")!;
    const baseUrl = elements.get("field-tts-base-url")!;

    baseUrl.value = "http://127.0.0.1:9000"; // not a known default port for any provider
    provider.value = "kyutai-pocket";
    provider.dispatch("change");

    expect(baseUrl.value).toBe("http://127.0.0.1:9000");
  });

  it("leaves the field untouched for a provider with no known default (system, openai-compatible)", () => {
    const { elements } = runProfileEditor();
    const provider = elements.get("field-tts-provider")!;
    const baseUrl = elements.get("field-tts-base-url")!;

    baseUrl.value = "http://localhost:8004";
    provider.value = "system";
    provider.dispatch("change");

    expect(baseUrl.value).toBe("http://localhost:8004");
  });
});

describe("profileEditor.js — live connection check (GAO durable fix, 2026-11-05)", () => {
  it("posts a checkHealth message with the current form's profile when the button is clicked", () => {
    const { elements, posted } = runProfileEditor();
    elements.get("field-tts-provider")!.value = "kyutai-pocket";
    elements.get("field-tts-base-url")!.value = "http://localhost:8000";

    elements.get("btn-check-health")!.dispatch("click");

    const message = posted.at(-1) as { type: string; profile: { tts: { providerId: string; baseUrl: string } } };
    expect(message.type).toBe("checkHealth");
    expect(message.profile.tts.providerId).toBe("kyutai-pocket");
    expect(message.profile.tts.baseUrl).toBe("http://localhost:8000");
  });

  it("checks automatically when the provider changes — after the base URL auto-fill, so it probes the corrected address", () => {
    const { elements, posted } = runProfileEditor();
    elements.get("field-tts-base-url")!.value = "http://localhost:8004";

    elements.get("field-tts-provider")!.value = "kyutai-pocket";
    elements.get("field-tts-provider")!.dispatch("change");

    const message = posted.at(-1) as { type: string; profile: { tts: { baseUrl: string } } };
    expect(message.type).toBe("checkHealth");
    expect(message.profile.tts.baseUrl).toBe("http://localhost:8000");
  });

  it("checks automatically when the base URL field loses focus", () => {
    const { elements, posted } = runProfileEditor();
    elements.get("field-tts-base-url")!.value = "http://localhost:8000";

    elements.get("field-tts-base-url")!.dispatch("blur");

    expect((posted.at(-1) as { type: string }).type).toBe("checkHealth");
  });

  it("does not re-check on a blur that changed nothing — tabbing through the field without editing it stays a no-op", () => {
    const { elements, posted } = runProfileEditor();
    elements.get("field-tts-base-url")!.value = "http://localhost:8000";
    elements.get("field-tts-base-url")!.dispatch("blur");
    const checksAfterFirstBlur = posted.filter((m) => (m as { type: string }).type === "checkHealth").length;

    elements.get("field-tts-base-url")!.dispatch("blur");

    const checksAfterSecondBlur = posted.filter((m) => (m as { type: string }).type === "checkHealth").length;
    expect(checksAfterSecondBlur).toBe(checksAfterFirstBlur);
  });

  it("ignores a stale healthResult superseded by a newer check (Sentinel review: two checks racing — the later request's reply must win, regardless of arrival order)", () => {
    const { elements, posted, send } = runProfileEditor();
    const status = elements.get("connection-status")!;
    elements.get("field-tts-base-url")!.value = "http://localhost:8000";
    elements.get("field-tts-base-url")!.dispatch("blur"); // request #1
    elements.get("field-tts-provider")!.value = "kokoro";
    elements.get("field-tts-provider")!.dispatch("change"); // request #2 (supersedes #1)
    const requestIds = posted
      .filter((m) => (m as { type: string }).type === "checkHealth")
      .map((m) => (m as { requestId: number }).requestId);
    expect(requestIds).toEqual([1, 2]);

    // Request #1's reply arrives *after* request #2's — out of order.
    send({ type: "healthResult", requestId: 2, status: "ok", endpoint: "kokoro" });
    send({ type: "healthResult", requestId: 1, status: "unreachable", detail: "stale" });

    expect(status.textContent).toContain("Joignable");
    expect(status.textContent).toContain("kokoro");
  });

  it("shows a green, actionable confirmation on an 'ok' result, naming the endpoint", () => {
    const { elements, send } = runProfileEditor();
    const status = elements.get("connection-status")!;

    send({ type: "healthResult", status: "ok", endpoint: "localhost:8000/health" });

    expect(status.textContent).toContain("Joignable");
    expect(status.textContent).toContain("localhost:8000/health");
    expect(status.className).toBe("connection-ok");
  });

  it("shows a clear error on an 'unreachable' result, quoting the real detail", () => {
    const { elements, send } = runProfileEditor();
    const status = elements.get("connection-status")!;

    send({ type: "healthResult", status: "unreachable", detail: "fetch failed" });

    expect(status.textContent).toContain("Injoignable");
    expect(status.textContent).toContain("fetch failed");
    expect(status.className).toBe("connection-error");
  });

  it("clears any previous status when a different profile is loaded, so a stale result never survives a profile switch", () => {
    const { elements, send } = runProfileEditor();
    const status = elements.get("connection-status")!;
    send({ type: "healthResult", status: "ok", endpoint: "x" });
    expect(status.textContent).not.toBe("");

    send({ type: "load", profile: {}, parameters: [] });

    expect(status.textContent).toBe("");
    expect(status.className).toBe("");
  });
});

describe("profileEditor.js — the option 'Voix globale' (ADR-017 §3, V10)", () => {
  const INHERITING = {
    id: "m",
    label: "M",
    mode: "faithful",
    language: "fr-FR",
    tts: {},
    chunking: { unit: "sentence", maxSentences: 3, prefetchChunks: 2 },
    playback: { rate: 1, volume: 1 }
  };

  function lastSaved(posted: unknown[]): { tts: Record<string, unknown> } {
    const saves = posted.filter((message) => (message as { type: string }).type === "save");
    return (saves[saves.length - 1] as { profile: { tts: Record<string, unknown> } }).profile;
  }

  it("V10: saving a mode that inherits, without touching the voice, keeps `tts: {}`", () => {
    const { elements, posted, send } = runProfileEditor();
    send({
      type: "load",
      profile: INHERITING,
      parameters: [{ name: "exaggeration", label: "Exaggeration", type: "number", default: 0.5 }]
    });

    expect(elements.get("field-tts-provider")!.value).toBe("global");
    elements.get("profile-form")!.dispatch("submit");

    expect(lastSaved(posted).tts).toEqual({});
  });

  it("the option disables the fields of the voice and the settings of the engine", () => {
    const { elements, send } = runProfileEditor();
    send({ type: "load", profile: INHERITING, parameters: [] });

    expect((elements.get("field-tts-base-url") as unknown as { disabled: boolean }).disabled).toBe(true);
    expect((elements.get("field-tts-voice") as unknown as { disabled: boolean }).disabled).toBe(true);
    expect((elements.get("btn-browse-voices") as unknown as { disabled: boolean }).disabled).toBe(true);
    expect((elements.get("btn-check-health") as unknown as { disabled: boolean }).disabled).toBe(true);
    expect(elements.get("tts-parameters")!.hidden).toBe(true);
  });

  it("no connection check runs for a voice this form does not hold", () => {
    const { elements, posted, send } = runProfileEditor();
    send({ type: "load", profile: INHERITING, parameters: [] });
    elements.get("field-tts-base-url")!.dispatch("blur");
    expect(posted.filter((message) => (message as { type: string }).type === "checkHealth")).toEqual([]);
  });

  it("choosing an engine gives the mode a voice of its own, and fields to set it", () => {
    const { elements, posted, send } = runProfileEditor();
    send({ type: "load", profile: INHERITING, parameters: [] });
    const provider = elements.get("field-tts-provider")!;
    provider.value = "kyutai-pocket";
    provider.dispatch("change");

    expect((elements.get("field-tts-voice") as unknown as { disabled: boolean }).disabled).toBe(false);
    expect(elements.get("field-tts-base-url")!.value).toBe("http://localhost:8000");
    elements.get("profile-form")!.dispatch("submit");
    expect(lastSaved(posted).tts).toMatchObject({ providerId: "kyutai-pocket", baseUrl: "http://localhost:8000" });
  });

  it("choosing 'Voix globale' on a mode that has its own gives `tts: {}` back: nothing survives under it", () => {
    const { elements, posted, send } = runProfileEditor();
    send({
      type: "load",
      profile: { ...INHERITING, tts: { providerId: "chatterbox", voice: "x", referenceAudio: "/a.wav" } },
      parameters: []
    });
    expect(elements.get("field-tts-provider")!.value).toBe("chatterbox");
    const provider = elements.get("field-tts-provider")!;
    provider.value = "global";
    provider.dispatch("change");
    elements.get("profile-form")!.dispatch("submit");

    expect(lastSaved(posted).tts).toEqual({});
  });

  it("a voice of its own with no engine named stays without one: `auto` is not a guess of chatterbox", () => {
    const { elements, posted, send } = runProfileEditor();
    send({ type: "load", profile: { ...INHERITING, tts: { format: "mp3" } }, parameters: [] });
    expect(elements.get("field-tts-provider")!.value).toBe("auto");
    elements.get("profile-form")!.dispatch("submit");
    const { tts } = lastSaved(posted);
    expect(tts["format"]).toBe("mp3");
    expect(tts["providerId"]).toBeUndefined();
  });
});
