/**
 * Runs the real `media/voiceGallery/voiceGallery.js` against a minimal DOM double,
 * in the style of `player.behavior.test.ts`. What it proves: nothing plays and
 * nothing is asked of an engine without a click, and the page only ever states what
 * the host told it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildVoiceGalleryHtml } from "../../../src/views/voiceGallery/voiceGalleryHtml.js";

const galleryJs = readFileSync(resolve(__dirname, "../../../media/voiceGallery/voiceGallery.js"), "utf8");
const galleryCss = readFileSync(resolve(__dirname, "../../../media/voiceGallery/voiceGallery.css"), "utf8");

type Listener = (event: { target: FakeElement }) => void;

class FakeElement {
  textContent = "";
  value = "";
  hidden = false;
  disabled = false;
  paused = true;
  currentTime = 0;
  duration = Number.NaN;
  src: string | undefined;
  playCalls = 0;
  pauseCalls = 0;
  innerHTMLWrites = 0;
  readonly attributes: Record<string, string> = {};
  readonly classes = new Set<string>();
  readonly children: FakeElement[] = [];
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  parent: FakeElement | undefined;
  private readonly listeners = new Map<string, Listener[]>();

  readonly classList = {
    add: (...names: string[]) => names.forEach((name) => this.classes.add(name)),
    remove: (...names: string[]) => names.forEach((name) => this.classes.delete(name)),
    toggle: (name: string, force?: boolean) => {
      const on = force ?? !this.classes.has(name);
      if (on) {
        this.classes.add(name);
      } else {
        this.classes.delete(name);
      }
      return on;
    },
    contains: (name: string) => this.classes.has(name)
  };

  constructor(readonly tag: string) {}

  set className(names: string) {
    this.classes.clear();
    names.split(/\s+/).filter(Boolean).forEach((name) => this.classes.add(name));
  }

  set innerHTML(_value: string) {
    this.innerHTMLWrites += 1;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  getAttribute(name: string): string | undefined {
    return this.attributes[name];
  }

  removeAttribute(name: string): void {
    delete this.attributes[name];
    if (name === "src") {
      this.src = undefined;
    }
  }

  appendChild(child: FakeElement): FakeElement {
    child.parent?.removeChild(child);
    child.parent = this;
    this.children.push(child);
    return child;
  }

  append(...children: FakeElement[]): void {
    children.forEach((child) => this.appendChild(child));
  }

  removeChild(child: FakeElement): void {
    const at = this.children.indexOf(child);
    if (at >= 0) {
      this.children.splice(at, 1);
    }
    child.parent = undefined;
  }

  replaceChildren(...children: FakeElement[]): void {
    [...this.children].forEach((child) => this.removeChild(child));
    children.forEach((child) => this.appendChild(child));
  }

  addEventListener(type: string, handler: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler]);
  }

  fire(type: string): void {
    for (const handler of this.listeners.get(type) ?? []) {
      handler({ target: this });
    }
  }

  click(): void {
    this.fire("click");
  }

  focus(): void {}

  play(): Promise<void> {
    this.playCalls += 1;
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.pauseCalls += 1;
    this.paused = true;
  }

  load(): void {}

  /** Every descendant, depth first. */
  all(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.all()]);
  }

  buttonNamed(text: string): FakeElement | undefined {
    return this.all().find((element) => element.tag === "button" && element.textContent === text && !element.hidden);
  }
}

interface CardInput {
  id: string;
  label: string;
  section?: "local" | "kyutai16" | "kyutai" | "prepare";
  ready?: boolean;
  sampleUri?: string;
  canChoose?: boolean;
  canListen?: boolean;
  engine?: "kyutai" | "kyutai16" | "kokoro" | "chatterbox";
  state?: string;
  detail?: string;
  prepare?: string;
  prepareLabel?: string;
}

function card(input: CardInput): Record<string, unknown> {
  return { section: "kyutai", ready: false, canChoose: true, canListen: true, ...input };
}

const CARDS = [
  card({ id: "system", label: "Voix système", section: "local", ready: true, state: "Prête" }),
  card({ id: "estelle", label: "Estelle", sampleUri: "https://file+.vscode-resource.vscode-cdn.net/voices/estelle.ogg", engine: "kyutai" }),
  card({ id: "eponine", label: "Éponine", sampleUri: "https://file+.vscode-resource.vscode-cdn.net/voices/eponine.ogg", engine: "kyutai" }),
  card({
    id: "chatterbox",
    label: "Chatterbox",
    section: "prepare",
    canChoose: false,
    canListen: false,
    prepare: "chatterbox",
    prepareLabel: "Préparer"
  })
];

