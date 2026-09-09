/**
 * Single status bar item (CdC §8, ADR-011). Text formatting lives in
 * `statusBarText.ts` (vscode-free, unit tested); this class only wires it to
 * a real `StatusBarItem` and the click-menu Quick Pick.
 */

import * as vscode from "vscode";
import {
  formatStatusBarText,
  formatStatusBarTooltip,
  type StatusBarViewModel
} from "./statusBarText.js";

export type { StatusBarPlaybackState, StatusBarViewModel } from "./statusBarText.js";

type QuickPickChoice =
  | "resume"
  | "pause"
  | "stop"
  | "selectProfile"
  | "openInbox"
  | "providerStatus"
  | "verifyLocalMode";

interface QuickPickItemWithChoice extends vscode.QuickPickItem {
  choice: QuickPickChoice;
}

/** Single status bar item; the only one contributed by this extension (CdC §8). */
export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private model: StatusBarViewModel = {
    state: "idle",
    profileLabel: "—",
    isLocalOnly: false
  };

  constructor(
    private readonly onChoice: (choice: QuickPickChoice) => void,
    commandId: string
  ) {
    // ADR-011: aligné à droite, priorité basse (VS Code place les priorités
    // basses vers l'extrémité droite de la barre, loin du centre).
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1);
    this.item.command = commandId;
    this.item.name = "LLM Voice";
    this.render();
    this.item.show();
  }

  update(model: StatusBarViewModel): void {
    this.model = model;
    this.render();
  }

  /** Current rendered text. Test hook (no public API lists status bar items). */
  get text(): string {
    return this.item.text;
  }

  async openMenu(): Promise<void> {
    const isPlaying = this.model.state === "playing";
    const items: QuickPickItemWithChoice[] = [
      isPlaying
        ? { label: "$(debug-pause) Pause", choice: "pause" }
        : { label: "$(play) Reprendre", choice: "resume" },
      { label: "$(debug-stop) Arrêter", choice: "stop" },
      { label: "$(mic) Changer de profil", choice: "selectProfile" },
      { label: "$(inbox) Ouvrir l'inbox", choice: "openInbox" },
      { label: "$(pulse) Provider Status", choice: "providerStatus" },
      { label: "$(shield) Verify Local Mode", choice: "verifyLocalMode" }
    ];
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "LLM Voice"
    });
    if (picked) {
      this.onChoice(picked.choice);
    }
  }

  dispose(): void {
    this.item.dispose();
  }

  private render(): void {
    this.item.text = formatStatusBarText(this.model);
    this.item.tooltip = formatStatusBarTooltip(this.model);
  }
}
