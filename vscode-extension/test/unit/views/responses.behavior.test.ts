/**
 * Runs the real `media/player/responses.js` against a small DOM double, in both of
 * its pages: the panel's block and the view "Réponses". Made-up replies only.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPlayerHtml } from "../../../src/views/player/playerHtml.js";
import { buildResponsesHtml } from "../../../src/views/inbox/responsesHtml.js";

const ROOT = resolve(__dirname, "../../..");
const script = readFileSync(resolve(ROOT, "media/player/responses.js"), "utf8");
const css = readFileSync(resolve(ROOT, "media/player/responses.css"), "utf8");

interface FakeEvent {
  key?: string;
  stopPropagation(): void;
  preventDefault(): void;
}

class FakeElement {
  textContent = "";
  hidden = false;
  className = "";
  children: FakeElement[] = [];
  attributes: Record<string, string> = {};
  listeners = new Map<string, (event: FakeEvent) => void>();
  focused = 0;
  constructor(readonly tag: string, private readonly page?: { activeElement: FakeElement | null }) {}
  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }
  replaceChildren(...children: FakeElement[]): void {
    this.children = children;
  }
  remove(): void {
    this.removed = true;
  }
  removed = false;
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }
  addEventListener(type: string, handler: (event: FakeEvent) => void): void {
    this.listeners.set(type, handler);
  }
  focus(): void {
    this.focused += 1;
    if (this.page !== undefined) {
      this.page.activeElement = this;
    }
  }
  getBoundingClientRect(): { bottom: number } {
    return { bottom: 10 };
  }
  click(): void {
    this.listeners.get("click")?.({ stopPropagation() {}, preventDefault() {} });
  }
  key(key: string): void {
    this.listeners.get("keydown")?.({ key, stopPropagation() {}, preventDefault() {} });
  }
  /** Every descendant, this one first. */
  all(): FakeElement[] {
    return [this, ...this.children.flatMap((child) => child.all())];
  }
  texts(): string[] {
    return this.all()
      .map((element) => element.textContent)
      .filter((text) => text.length > 0);
  }
  byClass(name: string): FakeElement[] {
    return this.all().filter((element) => element.className.split(" ").includes(name));
  }
}

const PANEL_IDS = [...buildPlayerHtml({ nonce: "n", cspSource: "c", scriptUri: "s", styleUri: "t" }).matchAll(/id="([^"]+)"/g)].map((m) => m[1] as string);
const LIST_IDS = [...buildResponsesHtml({ nonce: "n", cspSource: "c", scriptUri: "s", styleUri: "t" }).matchAll(/id="([^"]+)"/g)].map((m) => m[1] as string);

function run(ids: readonly string[], options: { shareApi: boolean }) {
  const page: { activeElement: FakeElement | null } = { activeElement: null };
  const elements = new Map(ids.map((id) => [id, new FakeElement("div", page)]));
  const posted: { type: string; action?: string; id?: string }[] = [];
  const handlers: ((event: { data: unknown }) => void)[] = [];
  const documentListeners = new Map<string, (event: FakeEvent) => void>();
  const fakeDocument = {
    get activeElement() {
      return page.activeElement;
    },
    getElementById: (id: string) => elements.get(id) ?? null,
    createElement: (tag: string) => new FakeElement(tag, page),
    createElementNS: (_ns: string, tag: string) => new FakeElement(tag, page),
    addEventListener: (type: string, handler: (event: FakeEvent) => void) => documentListeners.set(type, handler)
  };
  const api = { postMessage: (message: { type: string }) => posted.push(message) };
  const fakeWindow = {
    innerHeight: 800,
    addEventListener: (_type: string, handler: (event: { data: unknown }) => void) => handlers.push(handler),
    ...(options.shareApi ? { llmVoiceApi: api } : {})
  };
  let acquired = 0;
  new Function("acquireVsCodeApi", "document", "window", script)(
    () => {
      acquired += 1;
      return api;
    },
    fakeDocument,
    fakeWindow
  );
  return {
    page,
    element: (id: string) => {
      const found = elements.get(id);
      if (found === undefined) {
        throw new Error(`no element ${id}`);
      }
      return found;
    },
    posted,
    acquired: () => acquired,
    send: (data: unknown) => handlers.forEach((handler) => handler({ data })),
    outsideClick: () => documentListeners.get("click")?.({ stopPropagation() {}, preventDefault() {} })
  };
}

