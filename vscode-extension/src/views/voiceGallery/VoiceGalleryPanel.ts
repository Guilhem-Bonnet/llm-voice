/**
 * The voice gallery's tab: one instance, webview plumbing only. What each message
 * does is `VoiceGalleryController`; what the document says is `voiceGalleryHtml.ts`.
 * `localResourceRoots` is what the page can load at all: its own files, the included
 * samples and the trial phrases on this machine.
 */

import * as vscode from "vscode";
import { getNonce } from "../player/playerHtml.js";
import { VoiceGalleryController, type VoiceGalleryDeps } from "./VoiceGalleryController.js";
import { buildVoiceGalleryHtml } from "./voiceGalleryHtml.js";

export type VoiceGalleryPanelDeps = Omit<VoiceGalleryDeps, "sampleUri" | "synthesize"> & {
  /** Writes the audio into `trialDir` and returns its file path. */
  synthesizeToFile(
    binding: Parameters<VoiceGalleryDeps["synthesize"]>[0],
    text: string,
    signal: AbortSignal
  ): Promise<string>;
  trialDir: vscode.Uri;
};

export class VoiceGalleryPanel {
  private static current: VoiceGalleryPanel | undefined;
  private static observer: ((message: unknown) => void) | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly controller: VoiceGalleryController;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    deps: VoiceGalleryPanelDeps,
    private readonly extensionUri: vscode.Uri
  ) {
    this.panel = vscode.window.createWebviewPanel("llmVoice.voiceGallery", "Galerie de voix", vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.joinPath(extensionUri, "media", "voiceGallery"),
        vscode.Uri.joinPath(extensionUri, "media", "voices"),
        // `globalStorageUri` has the `vscode-userdata` scheme, the phrases are played by their
        // `file` address, and VS Code compares schemes: under the former, every phrase got a 401.
        vscode.Uri.file(deps.trialDir.fsPath)
      ]
    });
    const webview = this.panel.webview;
    this.controller = new VoiceGalleryController(
      {
        ...deps,
        sampleUri: (path) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", path)).toString(),
        synthesize: async (binding, text, signal) => {
          const filePath = await deps.synthesizeToFile(binding, text, signal);
          return { uri: webview.asWebviewUri(vscode.Uri.file(filePath)).toString() };
        }
      },
      (message) => {
        VoiceGalleryPanel.observer?.(message);
        void webview.postMessage(message);
      }
    );
    webview.html = this.renderHtml();
    this.disposables.push(
      webview.onDidReceiveMessage((message: unknown) => {
        void this.controller.handle(message);
      }),
      this.panel.onDidChangeViewState((event) => {
        if (event.webviewPanel.visible) {
          void this.controller.refreshHealth();
        }
      }),
      this.panel.onDidDispose(() => this.dispose())
    );
  }

  static open(deps: VoiceGalleryPanelDeps, extensionUri: vscode.Uri): void {
    if (VoiceGalleryPanel.current !== undefined) {
      VoiceGalleryPanel.current.panel.reveal();
      return;
    }
    VoiceGalleryPanel.current = new VoiceGalleryPanel(deps, extensionUri);
  }

  /** The voice changed outside the tab, which keeps showing the truth. */
  static notifyVoiceChanged(): void {
    void VoiceGalleryPanel.current?.controller.voiceChanged();
  }

  /** Test-only, like `ProfileEditorPanel`'s: reached through `Pipeline`'s forwarders. */
  static testOnlyHtml(): string | undefined {
    return VoiceGalleryPanel.current?.panel.webview.html;
  }

  static async testOnlyDispatch(message: unknown): Promise<void> {
    if (VoiceGalleryPanel.current === undefined) {
      throw new Error("VoiceGalleryPanel.testOnlyDispatch: gallery not open");
    }
    await VoiceGalleryPanel.current.controller.handle(message);
  }

  static testOnlyObserve(observer: ((message: unknown) => void) | undefined): void {
    VoiceGalleryPanel.observer = observer;
  }

  static testOnlyClose(): void {
    VoiceGalleryPanel.current?.dispose();
  }

  private renderHtml(): string {
    const webview = this.panel.webview;
    const asset = (name: string): string =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "voiceGallery", name)).toString();
    return buildVoiceGalleryHtml({
      nonce: getNonce(),
      cspSource: webview.cspSource,
      scriptUri: asset("voiceGallery.js"),
      styleUri: asset("voiceGallery.css")
    });
  }

  private dispose(): void {
    if (VoiceGalleryPanel.current === this) {
      VoiceGalleryPanel.current = undefined;
    }
    this.controller.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.panel.dispose();
  }
}
