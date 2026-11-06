/**
 * The list is called "Réponses", whatever the tool. ADR-017's word "profil" and the
 * words "Inbox" and "Speak" stay out of what its surfaces say.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const manifest = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
  contributes: {
    commands: { command: string; title: string }[];
    views: Record<string, { id: string; type?: string; name: string }[]>;
    viewsWelcome: { view: string; contents: string }[];
    keybindings: { key: string; command: string; when?: string }[];
    menus: { "view/title": { command: string; when?: string }[]; "view/item/context": { when?: string }[] };
    configuration: { properties: Record<string, { default?: unknown; description?: string }> };
    walkthroughs: { steps: { title: string; description: string; media: { altText?: string } }[] }[];
  };
};

const source = (relative: string): string => readFileSync(resolve(ROOT, relative), "utf8");

describe("the view", () => {
  const view = Object.values(manifest.contributes.views)
    .flat()
    .find((entry) => entry.id === "llmVoice.inboxView");

  it("is named Réponses, its internal id stays", () => {
    expect(view?.name).toBe("Réponses");
  });

  it("is a webview: a native tree has no second line, and shows its buttons only on hover", () => {
    expect(view?.type).toBe("webview");
    expect(source("src/pipeline/Pipeline.ts")).not.toContain('createTreeView("llmVoice.inboxView"');
    expect(manifest.contributes.menus["view/item/context"].filter((entry) => entry.when?.includes("inboxView"))).toEqual([]);
  });

  it("keeps its refresh button", () => {
    expect(manifest.contributes.menus["view/title"].find((entry) => entry.when === "view == llmVoice.inboxView")?.command).toBe(
      "llmVoice.inbox.refresh"
    );
  });
});

describe("the command", () => {
  const titled = (id: string): string | undefined => manifest.contributes.commands.find((entry) => entry.command === id)?.title;

  it("is called Lire la dernière réponse, under its new id and its old one", () => {
    expect(titled("llmVoice.speakLatestResponse")).toBe("LLM Voice: Lire la dernière réponse");
    expect(titled("llmVoice.speakLatestClaudeResponse")).toBe("LLM Voice: Lire la dernière réponse");
  });

  it("has Ctrl+Alt+V R by default, on the new id", () => {
    const binding = manifest.contributes.keybindings.find((entry) => entry.key === "ctrl+alt+v r");
    expect(binding?.command).toBe("llmVoice.speakLatestResponse");
  });

  it("works from the integrated terminal: that is where a command line tool has its reply", () => {
    const binding = manifest.contributes.keybindings.find((entry) => entry.key === "ctrl+alt+v r");
    expect(binding?.when ?? "").not.toContain("terminalFocus");
  });

  it("takes the latest reply of any tool", () => {
    const pipeline = source("src/pipeline/Pipeline.ts");
    expect(pipeline).not.toMatch(/provider === "claude-code"/);
  });
});

describe("what the surfaces say", () => {
  const INBOX = /inbox/i;

  it("no title of a command, no view, no welcome says inbox", () => {
    for (const { title } of manifest.contributes.commands) {
      expect(title).not.toMatch(INBOX);
    }
    for (const view of Object.values(manifest.contributes.views).flat()) {
      expect(view.name).not.toMatch(INBOX);
    }
    for (const { contents } of manifest.contributes.viewsWelcome) {
      expect(contents).not.toMatch(INBOX);
    }
  });

  it("no setting and no step of the walkthrough says inbox to the user", () => {
    for (const [id, property] of Object.entries(manifest.contributes.configuration.properties)) {
      expect(property.description ?? "", id).not.toMatch(INBOX);
    }
    for (const step of manifest.contributes.walkthroughs.flatMap((walkthrough) => walkthrough.steps)) {
      expect(step.description, step.title).not.toMatch(INBOX);
      expect(step.media.altText ?? "", step.title).not.toMatch(INBOX);
    }
  });

  it("the Quick Pick speaks French, and of a mode", () => {
    const pick = source("src/claude/InboxQuickPick.ts");
    for (const word of ['"Speak"', '"Delete"', '"Select profile"', "Open full response", "Mark read", "LLM Voice : Inbox", "Inbox vide", "Entrée = Speak"]) {
      expect(pick).not.toContain(word);
    }
    for (const word of ['"Lire"', '"Changer de mode"', '"Autres actions"', "LLM Voice : Réponses"]) {
      expect(pick).toContain(word);
    }
  });

  it("an error about a missing reply calls it a reply", () => {
    expect(source("src/claude/ClaudeInboxSource.ts")).not.toMatch(/"LLM Voice :[^"]*inbox/i);
    expect(source("src/claude/InboxContentProvider.ts")).not.toMatch(/"LLM Voice :[^"]*inbox/i);
  });
});

describe("by default, a reply is read in full (decisions-log, 2026-11-06)", () => {
  it.each(["llmVoice.modes.bySource", "llmVoice.profiles.bySource"])("%s sends a reply to the faithful mode", (id) => {
    expect(manifest.contributes.configuration.properties[id]?.default).toEqual({ "claude-code": "faithful-local" });
  });
});