const row = (id: string, title: string, read = false) => ({
  id,
  title,
  source: "Claude Code",
  project: "TTS-Voice",
  age: "il y a 12 min",
  duration: "27 s",
  read,
  line: "27 s · Claude Code · TTS-Voice · il y a 12 min"
});

const panel = (over: Record<string, unknown> = {}) => ({
  type: "responses",
  view: { total: 250, unread: 2, latest: row("1", "L'audit est terminé"), others: [row("2", "Deux"), row("3", "Trois", true)], ...over }
});

describe("the panel's block", () => {
  const start = () => run(PANEL_IDS, { shareApi: true });

  it("uses the API player.js holds: VS Code gives it only once", () => {
    const page = start();
    expect(page.acquired()).toBe(0);
    expect(page.posted).toEqual([{ type: "responsesReady" }]);
  });

  it("stays hidden with no reply", () => {
    const page = start();
    page.send(panel({ total: 0, unread: 0, latest: null, others: [] }));
    expect(page.element("responses").hidden).toBe(true);
  });

  it("gives title, source, project, age and duration of the latest reply", () => {
    const page = start();
    page.send(panel());
    expect(page.element("responses").hidden).toBe(false);
    expect(page.element("response-latest-title").textContent).toBe("L'audit est terminé");
    expect(page.element("response-latest-source").textContent).toBe("Claude Code");
    expect(page.element("response-latest-where").textContent).toBe("TTS-Voice · il y a 12 min");
    expect(page.element("response-latest-duration").textContent).toBe("27 s");
  });

  it("Tout lire reads that reply, on a click only", () => {
    const page = start();
    page.send(panel());
    expect(page.posted).toEqual([{ type: "responsesReady" }]);
    page.element("btn-response-read").click();
    expect(page.posted.at(-1)).toEqual({ type: "responseAction", action: "speak", id: "1" });
  });

  it("shows two lines at most, each with a Lire button and no menu", () => {
    const page = start();
    page.send(panel({ others: [row("2", "Deux"), row("3", "Trois"), row("4", "Quatre")] }));
    const rows = page.element("responses-others").byClass("response-row");
    expect(rows.length).toBe(2);
    expect(page.element("responses-others").byClass("response-more").length).toBe(0);
    rows[0]?.byClass("response-read")[0]?.click();
    expect(page.posted.at(-1)).toEqual({ type: "responseAction", action: "speak", id: "2" });
  });

  it("counts what is new and what exists, and leads to the whole list", () => {
    const page = start();
    page.send(panel());
    expect(page.element("responses-others-heading").textContent).toBe("Réponses · 2 nouvelles");
    expect(page.element("responses-all-long").textContent).toBe("Toutes les réponses (250)");
    expect(page.element("responses-all-short").textContent).toBe("Toutes (250)");
    page.element("btn-responses-all").click();
    expect(page.posted.at(-1)).toEqual({ type: "responseAction", action: "showAll" });
    page.send(panel({ unread: 1 }));
    expect(page.element("responses-others-heading").textContent).toBe("Réponses · 1 nouvelle");
    page.send(panel({ unread: 0 }));
    expect(page.element("responses-others-heading").textContent).toBe("Réponses");
  });

  it("hides the heading with no other line", () => {
    const page = start();
    page.send(panel({ others: [], total: 1 }));
    expect(page.element("responses-others-heading").hidden).toBe(true);
  });

  it("a message that arrives posts nothing: no reading ever starts by itself", () => {
    const page = start();
    const before = page.posted.length;
    for (let index = 0; index < 5; index += 1) {
      page.send(panel());
    }
    expect(page.posted.length).toBe(before);
  });

  it("writes a hostile title as text", () => {
    const page = start();
    const hostile = `<img src=x onerror="alert(1)">`;
    page.send(panel({ latest: row("1", hostile), others: [row("2", hostile)] }));
    expect(page.element("response-latest-title").textContent).toBe(hostile);
    const titles = page.element("responses-others").byClass("response-title");
    expect(titles[0]?.textContent).toBe(hostile);
    expect(titles[0]?.children.length).toBe(0);
  });
});

