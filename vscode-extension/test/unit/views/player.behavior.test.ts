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
    hidden: false,
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
    setState,
    element,
    send: (data: unknown) => {
      for (const handler of messageHandlers) {
        handler({ data });
      }
    }
  };
}

const WAIT = {
  step: "engine",
  label: "Démarrage du moteur…",
  shortLabel: "Moteur en démarrage…",
  elapsedSeconds: 22,
  percent: 48,
  text: "Lecture dans environ 24 s",
  valueText: "Démarrage du moteur… Lecture dans environ 24 s",
  announcement: "Démarrage du moteur…"
};

describe("player.js during a wait", () => {
  it("draws the bar with its value and clear wording", () => {
    const { element, send } = runPlayer();
    send({ type: "state", state: { state: "preparing", wait: WAIT } });

    expect(element("wait").hidden).toBe(false);
    expect(element("wait-fill").style).toMatchObject({ width: "48%" });
    expect(element("wait-bar").getAttribute("aria-valuenow")).toBe("48");
    expect(element("wait-bar").getAttribute("aria-valuetext")).toBe(WAIT.valueText);
    expect(element("wait-text").textContent).toBe("Lecture dans environ 24 s");
    expect(element("wait-elapsed").textContent).toBe("22 s");
  });

  it("announces only at thresholds: the running count never reaches the live region", () => {
    const { element, send, status } = runPlayer();
    const writes: string[] = [];
    let current = "";
    Object.defineProperty(status, "textContent", {
      get: () => current,
      set: (value: string) => {
        current = value;
        writes.push(value);
      }
    });
    send({ type: "state", state: { state: "preparing", wait: WAIT } });
    send({ type: "state", state: { state: "preparing", wait: { ...WAIT, elapsedSeconds: 23, percent: 50, text: "Lecture dans environ 23 s" } } });
    send({ type: "state", state: { state: "preparing", wait: { ...WAIT, percent: 95, text: "Encore un instant…", announcement: "Encore un instant…" } } });

    expect(writes).toEqual(["Démarrage du moteur…", "Encore un instant…"]);
    expect(element("wait-elapsed").textContent).not.toContain("Démarrage");
  });

  it("shows a usual duration and a note only when the host has them", () => {
    const { element, send } = runPlayer();
    send({ type: "state", state: { state: "preparing", wait: WAIT } });
    expect(element("wait-typical").hidden).toBe(true);
    expect(element("wait-note").hidden).toBe(true);
    send({ type: "state", state: { state: "preparing", wait: { ...WAIT, typicalSeconds: 45, note: "Temps de l'IA non compté : pas encore mesuré." } } });
    expect(element("wait-typical").textContent).toBe("D'habitude environ 45 s");
    expect(element("wait-note").hidden).toBe(false);
  });

  it("Annuler stops, and the block goes away with the wait", () => {
    const { element, posted, send } = runPlayer();
    send({ type: "state", state: { state: "preparing", wait: WAIT } });
    element("btn-wait-cancel").click();
    expect(posted.at(-1)).toEqual({ type: "userAction", action: "stop" });
    send({ type: "state", state: { state: "stopped" } });
    expect(element("wait").hidden).toBe(true);
  });
});

describe("player.js, the open document", () => {
  it("offers the document and from here, and the selection only when there is one", () => {
    const { element, send } = runPlayer();
    send({ type: "document", document: { fileName: "Voice-System.md", passages: 0 } });
    expect(element("document-name").textContent).toBe("Voice-System.md");
    expect(element("document-open").hidden).toBe(false);
    expect(element("document-empty").hidden).toBe(true);
    expect(element("btn-read-selection").hidden).toBe(true);
    send({ type: "document", document: { fileName: "Voice-System.md", passages: 1 } });
    expect(element("btn-read-selection").hidden).toBe(false);
    expect(element("btn-read-selection").textContent).toBe("Lire la sélection");
  });

  it("says how many passages, and which lines", () => {
    const { element, send } = runPlayer();
    send({ type: "document", document: { fileName: "a.md", passages: 3, passagesText: "Passages : lignes 12-18, 40-44 et 90." } });
    expect(element("btn-read-selection").textContent).toBe("Lire les 3 passages");
    expect(element("document-passages").textContent).toBe("Passages : lignes 12-18, 40-44 et 90.");
  });

  it("with nothing open, asks for a file and offers the clipboard", () => {
    const { element, posted, send } = runPlayer();
    send({ type: "document", document: null });
    expect(element("document-open").hidden).toBe(true);
    expect(element("document-empty").hidden).toBe(false);
    element("btn-read-clipboard").click();
    expect(posted.at(-1)).toEqual({ type: "userAction", action: "speakClipboard" });
  });

  it("never starts anything by itself: following the editor posts nothing", () => {
    const { audio, posted, send } = runPlayer();
    const before = posted.length;
    send({ type: "document", document: { fileName: "a.md", passages: 2 } });
    send({ type: "document", document: { fileName: "b.md", passages: 0 } });
    send({ type: "document", document: null });
    expect(posted.length).toBe(before);
    expect(audio.playCalls).toBe(0);
  });

  it.each([
    ["btn-read-document", "speakCurrentDocument"],
    ["btn-read-selection", "speakSelection"],
    ["btn-read-from-here", "speakFromCursor"]
  ])("%s posts %s on a click", (id, action) => {
    const { element, posted } = runPlayer();
    element(id).click();
    expect(posted.at(-1)).toEqual({ type: "userAction", action });
  });
});

