/**
 * Mini-player `WebviewView` (ADR-001, ADR-011): a passive, three-line player
 * hosted in the Panel. It owns no playback state — `WebviewAudioSink` relays
 * the D4 protocol to/from it, and `Pipeline` (S3.5) decides what to send.
 */

import * as vscode from "vscode";
import { WebviewAudioSink } from "../../playback/WebviewAudioSink.js";
import { buildPlayerHtml, getNonce } from "./playerHtml.js";
import type { Logger } from "../../infrastructure/logger.js";

export class PlayerViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "llmVoice.player";

  private readonly sink: WebviewAudioSink;
  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly globalStorageUri: vscode.Uri,
    logger?: Logger
  ) {
    this.sink = new WebviewAudioSink(logger);
  }

  /** The sink other layers (the future PlaybackController) talk to. */
  get audioSink(): WebviewAudioSink {
    return this.sink;
  }

  /**
   * `localResourceRoots` this provider configures the webview with (ADR-001):
   * only the audio cache and the extension's `media/` folder. Exposed as
   * plain fs paths for `Verify Local Mode` check #7 (`src/net/verifyLocalMode.ts`)
   * without requiring a live, resolved webview.
   */
  get localResourceRoots(): readonly string[] {
    return [
      vscode.Uri.joinPath(this.globalStorageUri, "cache").fsPath,
      vscode.Uri.joinPath(this.extensionUri, "media").fsPath
    ];
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.globalStorageUri, "cache"),
        vscode.Uri.joinPath(this.extensionUri, "media")
      ]
    };

    webviewView.webview.html = this.renderHtml(webviewView.webview);
    this.disposables.push(this.sink.attach(webviewView.webview));

    // GAO-diagnostic-s-001: `resolveWebviewView` runs once per view id
    // (`llmVoice.player` panel mini-player, `llmVoice.playerView` dedicated
    // view) against this *same* provider instance — `this.view` used to be
    // unconditionally overwritten/cleared the same way `sink.attach`/
    // `sink.detach` were, so a *stale* view disposing (the one that lost
    // the race when both were resolved) could null out the reference to
    // the still-alive one the user is actually looking at. Both are now
    // identity-guarded: only the view that owns the current binding may
    // clear it.
    webviewView.onDidDispose(() => {
      this.sink.detach(webviewView.webview);
      if (this.view === webviewView) {
        this.view = undefined;
      }
    });
  }

  /**
   * Reveals the player view without stealing editor focus (ADR-001).
   *
   * GAO-diagnostic-s-001: `this.view` stays `undefined` until VS Code has
   * resolved the webview view *at least once* — which only happens once the
   * user has opened its container (Panel or the `llmVoice` Activity Bar
   * entry, whichever `llmVoice.ui.layout` picks) themselves. Before this
   * fix, `this.view?.show(...)` was a silent no-op on a cold container: the
   * session would start, `WebviewAudioSink.load()` would post into a
   * webview that never existed, and nothing told the caller. The
   * auto-registered `<viewId>.focus` command forces VS Code to resolve
   * (and reveal) the view even from cold — same effect as the user opening
   * it by hand. Returns whether a view is attached afterwards, so the
   * caller can report a real failure instead of playing into a void.
   */
  async reveal(): Promise<boolean> {
    if (this.view !== undefined) {
      this.view.show(true /* preserveFocus */);
      return true;
    }
    const layout = vscode.workspace.getConfiguration("llmVoice").get<string>("ui.layout", "full");
    const viewId = layout === "minimal" ? PlayerViewProvider.viewType : "llmVoice.playerView";
    try {
      await vscode.commands.executeCommand(`${viewId}.focus`);
    } catch {
      // The view container itself may not exist in this workbench layout
      // (e.g. contributed but collapsed/removed) — `this.view` below stays
      // `undefined` and the caller reports the failure.
    }
    return this.view !== undefined;
  }

  /** True once `resolveWebviewView` has run at least once. Test hook. */
  get isResolved(): boolean {
    return this.view !== undefined;
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
  }

  private renderHtml(webview: vscode.Webview): string {
    return buildPlayerHtml({
      nonce: getNonce(),
      cspSource: webview.cspSource,
      scriptUri: webview
        .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "player", "player.js"))
        .toString(),
      styleUri: webview
        .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "player", "player.css"))
        .toString()
    });
  }
}
