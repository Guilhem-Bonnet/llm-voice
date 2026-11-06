/**
 * `openInbox` in `minimal` layout (ADR-011): the list "Réponses" as a Quick Pick. Each
 * line has its "Lire" button, and "Autres actions" holds the rest. Only ever calls the
 * injected `InboxQuickPickActions` callbacks: playback itself is entirely the caller's
 * responsibility (zero autoplay, ADR-003).
 */

import * as vscode from "vscode";
import type { InboxEntry } from "../core/inbox.js";
import { responsePickTexts } from "./responseRow.js";

export interface InboxQuickPickActions {
  speak(entry: InboxEntry): Promise<void>;
  openFull(entry: InboxEntry): Promise<void>;
  remove(entry: InboxEntry): Promise<void>;
  toggleRead(entry: InboxEntry): Promise<void>;
  chooseMode(): Promise<void>;
}

const BUTTON_SPEAK: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon("play"), tooltip: "Lire" };
const BUTTON_MORE: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon("ellipsis"), tooltip: "Autres actions" };
const BUTTON_CHOOSE_MODE: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon("mic"), tooltip: "Changer de mode" };

const ACTION_OPEN = "Ouvrir le texte";
const ACTION_DELETE = "Supprimer";

interface InboxQuickPickItem extends vscode.QuickPickItem {
  entry: InboxEntry;
}

function itemFor(entry: InboxEntry): InboxQuickPickItem {
  return { entry, ...responsePickTexts(entry, Date.now()), buttons: [BUTTON_SPEAK, BUTTON_MORE] };
}

/**
 * Fetches a fresh entry list via `listEntries` and renders the Quick Pick. An action
 * on a line that changes the list opens it again, read fresh from disk, rather than
 * patching it: a thin, always-consistent view over `InboxRepository`/`ReadStateStore`.
 */
export async function showInboxQuickPick(
  listEntries: () => Promise<readonly InboxEntry[]>,
  actions: InboxQuickPickActions
): Promise<void> {
  const entries = await listEntries();

  const quickPick = vscode.window.createQuickPick<InboxQuickPickItem>();
  quickPick.title = "LLM Voice : Réponses";
  quickPick.placeholder =
    entries.length === 0 ? "Aucune réponse pour l'instant." : "Choisir une réponse (Entrée pour lire)";
  quickPick.matchOnDetail = true;
  quickPick.buttons = [BUTTON_CHOOSE_MODE];
  quickPick.items = entries.map(itemFor);

  const dispose = () => quickPick.dispose();

  quickPick.onDidTriggerButton((button) => {
    if (button === BUTTON_CHOOSE_MODE) {
      dispose();
      void actions.chooseMode();
    }
  });

  quickPick.onDidTriggerItemButton(async (event) => {
    const { entry } = event.item;
    dispose();
    if (event.button === BUTTON_SPEAK) {
      await actions.speak(entry);
      return;
    }
    const toggle = entry.read ? "Marquer comme non lue" : "Marquer comme lue";
    const choice = await vscode.window.showQuickPick([ACTION_OPEN, toggle, ACTION_DELETE], {
      title: "LLM Voice : Autres actions"
    });
    if (choice === undefined) {
      await showInboxQuickPick(listEntries, actions);
    } else if (choice === ACTION_OPEN) {
      await actions.openFull(entry);
    } else {
      await (choice === ACTION_DELETE ? actions.remove(entry) : actions.toggleRead(entry));
      await showInboxQuickPick(listEntries, actions);
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

  quickPick.show();
}
