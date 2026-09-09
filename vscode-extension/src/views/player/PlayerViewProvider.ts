/**
 * Mini-player `WebviewView` (ADR-001, ADR-011): a passive, three-line player
 * hosted in the Panel. It owns no playback state — `WebviewAudioSink` relays
 * the D4 protocol to/from it, and `Pipeline` (S3.5) decides what to send.
 */

import * as vscode from "vscode";
import { WebviewAudioSink } from "../../playback/WebviewAudioSink.js";
import { buildPlayerHtml, getNonce } from "./playerHtml.js";

export class PlayerViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "llmVoice.player";

  private readonly sink = new WebviewAudioSink();
  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly globalStorageUri: vscode.Uri
  ) {}

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

    webviewView.onDidDispose(() => {
      this.sink.detach();
      this.view = undefined;
    });
  }

  /** Reveals the Panel view without stealing editor focus (ADR-001). */
  reveal(): void {
    this.view?.show(true /* preserveFocus */);
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
