/**
 * Runs the real `media/player/player.js` against a minimal DOM double. Its
 * `<audio>` element stays paused here, exactly as it does under the native
 * audio engine, where the Core plays the sound and not the webview.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPlayerHtml } from "../../../src/views/player/playerHtml.js";

const playerJs = readFileSync(resolve(__dirname, "../../../media/player/player.js"), "utf8");
const playerCss = readFileSync(resolve(__dirname, "../../../media/player/player.css"), "utf8");

function makeElement() {
  const attributes: Record<string, string> = {};
  const listeners = new Map<string, () => void>();
  return {
    textContent: "",
    style: {},
    paused: true,
    playCalls: 0,
    play() {
      this.playCalls += 1;
      return Promise.resolve();
    },
    pause() {},
    load() {},
    setAttribute(name: string, value: string) {
      attributes[name] = value;
    },
    getAttribute(name: string) {
      return attributes[name];
    },
    addEventListener(type: string, handler: () => void) {
      listeners.set(type, handler);
    },
    click() {
      listeners.get("click")?.();
    },
    getBoundingClientRect: () => ({ left: 0, width: 100 })
  };
}

function runPlayer() {
  const elements = new Map<string, ReturnType<typeof makeElement>>();
  const element = (id: string) => {
    const existing = elements.get(id);
    if (existing !== undefined) {
      return existing;
    }
    const created = makeElement();
    elements.set(id, created);
    return created;
  };
  const posted: { type: string; action?: string }[] = [];
  const messageHandlers: ((event: { data: unknown }) => void)[] = [];
  const run = new Function("acquireVsCodeApi", "document", "window", playerJs);
  run(
    () => ({ postMessage: (message: { type: string; action?: string }) => posted.push(message) }),
    { getElementById: element, body: element("body") },
    { addEventListener: (_type: string, handler: (event: { data: unknown }) => void) => messageHandlers.push(handler) }
  );
  const setState = (state: string) => {
    for (const handler of messageHandlers) {
      handler({ data: { type: "state", state: { state } } });
    }
  };
  return {
    audio: element("audio"),
    body: element("body"),
    playPause: element("btn-play-pause"),
    status: element("status"),
    stop: element("btn-stop"),
    posted,
    setState
  };
}

describe("player.js play/pause button under the native engine", () => {
  it("sends pause while the host reports playing, even though the webview's audio element is paused", () => {
    const { playPause, posted, setState } = runPlayer();
    setState("playing");

    playPause.click();

    expect(posted.at(-1)).toEqual({ type: "userAction", action: "pause" });
  });

  it("sends play once the host reports paused", () => {
    const { playPause, posted, setState } = runPlayer();
    setState("paused");

    playPause.click();

    expect(posted.at(-1)).toEqual({ type: "userAction", action: "play" });
  });
});

describe("player.js play/pause button while a session is loading", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["preparing", "buffering"])("shows a cancel action instead of a dead play button (%s)", (state) => {
    const { playPause, setState } = runPlayer();

    setState(state);

    expect(playPause.textContent).toBe("✕");
    expect(playPause.getAttribute("aria-label")).toContain("Annuler");
    expect(playPause.getAttribute("title")).toBe(playPause.getAttribute("aria-label"));
  });

  it.each([
    ["preparing", "Préparation de la voix…"],
    ["buffering", "Préparation du segment suivant…"]
  ])("tells what is happening (%s)", (state, text) => {
    const { status, setState } = runPlayer();

    setState(state);

    expect(status.textContent).toBe(text);
  });

  it.each(["preparing", "buffering"])("stops the session on click, and never asks to play (%s)", (state) => {
    const { playPause, posted, setState } = runPlayer();
    setState(state);

    playPause.click();

    expect(posted.at(-1)).toEqual({ type: "userAction", action: "stop" });
    expect(posted.filter((message) => message.action === "play")).toEqual([]);
  });

  it.each([
    ["playing", "⏸", "Pause"],
    ["paused", "▶", "Lecture"],
    ["stopped", "▶", "Lecture"]
  ])("gives the button back and clears the message once the state becomes %s", (state, glyph, label) => {
    const { playPause, status, setState } = runPlayer();
    setState("preparing");

    setState(state);

    expect(playPause.textContent).toBe(glyph);
    expect(playPause.getAttribute("aria-label")).toBe(label);
    expect(playPause.getAttribute("title")).toBe(label);
    expect(status.textContent).toBe("");
  });

  it("does not turn a double click on cancel into a new reading", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { playPause, posted, setState } = runPlayer();
    setState("preparing");

    playPause.click();
    setState("stopped");
    vi.advanceTimersByTime(200);
    playPause.click();

    expect(posted.filter((message) => message.action === "play")).toEqual([]);
  });

  it("lets a deliberate click start again after the cancel", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { playPause, posted, setState } = runPlayer();
    setState("preparing");

    playPause.click();
    setState("stopped");
    vi.advanceTimersByTime(2000);
    playPause.click();

    expect(posted.at(-1)).toEqual({ type: "userAction", action: "play" });
  });

  it("starts nothing by itself: state changes alone post no action and touch no audio", () => {
    const { audio, posted, setState } = runPlayer();

    for (const state of ["preparing", "buffering", "stopped", "preparing", "error", "idle"]) {
      setState(state);
    }

    expect(posted).toEqual([{ type: "ready" }]);
    expect(audio.playCalls).toBe(0);
  });
});

describe("player document and styles for the loading state", () => {
  const html = buildPlayerHtml({ nonce: "NONCE", cspSource: "src", scriptUri: "script", styleUri: "style" });

  it("declares every element player.js looks up", () => {
    const ids = [...playerJs.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);

    expect(ids).toContain("status");
    for (const id of ids) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it("announces the message to assistive technology", () => {
    expect(html).toMatch(/id="status"[^>]*role="status"[^>]*aria-live="polite"/);
  });

  it("keeps transport buttons at a fixed size whatever glyph they show", () => {
    const rule = /\.transport-button \{([^}]*)\}/.exec(playerCss)?.[1] ?? "";

    expect(rule).toMatch(/\bwidth: \d+px;/);
    expect(rule).toMatch(/\bheight: \d+px;/);
    expect(rule).toContain("flex: none;");
    expect(rule).toContain("white-space: nowrap;");
  });

  it("colours the message from the theme and cuts it on one line", () => {
    const rule = /#status \{([^}]*)\}/.exec(playerCss)?.[1] ?? "";

    expect(rule).toContain("color: var(--vscode-descriptionForeground);");
    expect(rule).toContain("white-space: nowrap;");
    expect(rule).toContain("text-overflow: ellipsis;");
  });

  it("uses no emoji-presentation cross on the cancel button", () => {
    expect(playerJs).toContain('"✕"');
    expect(playerJs).not.toContain("✖");
    expect(playerJs).not.toContain("❌");
  });
});
