/**
 * "Profils" Tree View for the dedicated `llmVoice` container (S9, ADR-011
 * revision 2026-09-12). Read-only listing + hover actions
 * (`llmVoice.profilesView.*`, `package.json`); formatting itself lives in
 * `profileTreeItems.ts` (vscode-free, unit tested), same split as
 * `InboxTreeProvider.ts` / `inboxFormat.ts`.
 */

import * as vscode from "vscode";
import type { EffectiveMode } from "../../profiles/voiceResolution.js";
import { buildProfileTreeItems, type ProfileTreeItemData } from "./profileTreeItems.js";

export class ProfileTreeItem extends vscode.TreeItem {
  constructor(readonly data: ProfileTreeItemData) {
    super(data.label, vscode.TreeItemCollapsibleState.None);
    this.description = data.description;
    this.tooltip = data.tooltip;
    this.iconPath = new vscode.ThemeIcon(data.icon);
    this.contextValue = "llmVoiceProfileEntry";
    this.id = data.id;
  }
}

export class ProfilesTreeProvider implements vscode.TreeDataProvider<ProfileTreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private items: readonly ProfileTreeItemData[] = [];

  constructor(
    /** The modes offered, with their effective voice (`ProfileStore.listEffective`). */
    private readonly listModes: () => Promise<readonly EffectiveMode[]>,
    /** The active profile's id, resolved the same way a new session would (`ProfileStore.getSelected`). */
    private readonly getActiveProfileId: () => Promise<string | undefined>
  ) {}

  async refresh(): Promise<void> {
    const [modes, activeId] = await Promise.all([this.listModes(), this.getActiveProfileId()]);
    const ownVoiceIds = new Set(modes.filter((row) => row.voiceOrigin === "mode").map((row) => row.mode.id));
    this.items = buildProfileTreeItems(
      modes.map((row) => row.effective),
      activeId,
      ownVoiceIds
    );
    this.onDidChangeTreeDataEmitter.fire();
  }

  /** Test hook: the currently rendered rows, without going through `vscode.TreeItem`. */
  get currentItems(): readonly ProfileTreeItemData[] {
    return this.items;
  }

  getTreeItem(element: ProfileTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): ProfileTreeItem[] {
    return this.items.map((item) => new ProfileTreeItem(item));
  }

  dispose(): void {
    this.onDidChangeTreeDataEmitter.dispose();
  }
}
