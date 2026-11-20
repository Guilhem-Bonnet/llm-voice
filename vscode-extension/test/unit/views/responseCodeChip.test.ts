/** La puce « Code : ignoré / lu » : ce qu'elle dit, et quand elle se montre (GAO-r-ponses-2-l-001). */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { responseCodeChipOf } from "../../../src/views/player/responseCodeChip.js";

const JS = readFileSync(resolve(__dirname, "../../../media/player/player.js"), "utf8");
const CSS = readFileSync(resolve(__dirname, "../../../media/player/player.css"), "utf8");
const HTML = readFileSync(resolve(__dirname, "../../../src/views/player/playerHtml.ts"), "utf8");
const MANIFEST = JSON.parse(readFileSync(resolve(__dirname, "../../../package.json"), "utf8")) as {
  contributes: { configuration: { properties: Record<string, { type: string; default: unknown; description: string }> } };
};

describe("responseCodeChipOf", () => {
  const reading = { hasCode: true, codeRead: false };

  it("dit l'état de la prochaine lecture", () => {
    expect(responseCodeChipOf(reading, false, "playing")).toEqual({ text: "Code : ignoré", pressed: false });
    expect(responseCodeChipOf({ hasCode: true, codeRead: true }, true, "playing")).toEqual({ text: "Code : lu", pressed: true });
  });

  it("une bascule en cours de lecture s'applique à la prochaine, et le dit", () => {
    expect(responseCodeChipOf(reading, true, "paused")).toEqual({ text: "Code : lu", pressed: true, note: "À la prochaine lecture." });
    expect(responseCodeChipOf({ hasCode: true, codeRead: true }, false, "playing")).toEqual({
      text: "Code : ignoré",
      pressed: false,
      note: "À la prochaine lecture."
    });
  });

  it("n'apparaît pas sans bloc de code, ni hors d'une réponse", () => {
    expect(responseCodeChipOf({ hasCode: false, codeRead: false }, false, "playing")).toBeUndefined();
    expect(responseCodeChipOf(undefined, false, "playing")).toBeUndefined();
  });

  it.each(["preparing", "buffering", "playing", "paused"] as const)("se montre en %s", (state) => {
    expect(responseCodeChipOf(reading, false, state)).toBeDefined();
  });

  it.each(["idle", "stopped", "completed", "stale", "error"] as const)("se retire en %s", (state) => {
    expect(responseCodeChipOf(reading, false, state)).toBeUndefined();
  });
});

describe("la puce, exécutée par le vrai player.js", () => {
  function run() {
    const elements = new Map<string, Record<string, unknown>>();
    const element = (id: string): Record<string, unknown> => {
      const existing = elements.get(id);
      if (existing !== undefined) {
        return existing;
      }
      const attributes: Record<string, string> = {};
      const listeners = new Map<string, () => void>();
      const created: Record<string, unknown> = {
        textContent: "",
        hidden: false,
        style: {},
        paused: true,
        attributes,
        setAttribute: (name: string, value: string) => (attributes[name] = value),
        getAttribute: (name: string) => attributes[name],
        addEventListener: (type: string, handler: () => void) => listeners.set(type, handler),
        click: () => listeners.get("click")?.(),
        pause() {},
        load() {},
        getBoundingClientRect: () => ({ left: 0, width: 100 })
      };
      elements.set(id, created);
      return created;
    };
    const posted: unknown[] = [];
    const handlers: ((event: { data: unknown }) => void)[] = [];
    new Function("acquireVsCodeApi", "document", "window", JS)(
      () => ({ postMessage: (message: unknown) => posted.push(message) }),
      { getElementById: element, body: element("body") },
      { addEventListener: (_type: string, handler: (event: { data: unknown }) => void) => handlers.push(handler) }
    );
    const state = (fields: object): void => handlers.forEach((handler) => handler({ data: { type: "state", state: { state: "playing", ...fields } } }));
    return { element, posted, state };
  }

  it("se montre, porte l'état et la note, et disparaît sans donnée", () => {
    const { element, state } = run();
    const line = element("response-code-line");
    const button = element("btn-response-code");
    const note = element("response-code-note");
    state({ responseCode: { text: "Code : lu", pressed: true, note: "À la prochaine lecture." } });
    expect(line.hidden).toBe(false);
    expect(button.textContent).toBe("Code : lu");
    expect((button.attributes as Record<string, string>)["aria-pressed"]).toBe("true");
    expect(note.textContent).toBe("À la prochaine lecture.");
    expect(note.hidden).toBe(false);
    state({ responseCode: { text: "Code : ignoré", pressed: false } });
    expect((button.attributes as Record<string, string>)["aria-pressed"]).toBe("false");
    expect(note.hidden).toBe(true);
    state({});
    expect(line.hidden).toBe(true);
  });

  it("le clic envoie la bascule, rien d'autre", () => {
    const { element, posted } = run();
    posted.length = 0;
    (element("btn-response-code").click as () => void)();
    expect(posted).toEqual([{ type: "userAction", action: "toggleResponseCode" }]);
  });
});

describe("la puce dans le panneau", () => {
  it("a la taille fixe des actions du panneau, et `hidden` la masque vraiment", () => {
    expect(HTML).toMatch(/id="btn-response-code" class="action-button"/);
    expect(CSS).toMatch(/\.action-button \{[^}]*flex: none;[^}]*height: 26px;/s);
    expect(CSS).toMatch(/\.action-button \{[^}]*white-space: nowrap;/s);
    expect(CSS).toMatch(/#response-code-line\[hidden\]/);
  });

  it("le clic envoie un réglage, jamais une lecture, et le texte passe par textContent", () => {
    expect(JS).toMatch(/responseCode\.button\.addEventListener\("click", \(\) => post\(\{ type: "userAction", action: "toggleResponseCode" \}\)\)/);
    expect(JS).toMatch(/responseCode\.button\.textContent =/);
    expect(JS).not.toMatch(/innerHTML/);
  });

  it("le réglage du défaut existe, et il ignore le code", () => {
    const setting = MANIFEST.contributes.configuration.properties["llmVoice.responses.readCode"];
    expect(setting?.type).toBe("boolean");
    expect(setting?.default).toBe(false);
  });
});