describe("the view Réponses", () => {
  const start = () => run(LIST_IDS, { shareApi: false });
  const list = (rows = [row("1", "Un"), row("2", "Deux", true)], hasMore = false) => ({
    type: "responsesList",
    view: { total: rows.length, rows, hasMore }
  });

  it("acquires its own API and says it is ready", () => {
    const page = start();
    expect(page.acquired()).toBe(1);
    expect(page.posted).toEqual([{ type: "responsesReady" }]);
  });

  it("gives every line its title, a second line, a Lire button and a menu button", () => {
    const page = start();
    page.send(list());
    const rows = page.element("responses-list").byClass("response-row");
    expect(rows.length).toBe(2);
    expect(rows[0]?.byClass("response-title")[0]?.textContent).toBe("Un");
    expect(rows[0]?.byClass("response-line")[0]?.textContent).toBe("27 s · Claude Code · TTS-Voice · il y a 12 min");
    expect(rows[0]?.byClass("response-read").length).toBe(1);
    expect(rows[0]?.byClass("response-more").length).toBe(1);
  });

  it("marks what is unread in words, for those who do not see the dot", () => {
    const page = start();
    page.send(list());
    const rows = page.element("responses-list").byClass("response-row");
    expect(rows[0]?.byClass("response-dot")[0]?.getAttribute("aria-label")).toBe("Non lue");
    expect(rows[1]?.byClass("response-dot")[0]?.getAttribute("aria-label")).toBeNull();
  });

  it("Lire names the reply it reads, for a screen reader", () => {
    const page = start();
    page.send(list());
    const read = page.element("responses-list").byClass("response-read")[0];
    expect(read?.getAttribute("aria-label")).toBe("Lire : Un");
    read?.click();
    expect(page.posted.at(-1)).toEqual({ type: "responseAction", action: "speak", id: "1" });
  });

  it("the menu holds exactly the three other actions", () => {
    const page = start();
    page.send(list());
    page.element("responses-list").byClass("response-more")[0]?.click();
    const items = page.element("responses-list").byClass("response-menu-item");
    expect(items.map((item) => item.textContent)).toEqual(["Ouvrir le texte", "Marquer comme lue", "Supprimer"]);
    expect(page.element("responses-list").byClass("response-menu")[0]?.getAttribute("role")).toBe("menu");
    expect(items[0]?.focused).toBe(1);
  });

  it("says the opposite on a line already read", () => {
    const page = start();
    page.send(list());
    page.element("responses-list").byClass("response-more")[1]?.click();
    const items = page.element("responses-list").byClass("response-menu-item");
    expect(items[1]?.textContent).toBe("Marquer comme non lue");
  });

  it.each([
    [0, "openText"],
    [1, "toggleRead"],
    [2, "remove"]
  ])("menu item %i posts %s and closes", (index, action) => {
    const page = start();
    page.send(list());
    page.element("responses-list").byClass("response-more")[0]?.click();
    page.element("responses-list").byClass("response-menu-item")[index]?.click();
    expect(page.posted.at(-1)).toEqual({ type: "responseAction", action, id: "1" });
    expect(page.element("responses-list").byClass("response-menu").filter((menu) => !menu.removed).length).toBe(0);
  });

  it("Escape closes the menu and gives the focus back to its button", () => {
    const page = start();
    page.send(list());
    const more = page.element("responses-list").byClass("response-more")[0];
    more?.click();
    const menu = page.element("responses-list").byClass("response-menu")[0];
    menu?.key("Escape");
    expect(menu?.removed).toBe(true);
    expect(more?.focused).toBe(1);
  });

  it("the arrows walk the menu, round", () => {
    const page = start();
    page.send(list());
    page.element("responses-list").byClass("response-more")[0]?.click();
    const menu = page.element("responses-list").byClass("response-menu")[0];
    const items = page.element("responses-list").byClass("response-menu-item");
    menu?.key("ArrowDown");
    expect(page.page.activeElement).toBe(items[1]);
    menu?.key("ArrowUp");
    menu?.key("ArrowUp");
    expect(page.page.activeElement).toBe(items[2]);
  });

  it("a click elsewhere closes the menu", () => {
    const page = start();
    page.send(list());
    page.element("responses-list").byClass("response-more")[0]?.click();
    const menu = page.element("responses-list").byClass("response-menu")[0];
    page.outsideClick();
    expect(menu?.removed).toBe(true);
  });

  it("a refresh leaves an open menu alone, and applies once it closes", () => {
    const page = start();
    page.send(list());
    page.element("responses-list").byClass("response-more")[0]?.click();
    const menu = page.element("responses-list").byClass("response-menu")[0];
    page.send(list([row("9", "Neuf")]));
    expect(menu?.removed).toBe(false);
    expect(page.element("responses-list").byClass("response-title")[0]?.textContent).toBe("Un");
    page.outsideClick();
    expect(page.element("responses-list").byClass("response-title")[0]?.textContent).toBe("Neuf");
  });

  it("keeps the focus on the same button through a refresh", () => {
    const page = start();
    page.send(list());
    page.element("responses-list").byClass("response-read")[1]?.focus();
    page.send(list());
    const again = page.element("responses-list").byClass("response-read")[1];
    expect(page.page.activeElement).toBe(again);
  });

  it("offers older replies only when there are some", () => {
    const page = start();
    page.send(list());
    expect(page.element("btn-responses-older").hidden).toBe(true);
    page.send(list(undefined, true));
    expect(page.element("btn-responses-older").hidden).toBe(false);
    page.element("btn-responses-older").click();
    expect(page.posted.at(-1)).toEqual({ type: "responseAction", action: "showMore" });
  });

  it("with no reply, gives the universal gesture first, then connecting a tool", () => {
    const page = start();
    page.send({ type: "responsesList", view: { total: 0, rows: [], hasMore: false } });
    expect(page.element("responses-empty").hidden).toBe(false);
    expect(page.element("responses-list").hidden).toBe(true);
    page.element("btn-responses-clipboard").click();
    expect(page.posted.at(-1)).toEqual({ type: "responseAction", action: "readClipboard" });
    page.element("btn-responses-connect").click();
    expect(page.posted.at(-1)).toEqual({ type: "responseAction", action: "connectTool" });
    page.send(list());
    expect(page.element("responses-empty").hidden).toBe(true);
    expect(page.element("responses-list").hidden).toBe(false);
  });

  it("a message that arrives posts nothing", () => {
    const page = start();
    const before = page.posted.length;
    page.send(list());
    page.send(list());
    expect(page.posted.length).toBe(before);
  });

  it("writes a hostile title as text", () => {
    const page = start();
    const hostile = "<script>alert(1)</script>";
    page.send(list([row("1", hostile)]));
    const title = page.element("responses-list").byClass("response-title")[0];
    expect(title?.textContent).toBe(hostile);
    expect(title?.children.length).toBe(0);
  });
});

