/**
 * Inbox Tree View for `llmVoice.ui.layout = "full"` (ADR-011: the View
 * Container becomes an opt-in mode, not the default). Read-only listing +
 * context menu commands (`llmVoice.inbox.*`, `package.json`); `refresh()` is
 * called from `InboxWatcher`'s `changed` event and never triggers playback
 * itself (zero autoplay, ADR-003).
 */

import * as vscode from "vscode";
import type { InboxEntry } from "../core/inbox.js";
import { formatRelativeTime, inboxProviderIcon } from "./inboxFormat.js";
import { inboxEntrySummary } from "./ClaudeInboxSource.js";

export class InboxTreeItem extends vscode.TreeItem {
  constructor(readonly entry: InboxEntry) {
    super(inboxEntrySummary(entry), vscode.TreeItemCollapsibleState.None);
    this.description = formatRelativeTime(entry.message.capturedAt);
    this.tooltip = entry.message.title ?? entry.message.message.slice(0, 200);
    this.iconPath = new vscode.ThemeIcon(entry.read ? "circle-outline" : "circle-filled");
    this.contextValue = "llmVoiceInboxEntry";
    this.id = entry.id;
    this.command = { command: "llmVoice.inbox.speak", title: "Speak", arguments: [entry] };
    // Provider icon carried in the label via codicon markup (`inboxEntrySummary`
    // does not include it); prefix it here so the tree matches the Quick Pick.
    this.label = `${inboxProviderIcon(entry.message.provider)} ${this.label as string}`;
  }
}

export class InboxTreeProvider implements vscode.TreeDataProvider<InboxTreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private entries: readonly InboxEntry[] = [];

  constructor(private readonly listEntries: () => Promise<readonly InboxEntry[]>) {}

  async refresh(): Promise<void> {
    this.entries = await this.listEntries();
    this.onDidChangeTreeDataEmitter.fire();
  }

  get unreadCount(): number {
    return this.entries.filter((entry) => !entry.read).length;
  }

  getTreeItem(element: InboxTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): InboxTreeItem[] {
    return this.entries.map((entry) => new InboxTreeItem(entry));
  }

  dispose(): void {
    this.onDidChangeTreeDataEmitter.dispose();
  }
}