function state(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "state",
    cards: CARDS,
    activeId: "estelle",
    activeLabel: "Estelle",
    favorites: [],
    engines: {
      kyutai: { status: "started", command: "pocket-tts serve --language french" },
      kokoro: { status: "stopped", command: "kokoro cmd" },
      chatterbox: { status: "stopped", command: "chatterbox cmd" }
    },
    credits: {
      subtitle: "D'où viennent les voix",
      groups: [{ source: "VCTK", licence: "CC BY 4.0, modifié", voices: "Anna", note: "Retravaillé." }],
      clause: "Il est interdit de cloner une voix sans consentement.",
      links: [{ label: "Voir les licences", url: "https://creativecommons.org/licenses/by/4.0/" }]
    },
    ...overrides
  };
}

function runGallery() {
  const elements = new Map<string, FakeElement>();
  const element = (id: string): FakeElement => {
    const existing = elements.get(id);
    if (existing !== undefined) {
      return existing;
    }
    const created = new FakeElement(id === "audio" ? "audio" : id.includes("-") ? "div" : "input");
    elements.set(id, created);
    return created;
  };
  const posted: { type: string; [key: string]: unknown }[] = [];
  const handlers: ((event: { data: unknown }) => void)[] = [];
  const intervals = new Map<number, () => void>();
  let nextInterval = 1;
  const run = new Function("acquireVsCodeApi", "document", "window", galleryJs);
  run(
    () => ({ postMessage: (message: { type: string }) => posted.push(message) }),
    {
      getElementById: element,
      createElement: (tag: string) => new FakeElement(tag),
      createElementNS: (_ns: string, tag: string) => new FakeElement(tag)
    },
    {
      addEventListener: (_type: string, handler: (event: { data: unknown }) => void) => handlers.push(handler),
      setInterval: (callback: () => void) => {
        const id = nextInterval++;
        intervals.set(id, callback);
        return id;
      },
      clearInterval: (id: number) => intervals.delete(id)
    }
  );
  const receive = (data: unknown): void => handlers.forEach((handler) => handler({ data }));
  const cardOf = (id: string): FakeElement => {
    const found = ["cards-local", "cards-kyutai16", "cards-kyutai", "cards-prepare"]
      .flatMap((section) => element(section).children)
      .find((candidate) => candidate.dataset.voiceId === id);
    if (found === undefined) {
      throw new Error(`no card for ${id}`);
    }
    return found;
  };
  const visibleCards = (): string[] =>
    ["cards-local", "cards-kyutai16", "cards-kyutai", "cards-prepare"]
      .flatMap((section) => element(section).children)
      .filter((candidate) => !candidate.hidden)
      .map((candidate) => candidate.dataset.voiceId ?? "");
  const tick = (): void => [...intervals.values()].forEach((callback) => callback());
  return { element, posted, receive, cardOf, visibleCards, tick, intervals, audio: element("audio") };
}

function button(parent: FakeElement, text: string): FakeElement {
  const found = parent.buttonNamed(text);
  if (found === undefined) {
    throw new Error(`no visible button "${text}"`);
  }
  return found;
}

describe("listening never starts without a click", () => {
  it("opening and every state the host sends play nothing and request nothing", () => {
    const { audio, posted, receive } = runGallery();

    receive(state());
    receive(state({ activeId: "system" }));
    receive(state({ engines: { kyutai: { status: "stopped", command: "c" } } }));

    expect(posted).toEqual([{ type: "ready" }]);
    expect(audio.playCalls).toBe(0);
    expect(audio.src).toBeUndefined();
  });

  it("an audio file the page did not ask for is never played", () => {
    const { audio, receive } = runGallery();
    receive(state());

    receive({ type: "trialAudio", requestId: 1, voiceId: "estelle", uri: "https://file+.vscode-resource.vscode-cdn.net/evil.wav" });

    expect(audio.playCalls).toBe(0);
    expect(audio.src).toBeUndefined();
  });

  it("an audio address outside the webview resources is never played", () => {
    const { audio, posted, receive, cardOf } = runGallery();
    receive(state());
    button(cardOf("estelle"), "Écouter").click();
    const requestId = posted.at(-1)?.requestId;
    const before = { calls: audio.playCalls, src: audio.src };

    receive({ type: "trialAudio", requestId, voiceId: "estelle", uri: "javascript:alert(1)" });

    expect(audio.playCalls).toBe(before.calls);
    expect(audio.src).toBe(before.src);
    expect(String(audio.src ?? "")).not.toContain("javascript:");
  });

  it("the document carries no audio source and no autoplay", () => {
    const html = buildVoiceGalleryHtml({ nonce: "N", cspSource: "src", scriptUri: "s", styleUri: "c" });
    const tag = /<audio\b[^>]*>/.exec(html)?.[0] ?? "";

    expect(tag).toContain('preload="none"');
    expect(tag).not.toContain("src=");
    expect(html).not.toContain("autoplay");
    expect(galleryJs).not.toContain("autoplay");
  });
});

