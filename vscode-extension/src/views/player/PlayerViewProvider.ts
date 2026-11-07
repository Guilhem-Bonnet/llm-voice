/**
 * Mini-player `WebviewView` (ADR-001, ADR-011): a passive, three-line player
 * hosted in the Panel. It owns no playback state — `WebviewAudioSink` relays
 * the D4 protocol to/from it, and `Pipeline` (S3.5) decides what to send.
 */

import * as vscode from "vscode";
import type { AudioSink } from "../../playback/AudioSink.js";
import { SequencedAudioSink } from "../../playback/SequencedAudioSink.js";
import { WebviewAudioSink } from "../../playback/WebviewAudioSink.js";
import type { PlayerScriptView } from "../../core/playback.js";
import { documentViewOf, type DocumentViewInput } from "./documentView.js";
import type { PanelResponsesView } from "../../claude/responseRow.js";

/** What the line of the "Document ouvert" block is told of the text; it never reaches the webview. */
export type ScriptDescriber = (document: { uri: string; languageId: string; text: string }) => Promise<PlayerScriptView | undefined>;

/** Past this, a document is not scanned for a script when it is merely shown. */
const MAX_SCRIPT_CHARS = 4_000_000;
import { buildPlayerHtml, getNonce } from "./playerHtml.js";

export class PlayerViewProvider implements vscode.WebviewViewProvider {
  private scriptDescriber: ScriptDescriber | undefined;
  private scriptSeen: { key: string; script: PlayerScriptView | undefined } | undefined;
  private scriptPending: string | undefined;
  static readonly viewType = "llmVoice.player";

  private readonly sink = new WebviewAudioSink();
  /** The v2 view of `sink` (ADR-012 §3), built once so its queue survives. */
  private readonly sequenced = new SequencedAudioSink(this.sink);
  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private editorWatch: vscode.Disposable[] = [];
  private responses: PanelResponsesView | undefined;
  private responseHandler: ((raw: unknown) => void) | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly globalStorageUri: vscode.Uri
  ) {}

  /** The raw webview transport: `attach`, `pushState`, `onUserAction`. */
  get audioSink(): WebviewAudioSink {
    return this.sink;
  }

  /** `AudioSink` v2 over the webview, handed to `PlaybackController`. */
  get playbackSink(): AudioSink {
    return this.sequenced;
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
        // `globalStorageUri` has the `vscode-userdata` scheme, the audio is played by its `file`
        // address (`WebviewAudioSink`), and VS Code compares schemes: under the former, a 401.
        vscode.Uri.file(vscode.Uri.joinPath(this.globalStorageUri, "cache").fsPath),
        vscode.Uri.joinPath(this.extensionUri, "media")
      ]
    };

    webviewView.webview.html = this.renderHtml(webviewView.webview);
    this.disposables.push(this.sink.attach(webviewView.webview));
    this.disposables.push(webviewView.webview.onDidReceiveMessage((raw: unknown) => this.onResponsesMessage(raw)));
    this.followActiveEditor();

    webviewView.onDidDispose(() => {
      this.sink.detach();
      this.stopFollowingEditor();
      this.view = undefined;
    });
  }

  /** The block "Dernière réponse": it draws what it gets, and starts nothing. */
  pushResponses(view: PanelResponsesView): void {
    this.responses = view;
    this.postResponses();
  }

  /** Who hears the block's buttons; each one is a click. */
  setResponseHandler(handler: (raw: unknown) => void): void {
    this.responseHandler = handler;
  }

  private postResponses(): void {
    if (this.responses !== undefined) {
      void this.view?.webview.postMessage({ type: "responses", view: this.responses });
    }
  }

  private onResponsesMessage(raw: unknown): void {
    const type = typeof raw === "object" && raw !== null ? (raw as { type?: unknown }).type : undefined;
    if (type === "responsesReady") {
      this.postResponses();
    } else if (type === "responseAction") {
      this.responseHandler?.(raw);
    }
  }

  /** Reveals the Panel view without stealing editor focus (ADR-001). */
  reveal(): void {
    if (this.view !== undefined) {
      this.view.show(true /* preserveFocus */);
      return;
    }
    // Never opened since the window loaded: there is no view to show yet, and the waiting bar
    // of the reading that asks for it would be seen by no one.
    void vscode.commands.executeCommand("llmVoice.playerView.focus", { preserveFocus: true });
  }

  /** True once `resolveWebviewView` has run at least once. Test hook. */
  get isResolved(): boolean {
    return this.view !== undefined;
  }

  /** The panel follows the editor and only displays it: none of these events starts a reading. */
  private followActiveEditor(): void {
    this.stopFollowingEditor();
    const push = (): void => this.sink.pushDocument(this.activeDocumentView());
    const stopReady = this.sink.onReady(push);
    this.editorWatch = [
      new vscode.Disposable(stopReady),
      vscode.window.onDidChangeActiveTextEditor(push),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor === vscode.window.activeTextEditor) {
          push();
        }
      })
    ];
    push();
  }

  private stopFollowingEditor(): void {
    for (const disposable of this.editorWatch) {
      disposable.dispose();
    }
    this.editorWatch = [];
  }

  /** The script line comes later than the rest: it reads the text, and the panel must not wait. */
  setScriptDescriber(describer: ScriptDescriber): void {
    this.scriptDescriber = describer;
  }

  /** A setting changed: the block is pushed again. Starts nothing. */
  refreshDocument(): void {
    this.scriptSeen = undefined;
    this.scriptPending = undefined;
    this.sink.pushDocument(this.activeDocumentView());
  }

  private scriptOf(document: vscode.TextDocument): PlayerScriptView | undefined {
    if (this.scriptDescriber === undefined) {
      return undefined;
    }
    const key = `${document.uri.toString()}#${document.version}`;
    if (this.scriptSeen?.key === key) {
      return this.scriptSeen.script;
    }
    if (this.scriptPending !== key && document.getText().length <= MAX_SCRIPT_CHARS) {
      this.scriptPending = key;
      void this.scriptDescriber({ uri: document.uri.toString(), languageId: document.languageId, text: document.getText() })
        .catch(() => undefined)
        .then((script) => {
          if (this.scriptPending === key) {
            this.scriptPending = undefined;
            this.scriptSeen = { key, script };
            this.sink.pushDocument(this.activeDocumentView());
          }
        });
    }
    return undefined;
  }

  private activeDocumentView(): ReturnType<typeof documentViewOf> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
      return documentViewOf(undefined);
    }
    const input: DocumentViewInput = {
      scheme: editor.document.uri.scheme,
      path: editor.document.uri.path,
      selections: editor.selections.map((selection) => ({
        startLine: selection.start.line,
        startColumn: selection.start.character,
        endLine: selection.end.line,
        endColumn: selection.end.character
      }))
    };
    const view = documentViewOf(input);
    const script = view !== null ? this.scriptOf(editor.document) : undefined;
    return view !== null && script !== undefined ? { ...view, script } : view;
  }

  dispose(): void {
    this.stopFollowingEditor();
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
        .toString(),
      responsesScriptUri: webview
        .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "player", "responses.js"))
        .toString(),
      responsesStyleUri: webview
        .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "player", "responses.css"))
        .toString()
    });
  }
}
