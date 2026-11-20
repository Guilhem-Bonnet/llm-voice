/**
 * What the two surfaces of the list share. The property that matters: a reply that
 * arrives is shown and read by nobody until someone asks.
 */
import { describe, expect, it, vi } from "vitest";
import type { InboxEntry } from "../../../src/core/inbox.js";
import { RESPONSES_PAGE, ResponsesFeed, type ResponseActions } from "../../../src/claude/ResponsesFeed.js";

const NOW = Date.parse("2026-11-06T12:00:00.000Z");

function entry(id: string, read = false): InboxEntry {
  return {
    id,
    fileName: `${id}.json`,
    read,
    archived: false,
    bytes: 1,
    modifiedAt: NOW,
    message: { schemaVersion: 1, provider: "codex", sessionId: "s", capturedAt: NOW, message: `Réponse ${id}.` }
  };
}

function harness(initial: InboxEntry[]) {
  let entries = initial;
  const actions: { [K in keyof ResponseActions]: ReturnType<typeof vi.fn> } = {
    speak: vi.fn(() => Promise.resolve()),
    openText: vi.fn(() => Promise.resolve()),
    toggleRead: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
    showAll: vi.fn(() => Promise.resolve()),
    readClipboard: vi.fn(() => Promise.resolve()),
    connectTool: vi.fn(() => Promise.resolve())
  };
  const changed = vi.fn();
  const feed = new ResponsesFeed({
    list: () => Promise.resolve(entries),
    actions: actions as unknown as ResponseActions,
    onChange: changed,
    now: () => NOW
  });
  return { feed, actions, changed, setEntries: (next: InboxEntry[]) => (entries = next) };
}

describe("ResponsesFeed", () => {
  it("a reply that arrives is shown, and starts nothing", async () => {
    const { feed, actions, changed, setEntries } = harness([entry("old", true)]);
    await feed.refresh();
    setEntries([entry("new"), entry("old", true)]);
    await feed.refresh();

    expect(changed).toHaveBeenCalledTimes(2);
    expect(feed.panelView().latest?.id).toBe("new");
    expect(feed.unreadCount).toBe(1);
    for (const action of Object.values(actions)) {
      expect(action).not.toHaveBeenCalled();
    }
  });

  it("a click on Lire reaches the action with the entry it names", async () => {
    const { feed, actions } = harness([entry("a"), entry("b")]);
    await feed.refresh();
    await feed.handle({ type: "responseAction", action: "speak", id: "b" });
    expect(actions.speak).toHaveBeenCalledTimes(1);
    expect((actions.speak.mock.calls[0]?.[0] as InboxEntry).id).toBe("b");
  });

  it.each([
    ["openText", "openText"],
    ["toggleRead", "toggleRead"],
    ["remove", "remove"]
  ] as const)("%s reaches its action", async (action, method) => {
    const { feed, actions } = harness([entry("a")]);
    await feed.refresh();
    await feed.handle({ type: "responseAction", action, id: "a" });
    expect(actions[method]).toHaveBeenCalledTimes(1);
  });

  it("an id that is not on the list reaches nothing", async () => {
    const { feed, actions } = harness([entry("a")]);
    await feed.refresh();
    await feed.handle({ type: "responseAction", action: "remove", id: "../../etc/passwd" });
    await feed.handle({ type: "responseAction", action: "speak", id: "absent" });
    expect(actions.remove).not.toHaveBeenCalled();
    expect(actions.speak).not.toHaveBeenCalled();
  });

  it("a malformed message reaches nothing", async () => {
    const { feed, actions } = harness([entry("a")]);
    await feed.refresh();
    await feed.handle({ type: "responseAction", action: "speak", id: 1 });
    await feed.handle(undefined);
    expect(actions.speak).not.toHaveBeenCalled();
  });

  it("shows a page of the list, then more on demand, without reading the disk again", async () => {
    const many = Array.from({ length: RESPONSES_PAGE + 5 }, (_, index) => entry(String(index)));
    const { feed, changed } = harness(many);
    await feed.refresh();
    expect(feed.listView().rows.length).toBe(RESPONSES_PAGE);
    expect(feed.listView().hasMore).toBe(true);
    changed.mockClear();
    await feed.handle({ type: "responseAction", action: "showMore" });
    expect(feed.listView().rows.length).toBe(RESPONSES_PAGE + 5);
    expect(feed.listView().hasMore).toBe(false);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("the three plain actions need no entry", async () => {
    const { feed, actions } = harness([]);
    await feed.handle({ type: "responseAction", action: "showAll" });
    await feed.handle({ type: "responseAction", action: "readClipboard" });
    await feed.handle({ type: "responseAction", action: "connectTool" });
    expect(actions.showAll).toHaveBeenCalledTimes(1);
    expect(actions.readClipboard).toHaveBeenCalledTimes(1);
    expect(actions.connectTool).toHaveBeenCalledTimes(1);
  });
});