describe("Écouter", () => {
  it("plays the included sample on click, without a word to the host", () => {
    const { audio, posted, receive, cardOf } = runGallery();
    receive(state({ engines: { kyutai: { status: "stopped", command: "c" } } }));

    button(cardOf("estelle"), "Écouter").click();

    expect(audio.src).toBe("https://file+.vscode-resource.vscode-cdn.net/voices/estelle.ogg");
    expect(audio.playCalls).toBe(1);
    expect(posted).toEqual([{ type: "ready" }]);
  });

  it("switching voice stops the first one, and Arrêter stops the second", () => {
    const { audio, receive, cardOf } = runGallery();
    receive(state());

    button(cardOf("estelle"), "Écouter").click();
    button(cardOf("eponine"), "Écouter").click();

    expect(audio.src).toBe("https://file+.vscode-resource.vscode-cdn.net/voices/eponine.ogg");
    expect(audio.pauseCalls).toBeGreaterThan(0);
    expect(cardOf("estelle").buttonNamed("Arrêter")).toBeUndefined();

    button(cardOf("eponine"), "Arrêter").click();
    expect(audio.paused).toBe(true);
    expect(cardOf("eponine").buttonNamed("Écouter")).toBeDefined();
  });

  it("shows time while playing, and says afterwards it has been heard", () => {
    const { audio, receive, cardOf } = runGallery();
    receive(state());
    button(cardOf("estelle"), "Écouter").click();

    audio.duration = 5;
    audio.currentTime = 2;
    audio.fire("timeupdate");
    expect(cardOf("estelle").all().some((element) => element.textContent === "00:02 / 00:05")).toBe(true);

    audio.fire("ended");
    expect(cardOf("estelle").all().some((element) => element.textContent === "Déjà écoutée")).toBe(true);
    expect(cardOf("estelle").buttonNamed("Écouter")).toBeDefined();
  });

  it("says so on the card when a sample cannot be read", () => {
    const { audio, receive, cardOf } = runGallery();
    receive(state());
    button(cardOf("estelle"), "Écouter").click();

    audio.fire("error");

    expect(cardOf("estelle").all().some((element) => element.textContent.includes("illisible"))).toBe(true);
    expect(cardOf("estelle").buttonNamed("Écouter")).toBeDefined();
  });

  it("a voice with no sample asks its engine, on click only", () => {
    const { posted, receive, cardOf } = runGallery();
    receive(state());

    button(cardOf("system"), "Écouter").click();

    expect(posted.at(-1)).toMatchObject({ type: "trial", voiceId: "system", text: "" });
  });
});

