/**
 * L'onglet Distribution (première section du Studio) : une seule instance, la plomberie de la
 * webview seulement. Ce que fait chaque message : `CastPanelController`.
 * `localResourceRoots` en `vscode.Uri.file(...)` : sous `vscode-userdata`, chaque écoute
 * répondait 401 (bug déjà rencontré dans la galerie).
 */

import * as vscode from "vscode";
import { getNonce } from "../player/playerHtml.js";
import { voiceGalleryCsp } from "../voiceGallery/voiceGalleryHtml.js";
import { CastPanelController, type CastPanelDeps } from "./CastPanelController.js";
import type { CastPanelState } from "./castPanelModel.js";

export type CastPanelOpenDeps = Omit<CastPanelDeps, "listen" | "sample"> & {
  listenToFile(roleId: string, voiceId: string | undefined, signal: AbortSignal): Promise<string>;
  sampleToFile(voiceId: string, signal: AbortSignal): Promise<string>;
  trialDir: vscode.Uri;
  documentKey: string;
};

export class CastPanel {
  private static current: CastPanel | undefined;
  private static observer: ((message: unknown) => void) | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly controller: CastPanelController;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    deps: CastPanelOpenDeps,
    extensionUri: vscode.Uri,
    readonly documentKey: string
  ) {
    this.panel = vscode.window.createWebviewPanel("llmVoice.castPanel", "Distribution", vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media", "castPanel"), vscode.Uri.file(deps.trialDir.fsPath)]
    });
    const webview = this.panel.webview;
    const asUri = (filePath: string): string => webview.asWebviewUri(vscode.Uri.file(filePath)).toString();
    this.controller = new CastPanelController(
      {
        ...deps,
        listen: async (roleId, voiceId, signal) => ({ uri: asUri(await deps.listenToFile(roleId, voiceId, signal)) }),
        sample: async (voiceId, signal) => ({ uri: asUri(await deps.sampleToFile(voiceId, signal)) })
      },
      (message) => {
        CastPanel.observer?.(message);
        void webview.postMessage(message);
      }
    );
    const asset = (name: string): string => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "castPanel", name)).toString();
    const nonce = getNonce();
    webview.html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${voiceGalleryCsp(nonce, webview.cspSource)}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${asset("castPanel.css")}">
<title>Distribution</title>
</head>
<body>
<main class="page" id="page"><p class="muted">Lecture du document…</p></main>
<script nonce="${nonce}" src="${asset("castPanel.js")}"></script>
</body>
</html>`;
    this.disposables.push(
      webview.onDidReceiveMessage((message: unknown) => {
        void this.controller.handle(message);
      }),
      this.panel.onDidDispose(() => this.dispose())
    );
  }

  /** Un onglet ; ouvert sur un autre document, il est refait pour celui-ci. */
  static open(deps: CastPanelOpenDeps, extensionUri: vscode.Uri): void {
    if (CastPanel.current !== undefined) {
      if (CastPanel.current.documentKey === deps.documentKey) {
        CastPanel.current.panel.reveal();
        void CastPanel.current.controller.refresh();
        return;
      }
      CastPanel.current.dispose();
    }
    CastPanel.current = new CastPanel(deps, extensionUri, deps.documentKey);
  }

  static testOnlyState(): CastPanelState | undefined {
    return CastPanel.current?.controller.lastState;
  }

  static async testOnlyDispatch(message: unknown): Promise<void> {
    if (CastPanel.current === undefined) {
      throw new Error("CastPanel.testOnlyDispatch: panel not open");
    }
    await CastPanel.current.controller.handle(message);
  }

  static testOnlyObserve(observer: ((message: unknown) => void) | undefined): void {
    CastPanel.observer = observer;
  }

  static testOnlyClose(): void {
    CastPanel.current?.dispose();
  }

  private dispose(): void {
    if (CastPanel.current === this) {
      CastPanel.current = undefined;
    }
    this.controller.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.panel.dispose();
  }
}
