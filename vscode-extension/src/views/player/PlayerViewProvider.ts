/**
 * Mini-player `WebviewView` (ADR-001, ADR-011): a passive, three-line player
 * hosted in the Panel. It owns no playback state — `WebviewAudioSink` relays
 * the D4 protocol to/from it, and `Pipeline` (S3.5) decides what to send.
 */

import * as vscode from "vscode";
import { WebviewAudioSink } from "../../playback/WebviewAudioSink.js";

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

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
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "player", "player.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "player", "player.css")
    );
    const csp = [
      "default-src 'none'",
      `media-src ${webview.cspSource} blob:`,
      `script-src 'nonce-${nonce}'`,
      `style-src ${webview.cspSource} 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource}`,
      "connect-src 'none'"
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri.toString()}" rel="stylesheet" />
  <title>LLM Voice Player</title>
</head>
<body data-state="idle">
  <p id="welcome">Aucune lecture en cours&hellip;</p>

  <div id="title-line" class="line">
    <span id="title"></span>
    <span id="profile"></span>
  </div>

  <div id="progress-line" class="line">
    <div
      id="progress-track"
      role="slider"
      tabindex="0"
      aria-label="Progression de la lecture"
      aria-valuemin="0"
      aria-valuemax="0"
      aria-valuenow="0"
    >
      <div id="progress-fill"></div>
    </div>
    <span id="time">00:00</span>
  </div>

  <div id="transport" class="line" role="toolbar" aria-label="Contrôles de lecture">
    <button id="btn-prev" class="transport-button" type="button" aria-label="Segment précédent">⏮</button>
    <button id="btn-play-pause" class="transport-button" type="button" aria-label="Lecture">▶</button>
    <button id="btn-next" class="transport-button" type="button" aria-label="Segment suivant">⏭</button>
    <button id="btn-stop" class="transport-button" type="button" aria-label="Arrêter">⏹</button>
  </div>

  <audio id="audio"></audio>

  <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
  }
}