describe("phrase d'essai", () => {
  function typed() {
    const gallery = runGallery();
    gallery.receive(state());
    gallery.element("phrase").value = "  Ma phrase à moi.  ";
    return gallery;
  }

  it("typing sends nothing; the click sends the phrase, and nothing plays before the audio comes back", () => {
    const { audio, posted, cardOf, element } = typed();

    element("phrase").fire("input");
    expect(posted).toEqual([{ type: "ready" }]);

    button(cardOf("estelle"), "Écouter").click();

    expect(posted.at(-1)).toMatchObject({ type: "trial", voiceId: "estelle", text: "Ma phrase à moi." });
    expect(audio.playCalls).toBe(0);
  });

  it("shows elapsed time with Annuler, then plays the audio the host answers with", () => {
    const { audio, posted, receive, cardOf, tick } = typed();
    button(cardOf("estelle"), "Écouter").click();
    const requestId = posted.at(-1)?.requestId;

    expect(cardOf("estelle").all().some((element) => element.textContent.startsWith("Génération"))).toBe(true);
    expect(cardOf("estelle").buttonNamed("Annuler")).toBeDefined();
    const start = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(start + 3000);
    tick();
    vi.restoreAllMocks();
    expect(cardOf("estelle").all().some((element) => element.textContent === "Génération… 3 s")).toBe(true);

    receive({ type: "trialAudio", requestId, voiceId: "estelle", uri: "https://file+.vscode-resource.vscode-cdn.net/trial/a.wav" });

    expect(audio.src).toBe("https://file+.vscode-resource.vscode-cdn.net/trial/a.wav");
    expect(audio.playCalls).toBe(1);
  });

  it("Annuler tells the host and a late answer then plays nothing", () => {
    const { audio, posted, receive, cardOf, intervals } = typed();
    button(cardOf("estelle"), "Écouter").click();
    const requestId = posted.at(-1)?.requestId;

    button(cardOf("estelle"), "Annuler").click();

    expect(posted.at(-1)).toEqual({ type: "cancelTrial", requestId });
    expect(intervals.size).toBe(0);
    receive({ type: "trialAudio", requestId, voiceId: "estelle", uri: "https://file+.vscode-resource.vscode-cdn.net/trial/late.wav" });
    expect(audio.playCalls).toBe(0);
  });

  it("Rétablir empties the phrase: the sample plays again", () => {
    const { audio, posted, cardOf, element } = typed();

    element("phrase-reset").click();
    button(cardOf("estelle"), "Écouter").click();

    expect(element("phrase").value).toBe("");
    expect(audio.src).toBe("https://file+.vscode-resource.vscode-cdn.net/voices/estelle.ogg");
    expect(posted).toEqual([{ type: "ready" }]);
  });

  it("server stopped: says it, gives the command to copy, starts nothing", () => {
    const { posted, receive, cardOf, element } = typed();
    button(cardOf("estelle"), "Écouter").click();
    const requestId = posted.at(-1)?.requestId;

    receive({ type: "trialStopped", requestId, voiceId: "estelle", engine: "kyutai" });

    expect(element("server-banner").hidden).toBe(false);
    expect(element("banner-title").textContent).toContain("arrêté");
    expect(element("banner-command").textContent).toBe("pocket-tts serve --language french");
    expect(cardOf("estelle").buttonNamed("Écouter")).toBeDefined();

    element("banner-copy").click();
    expect(posted.at(-1)).toEqual({ type: "copyCommand", engine: "kyutai" });
    expect(posted.map((message) => message.type)).not.toContain("startServer");
  });
});

describe("Choisir", () => {
  it("asks the host, then the card follows the host's answer without being rebuilt", () => {
    const { posted, receive, cardOf } = runGallery();
    receive(state());
    const before = cardOf("eponine");
    expect(button(cardOf("estelle"), "Choisie")).toBeDefined();

    button(before, "Choisir").click();
    expect(posted.at(-1)).toEqual({ type: "choose", voiceId: "eponine" });
    expect(before.buttonNamed("Choisie")).toBeUndefined();

    receive(state({ activeId: "eponine", activeLabel: "Éponine" }));

    expect(cardOf("eponine")).toBe(before);
    expect(before.buttonNamed("Choisie")).toBeDefined();
    expect(cardOf("estelle").buttonNamed("Choisir")).toBeDefined();
    expect(before.classes.has("active")).toBe(true);
    expect(cardOf("estelle").classes.has("active")).toBe(false);
  });

  it("clicking the voice already chosen sends nothing", () => {
    const { posted, receive, cardOf } = runGallery();
    receive(state());

    button(cardOf("estelle"), "Choisie").click();

    expect(posted).toEqual([{ type: "ready" }]);
  });

  it("names the current voice in the header", () => {
    const { element, receive } = runGallery();

    receive(state({ activeId: undefined, activeLabel: "Votre échantillon" }));

    expect(element("current-voice").textContent).toBe("Votre échantillon");
  });

  it("offers Préparer where a voice cannot be chosen, and writes nothing", () => {
    const { posted, receive, cardOf } = runGallery();
    receive(state());

    expect(cardOf("chatterbox").buttonNamed("Choisir")).toBeUndefined();
    button(cardOf("chatterbox"), "Préparer").click();

    expect(posted.at(-1)).toEqual({ type: "prepare", target: "chatterbox" });
  });
});

