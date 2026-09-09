/**
 * `openInbox` in `minimal` layout (ADR-011): a Quick Pick over inbox
 * entries, action buttons per item (Speak / Open full response / Delete /
 * Mark read), plus a "Select profile" entry. Only ever calls the injected
 * `InboxQuickPickActions` callbacks — playback itself is entirely the
 * caller's responsibility (zero autoplay, ADR-003).
 */

import * as vscode from "vscode";
import type { InboxEntry } from "../core/inbox.js";
import { formatRelativeTime, inboxProviderIcon } from "./inboxFormat.js";
import { inboxEntrySummary } from "./ClaudeInboxSource.js";

export interface InboxQuickPickActions {
  speak(entry: InboxEntry): Promise<void>;
  openFull(entry: InboxEntry): Promise<void>;
  remove(entry: InboxEntry): Promise<void>;
  toggleRead(entry: InboxEntry): Promise<void>;
  selectProfile(): Promise<void>;
}

const BUTTON_SPEAK: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon("play"), tooltip: "Speak" };
const BUTTON_OPEN_FULL: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon("eye"), tooltip: "Open full response" };
const BUTTON_DELETE: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon("trash"), tooltip: "Delete" };
const BUTTON_MARK_READ: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon("check"), tooltip: "Mark read / unread" };
const BUTTON_SELECT_PROFILE: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon("mic"),
  tooltip: "Select profile"
};

interface InboxQuickPickItem extends vscode.QuickPickItem {
  entry: InboxEntry;
}

function itemFor(entry: InboxEntry): InboxQuickPickItem {
  const unreadDot = entry.read ? "" : "$(circle-filled) ";
  return {
    entry,
    label: `${inboxProviderIcon(entry.message.provider)} ${unreadDot}${inboxEntrySummary(entry)}`,
    description: formatRelativeTime(entry.message.capturedAt),
    detail: entry.message.title ?? firstLine(entry.message.message),
    buttons: [BUTTON_SPEAK, BUTTON_OPEN_FULL, BUTTON_MARK_READ, BUTTON_DELETE]
  };
}

function firstLine(text: string): string {
  return (text.split(/\r?\n/, 1)[0] ?? "").trim();
}

/**
 * Fetches a fresh entry list via `listEntries` and renders the Quick Pick.
 * Any action that mutates the inbox (`speak` opening full response is
 * read-only, but delete/mark-read/select-profile are not) re-fetches and
 * re-renders rather than trying to patch the in-memory list, keeping this a
 * thin, always-consistent view over `InboxRepository`/`ReadStateStore`.
 */
export async function showInboxQuickPick(
  listEntries: () => Promise<readonly InboxEntry[]>,
  actions: InboxQuickPickActions
): Promise<void> {
  const entries = await listEntries();

  const quickPick = vscode.window.createQuickPick<InboxQuickPickItem>();
  quickPick.title = "LLM Voice : Inbox";
  quickPick.placeholder =
    entries.length === 0 ? "Inbox vide — aucune réponse capturée pour le moment." : "Choisir un message (Entrée = Speak)";
  quickPick.buttons = [BUTTON_SELECT_PROFILE];
  quickPick.items = entries.map(itemFor);

  const dispose = () => quickPick.dispose();

  quickPick.onDidTriggerButton((button) => {
    if (button === BUTTON_SELECT_PROFILE) {
      dispose();
      void actions.selectProfile();
    }
  });

  quickPick.onDidTriggerItemButton(async (event) => {
    const { entry } = event.item;
    if (event.button === BUTTON_SPEAK) {
      dispose();
      await actions.speak(entry);
      return;
    }
    if (event.button === BUTTON_OPEN_FULL) {
      dispose();
      await actions.openFull(entry);
      return;
    }
    if (event.button === BUTTON_DELETE) {
      await actions.remove(entry);
      await refresh();
      return;
    }
    if (event.button === BUTTON_MARK_READ) {
      await actions.toggleRead(entry);
      await refresh();
    }
  });

  quickPick.onDidAccept(() => {
    const [selected] = quickPick.selectedItems;
    dispose();
    if (selected !== undefined) {
      void actions.speak(selected.entry);
    }
  });

  quickPick.onDidHide(dispose);

  const refresh = async (): Promise<void> => {
    const active = quickPick.activeItems[0]?.entry.id;
    const next = await listEntries();
    quickPick.items = next.map(itemFor);
    if (active !== undefined) {
      const stillThere = quickPick.items.find((item) => item.entry.id === active);
      if (stillThere !== undefined) {
        quickPick.activeItems = [stillThere];
      }
    }
  };

  quickPick.show();
}