describe("player.js during a reading", () => {
  it("says the passages ahead, then that the next one is being prepared", () => {
    const { element, send } = runPlayer();
    send({ type: "state", state: { state: "playing", ahead: 3, reading: "Lecture de : Titre, lignes 42-58" } });
    expect(element("ahead").textContent).toBe("3 passages d'avance");
    expect(element("reading").textContent).toBe("Lecture de : Titre, lignes 42-58");
    send({ type: "state", state: { state: "playing", ahead: 1 } });
    expect(element("ahead").textContent).toBe("1 passage d'avance");
    send({ type: "state", state: { state: "playing", ahead: 0 } });
    expect(element("ahead").textContent).toBe("Passage suivant en préparation…");
    expect(element("reading-line").hidden).toBe(false);
  });

  it("says nothing of it when nothing follows, or outside a reading", () => {
    const { element, send } = runPlayer();
    send({ type: "state", state: { state: "playing" } });
    expect(element("reading-line").hidden).toBe(true);
    send({ type: "state", state: { state: "stopped", ahead: 2 } });
    expect(element("reading-line").hidden).toBe(true);
  });
});

describe("player.js when the engine holds back", () => {
  it("shows the mockup's words as text, with its two actions", () => {
    const { element, posted, send } = runPlayer();
    send({
      type: "state",
      state: { state: "error", notice: { title: "La voix se met en retrait pendant le jeu", body: "<b>x</b>" } }
    });
    expect(element("notice").hidden).toBe(false);
    expect(element("notice-title").textContent).toBe("La voix se met en retrait pendant le jeu");
    expect(element("notice-body").textContent).toBe("<b>x</b>");
    element("btn-notice-retry").click();
    expect(posted.at(-1)).toEqual({ type: "userAction", action: "retryHold" });
    element("btn-notice-system").click();
    expect(posted.at(-1)).toEqual({ type: "userAction", action: "readWithSystemVoice" });
  });
});

describe("the player's stylesheet", () => {
  const rule = (selector: string) => {
    const start = playerCss.indexOf(`${selector} {`);
    return playerCss.slice(start, playerCss.indexOf("}", start));
  };

  it("keeps action buttons at a fixed size, with an unwrapped label, the row wrapping instead", () => {
    expect(rule(".action-button")).toMatch(/flex: none/);
    expect(rule(".action-button")).toMatch(/height: 26px/);
    expect(rule(".action-button")).toMatch(/white-space: nowrap/);
    expect(rule(".actions")).toMatch(/flex-wrap: wrap/);
  });

  it("stops animating under reduced motion, and colours come from the theme", () => {
    expect(playerCss).toMatch(/prefers-reduced-motion: reduce\) \{\s*#wait-fill \{\s*transition: none/);
    expect(playerCss).not.toMatch(/#[0-9a-fA-F]{3,8}\s*;/);
  });
});

describe("the player's document", () => {
  const html = buildPlayerHtml({ nonce: "n", cspSource: "c", scriptUri: "s", styleUri: "t" });

  it("has a progress bar with clear wording, outside the live region", () => {
    expect(html).toContain('role="progressbar"');
    expect(html).toContain("aria-valuetext");
    expect(html.indexOf('id="wait-bar"')).toBeLessThan(html.indexOf('aria-live="polite"'));
    expect(html).not.toMatch(/aria-live="polite"[^>]*>[^<]*<\/span>\s*<span id="wait/);
  });

  it("carries the mockup's words", () => {
    for (const words of ["Lire le document", "Lire la sélection", "Lire à partir d'ici", "Ouvrez un fichier pour le lire", "Lire le presse-papiers", "Annuler", "La lecture ne démarre jamais toute seule."]) {
      expect(html).toContain(words);
    }
  });
});

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