describe("recherche et filtres", () => {
  it("search ignores case and accents, and hides what does not match", () => {
    const { element, receive, visibleCards } = runGallery();
    receive(state());

    element("search").value = "EPONI";
    element("search").fire("input");

    expect(visibleCards()).toEqual(["eponine"]);
    expect(element("section-local").hidden).toBe(true);
    expect(element("section-kyutai").hidden).toBe(false);
  });

  it("says when nothing matches", () => {
    const { element, receive, visibleCards } = runGallery();
    receive(state());

    element("search").value = "zzz";
    element("search").fire("input");

    expect(visibleCards()).toEqual([]);
    expect(element("empty").hidden).toBe(false);
  });

  it("Prêtes keeps only what can speak now", () => {
    const { element, receive, visibleCards } = runGallery();
    receive(state());

    element("filter-ready").click();

    expect(visibleCards()).toEqual(["system"]);
    expect(element("filter-ready").getAttribute("aria-pressed")).toBe("true");
    expect(element("filter-all").getAttribute("aria-pressed")).toBe("false");
  });

  it("Favorites shows what the host stored; the star only asks", () => {
    const { element, posted, receive, cardOf, visibleCards } = runGallery();
    receive(state());
    element("filter-favorites").click();
    expect(visibleCards()).toEqual([]);

    const star = cardOf("eponine").all().find((candidate) => candidate.classes.has("star"));
    star?.click();
    expect(posted.at(-1)).toEqual({ type: "favorite", voiceId: "eponine", favorite: true });
    expect(visibleCards(), "nothing is kept by the page itself").toEqual([]);

    receive(state({ favorites: ["eponine"] }));
    expect(visibleCards()).toEqual(["eponine"]);
    expect(star?.getAttribute("aria-pressed")).toBe("true");

    star?.click();
    expect(posted.at(-1)).toEqual({ type: "favorite", voiceId: "eponine", favorite: false });
  });

  it("keeps no favourite in the page's own storage", () => {
    expect(galleryJs).not.toMatch(/\bsetState\b|localStorage|sessionStorage|indexedDB/);
  });

  it("keeps the same filter when the host sends a new state", () => {
    const { element, receive, visibleCards } = runGallery();
    receive(state());
    element("filter-ready").click();

    receive(state({ activeId: "system" }));

    expect(visibleCards()).toEqual(["system"]);
  });
});

describe("état du serveur et crédits", () => {
  it("a stopped Kyutai server shows at once, with its command", () => {
    const { element, receive } = runGallery();

    receive(state({ engines: { kyutai: { status: "stopped", command: "pocket-tts serve --language french" } } }));

    expect(element("server-banner").hidden).toBe(false);
    expect(element("kyutai-status").textContent).toBe("Serveur arrêté");
    expect(element("banner-command").textContent).toBe("pocket-tts serve --language french");
  });

  it("a started server hides the banner and Vérifier asks again", () => {
    const { element, posted, receive } = runGallery();
    receive(state({ engines: { kyutai: { status: "stopped", command: "c" } } }));

    element("banner-check").click();
    expect(posted.at(-1)).toEqual({ type: "refreshHealth" });

    receive(state());
    expect(element("server-banner").hidden).toBe(true);
    expect(element("kyutai-status").textContent).toBe("Serveur démarré");
  });

  it("opens the credits, returns, and asks the host to open a link", () => {
    const { element, posted, receive } = runGallery();
    receive(state());

    element("open-credits").click();
    expect(element("gallery-view").hidden).toBe(true);
    expect(element("credits-view").hidden).toBe(false);
    expect(element("credits-clause").textContent).toContain("interdit");

    button(element("credits-links"), "Voir les licences").click();
    expect(posted.at(-1)).toEqual({ type: "openLink", url: "https://creativecommons.org/licenses/by/4.0/" });

    element("credits-back").click();
    expect(element("gallery-view").hidden).toBe(false);
    expect(element("credits-view").hidden).toBe(true);
  });

  it("creates no anchor: a link can only go through the host", () => {
    const { element, receive } = runGallery();
    receive(state());

    expect(element("credits-links").all().filter((candidate) => candidate.tag === "a")).toEqual([]);
    expect(galleryJs).not.toMatch(/createElement\("a"\)|window\.open|location\.href/);
  });
});

