/**
 * The view "Réponses" and the panel's block, fed from the same list. A webview and not
 * a Tree View: a tree row has one line, and shows its buttons on hover only. The id
 * `llmVoice.inboxView` stays, a user's layout may name it.
 */

import * as vscode from "vscode";
import type { InboxEntry } from "../../core/inbox.js";
import { computeInboxBadge } from "../../claude/inboxFormat.js";
import { ResponsesFeed, type ResponseActions } from "../../claude/ResponsesFeed.js";
import { getNonce } from "../player/playerHtml.js";
import type { PlayerViewProvider } from "../player/PlayerViewProvider.js";
import { buildResponsesHtml } from "./responsesHtml.js";

/** "il y a 12 min" stays true in a panel left open. */
const AGE_REFRESH_MS = 60_000;

export interface ResponsesViewOptions {
  extensionUri: vscode.Uri;
  player: PlayerViewProvider;
  list: () => Promise<readonly InboxEntry[]>;
  actions: ResponseActions;
  onError: (error: unknown) => void;
}

export class ResponsesViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "llmVoice.inboxView";

  private readonly feed: ResponsesFeed;
  private view: vscode.WebviewView | undefined;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(private readonly options: ResponsesViewOptions) {
    this.feed = new ResponsesFeed({
      list: options.list,
      actions: options.actions,
      onChange: () => this.publish()
    });
    options.player.setResponseHandler((raw) => this.handle(raw));
    this.timer = setInterval(() => this.publish(), AGE_REFRESH_MS);
  }

  refresh(): Promise<void> {
    return this.feed.refresh();
  }

  /** What the view's icon shows. VS Code has no view to put it on before the first opening. */
  get shownBadge(): vscode.ViewBadge | undefined {
    return this.view?.badge;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    const media = vscode.Uri.joinPath(this.options.extensionUri, "media", "player");
    const { webview } = webviewView;
    webview.options = { enableScripts: true, localResourceRoots: [media] };
    webview.html = buildResponsesHtml({
      nonce: getNonce(),
      cspSource: webview.cspSource,
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(media, "responses.js")).toString(),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(media, "responses.css")).toString()
    });
    const subscription = webview.onDidReceiveMessage((raw: { type?: unknown } | undefined) => {
      if (raw?.type === "responsesReady") {
        this.publish();
      } else {
        this.handle(raw);
      }
    });
    webviewView.onDidDispose(() => {
      subscription.dispose();
      this.view = undefined;
    });
    this.publish();
  }

  private handle(raw: unknown): void {
    this.feed.handle(raw).catch(this.options.onError);
  }

  private publish(): void {
    this.options.player.pushResponses(this.feed.panelView());
    if (this.view !== undefined) {
      this.view.badge = computeInboxBadge(this.feed.unreadCount);
      void this.view.webview.postMessage({ type: "responsesList", view: this.feed.listView() });
    }
  }

  dispose(): void {
    clearInterval(this.timer);
  }
}