describe("the documents", () => {
  const playerHtml = buildPlayerHtml({
    nonce: "NONCE",
    cspSource: "src",
    scriptUri: "player-script",
    styleUri: "player-style",
    responsesScriptUri: "responses-script",
    responsesStyleUri: "responses-style"
  });
  const listHtml = buildResponsesHtml({ nonce: "NONCE", cspSource: "src", scriptUri: "script", styleUri: "style" });

  it("the block sits under the player, before the open document", () => {
    expect(playerHtml.indexOf('id="responses"')).toBeGreaterThan(playerHtml.indexOf('id="transport"'));
    expect(playerHtml.indexOf('id="responses"')).toBeLessThan(playerHtml.indexOf('id="document"'));
  });

  it("the script of the block runs after player.js, which holds the API", () => {
    expect(playerHtml.indexOf("responses-script")).toBeGreaterThan(playerHtml.indexOf("player-script"));
    expect(playerHtml).toContain('<script nonce="NONCE" src="responses-script"></script>');
  });

  it("the view has a strict policy, and no network", () => {
    expect(listHtml).toContain("default-src 'none'");
    expect(listHtml).toContain("connect-src 'none'");
    expect(listHtml).toContain("script-src 'nonce-NONCE'");
    expect(listHtml).toContain('<html lang="fr">');
  });

  it("carries the mockup's words, and no word of a later card", () => {
    for (const html of [playerHtml, listHtml]) {
      expect(html).not.toMatch(/essentiel|Résumer|Inbox/i);
    }
    expect(playerHtml).toContain("Dernière réponse");
    expect(playerHtml).toContain("Tout lire");
    expect(listHtml).toContain("Aucune réponse pour l'instant");
    expect(listHtml).toContain("Lire le presse-papiers");
    expect(listHtml).toContain("Connecter un outil");
    expect(listHtml).toContain("Rien ne se lit tout seul.");
  });

  it("no label is proper to one tool", () => {
    for (const html of [playerHtml, listHtml, script]) {
      expect(html).not.toMatch(/Claude/);
    }
  });

  it("the script builds no HTML", () => {
    expect(script).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });

  it("the script carries no emoji", () => {
    expect(script + listHtml).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("the stylesheet", () => {
  const rule = (selector: string): string => {
    const at = css.indexOf(`${selector} {`);
    expect(at, selector).toBeGreaterThanOrEqual(0);
    return css.slice(at, css.indexOf("}", at));
  };

  it.each([".response-button", ".response-icon-button", ".response-menu-item"])("%s never wraps its label", (selector) => {
    expect(rule(selector)).toContain("white-space: nowrap");
  });

  it("buttons keep a fixed size and are never stretched", () => {
    expect(rule(".response-button")).toContain("flex: none");
    expect(rule(".response-button")).toContain("height: 26px");
    expect(rule(".response-button")).toContain("padding: 0 10px");
    expect(rule(".response-icon-button")).toContain("flex: 0 0 28px");
    expect(rule(".response-icon-button")).toContain("width: 28px");
    expect(rule(".response-icon-button")).toContain("height: 28px");
  });

  it("the second line is cut at its end, so the duration stays", () => {
    const line = rule(".response-line");
    expect(line).toContain("white-space: nowrap");
    expect(line).toContain("text-overflow: ellipsis");
    expect(line).toContain("overflow: hidden");
    expect(rule(".response-text")).toContain("min-width: 0");
  });

  it("every colour comes from the theme", () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    expect(css).toMatch(/var\(--vscode-/);
  });

  it("at 260 px the long label gives way to the short one", () => {
    expect(css).toMatch(/@media \(max-width: 300px\)/);
  });

  it("the block leaves the panel during a reading", () => {
    for (const state of ["preparing", "buffering", "playing", "paused"]) {
      expect(css).toContain(`body[data-state="${state}"] #responses`);
    }
  });
});