describe("the document and its styles", () => {
  const html = buildVoiceGalleryHtml({ nonce: "NONCE", cspSource: "src", scriptUri: "script", styleUri: "style" });

  it("declares every element voiceGallery.js looks up", () => {
    const ids = [...galleryJs.matchAll(/\bget\("([^"]+)"\)/g)].map((match) => match[1]);

    expect(ids.length).toBeGreaterThan(10);
    for (const id of ids) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it("every button is fixed: never stretched, never on two lines", () => {
    const rule = /(?:^|\n)\.button \{([^}]*)\}/.exec(galleryCss)?.[1] ?? "";

    expect(rule).toContain("flex: 0 0 auto;");
    expect(rule).toContain("white-space: nowrap;");
    expect(galleryCss).not.toMatch(/white-space:\s*(normal|pre-wrap|pre-line|break-spaces)/);
    expect(galleryCss).not.toMatch(/\.button[^{]*\{[^}]*(width:\s*100%|flex-grow|flex:\s*1|align-self:\s*stretch)/);
    for (const tag of [...html.matchAll(/<button\b[^>]*>/g)].map((match) => match[0])) {
      expect(tag).toContain('class="button');
    }
    expect(galleryJs).toMatch(/className = "button/);
  });

  it("keeps a button out of any flex child that could stretch it", () => {
    for (const selector of [".card-head", ".card-actions", ".toolbar", ".banner", ".section-head"]) {
      const rule = new RegExp(`\\${selector} \\{([^}]*)\\}`).exec(galleryCss)?.[1] ?? "";
      expect(rule, selector).toContain("display: flex;");
      expect(rule, selector).not.toContain("flex-direction: column;");
      expect(rule, selector).not.toContain("align-items: stretch;");
    }
  });

  it("stays usable narrow and wide: cards flow by available width, the toolbars wrap", () => {
    expect(galleryCss).toMatch(/grid-template-columns: repeat\(auto-fill, minmax\(min\(100%, \d+px\), 1fr\)\)/);
    expect(/\.toolbar \{([^}]*)\}/.exec(galleryCss)?.[1]).toContain("flex-wrap: wrap;");
    expect(galleryCss).toMatch(/max-width: 1400px/);
  });

  it("colours come from the theme only", () => {
    const colours = galleryCss.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/g) ?? [];
    expect(colours).toEqual([]);
    for (const declaration of galleryCss.matchAll(/(?:^|[\s;{])(?:color|background(?:-color)?|border(?:-[a-z]+)?-color|fill):\s*([^;]+);/g)) {
      expect(declaration[1]).toMatch(/var\(--vscode-|^(transparent|currentColor|inherit)$/);
    }
  });

  it("has no emoji and no inline style", () => {
    const emoji = /\p{Extended_Pictographic}/u;
    expect(emoji.test(html)).toBe(false);
    expect(emoji.test(galleryJs)).toBe(false);
    expect(html).not.toMatch(/\sstyle="/);
    expect(galleryJs).not.toMatch(/setAttribute\("style"/);
  });

  it("uses the mockup's words", () => {
    for (const text of [
      "Choisir une voix",
      "Prêtes sur cette machine",
      "Kyutai Pocket TTS",
      "À préparer",
      "Crédits et licences",
      "Rétablir",
      "Rechercher une voix"
    ]) {
      expect(html).toContain(text);
    }
  });
});

describe("the Kyutai narration section", () => {
  const COMMAND = "docker compose -f deploy/docker-compose.tts.yml up -d kyutai16";
  const NARRATION = [
    card({ id: "kyutai16:cml-577_394", label: "Camille", section: "kyutai16", engine: "kyutai16", canChoose: false, state: "Non prête", detail: "CML-TTS, CC BY 4.0." }),
    card({ id: "kyutai16:estelle", label: "Estelle", section: "kyutai16", engine: "kyutai16", canChoose: false, state: "Non prête", detail: "Unmute, CC0." })
  ];
  const cardText = (root: FakeElement): string => root.all().map((child) => child.textContent).join(" ");
  const stopped = {
    kyutai: { status: "started", command: "pocket" },
    kyutai16: { status: "stopped", command: COMMAND }
  };

  it("sits before Pocket's, Camille first", () => {
    const html = buildVoiceGalleryHtml({ nonce: "n", cspSource: "c", scriptUri: "s", styleUri: "t" });
    expect(html.indexOf('id="section-kyutai16"')).toBeGreaterThan(0);
    expect(html.indexOf('id="section-kyutai16"')).toBeLessThan(html.indexOf('id="section-kyutai"'));
    const { element, receive } = runGallery();
    receive(state({ cards: NARRATION, engines: stopped }));
    expect(element("cards-kyutai16").children.map((child) => child.dataset.voiceId)).toEqual(["kyutai16:cml-577_394", "kyutai16:estelle"]);
  });

  it("server stopped: says so, shows the command to copy, and the cards stay visible and listenable", () => {
    const { element, posted, receive, cardOf, visibleCards } = runGallery();
    receive(state({ cards: NARRATION, engines: stopped, kyutai16Note: "Accent non documenté." }));

    expect(element("kyutai16-status").textContent).toBe("Serveur arrêté");
    expect(element("kyutai16-server").hidden).toBe(false);
    expect(element("kyutai16-command").textContent).toBe(COMMAND);
    expect(element("kyutai16-note").textContent).toBe("Accent non documenté.");
    expect(visibleCards()).toContain("kyutai16:cml-577_394");
    expect(element("section-kyutai16").hidden).toBe(false);
    const camille = cardOf("kyutai16:cml-577_394");
    expect(camille.buttonNamed("Choisir")).toBeUndefined();
    expect(button(camille, "Écouter").hidden).toBe(false);

    element("kyutai16-copy").click();
    expect(posted).toContainEqual({ type: "copyCommand", engine: "kyutai16" });
    element("kyutai16-check").click();
    expect(posted).toContainEqual({ type: "refreshHealth" });
  });

  it("server started: the command goes away", () => {
    const { element, receive } = runGallery();
    receive(state({ cards: NARRATION, engines: { kyutai16: { status: "started", command: COMMAND } } }));

    expect(element("kyutai16-status").textContent).toBe("Serveur démarré");
    expect(element("kyutai16-status").classes.has("state-ok")).toBe(true);
    expect(element("kyutai16-server").hidden).toBe(true);
  });

  it("no sample: Écouter asks the host, with the phrase, and plays only the answer", () => {
    const { audio, element, posted, receive, cardOf } = runGallery();
    receive(state({ cards: NARRATION, engines: stopped }));
    element("phrase").value = "Une phrase à moi.";

    button(cardOf("kyutai16:cml-577_394"), "Écouter").click();

    expect(posted).toContainEqual({ type: "trial", voiceId: "kyutai16:cml-577_394", text: "Une phrase à moi.", requestId: 1 });
    expect(audio.playCalls).toBe(0);
    receive({ type: "trialAudio", requestId: 1, voiceId: "kyutai16:cml-577_394", uri: "https://file+.vscode-resource.vscode-cdn.net/trial/c.wav" });
    expect(audio.src).toBe("https://file+.vscode-resource.vscode-cdn.net/trial/c.wav");
    expect(audio.playCalls).toBe(1);
  });

  it("a stopped server is told on the card and in the section, not by Pocket's banner", () => {
    const { element, receive, cardOf } = runGallery();
    receive(state({ cards: NARRATION, engines: { ...stopped, kyutai16: { status: "started", command: COMMAND } } }));
    button(cardOf("kyutai16:cml-577_394"), "Écouter").click();

    receive({ type: "trialStopped", requestId: 1, voiceId: "kyutai16:cml-577_394", engine: "kyutai16" });

    expect(cardText(cardOf("kyutai16:cml-577_394"))).toContain("Serveur arrêté.");
    expect(element("kyutai16-status").textContent).toBe("Serveur arrêté");
    expect(element("kyutai16-server").hidden).toBe(false);
    expect(element("server-banner").hidden).toBe(true);
  });

  it("a server's error, such as the game mode, reaches the card as text", () => {
    const { receive, cardOf } = runGallery();
    receive(state({ cards: NARRATION, engines: stopped }));
    button(cardOf("kyutai16:cml-577_394"), "Écouter").click();

    receive({ type: "trialError", requestId: 1, voiceId: "kyutai16:cml-577_394", message: "Mode jeu actif (gpu-yield)" });

    expect(cardText(cardOf("kyutai16:cml-577_394"))).toContain("Mode jeu actif (gpu-yield)");
  });

  it("its credits button opens the credits", () => {
    const { element, receive } = runGallery();
    receive(state({ cards: NARRATION, engines: stopped }));
    element("kyutai16-credits").click();
    expect(element("credits-view").hidden).toBe(false);
    expect(element("gallery-view").hidden).toBe(true);
  });
});
