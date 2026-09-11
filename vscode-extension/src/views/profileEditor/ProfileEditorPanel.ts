/**
 * `LLM Voice: Edit Profile` webview (S8.2, CdC §49). Same security posture
 * as `views/player/PlayerViewProvider.ts`: a fresh nonce per render, a
 * strict CSP, `localResourceRoots` limited to this panel's own `media/`
 * folder, and no profile-controlled string ever reaching the HTML string —
 * only the static shell built by `profileEditorHtml.ts` does that; every
 * profile field travels over `postMessage` instead (`media/profileEditor/profileEditor.js`).
 *
 * This class only holds webview plumbing (message routing, panel
 * lifecycle); `ProfileEditorDeps` is the seam to `Pipeline` — a plain
 * interface of async functions rather than the whole `Pipeline` class, so
 * this file (and its tests) never need a `vscode.ExtensionContext`.
 */

import * as vscode from "vscode";
import type { VoiceProfile } from "../../core/profile.js";
import { isEnglishVoice } from "../../profiles/voiceBrowser.js";
import { validateProfileFormData } from "../../profiles/profileForm.js";
import type { TtsParameterDescriptor, Voice } from "../../core/tts.js";
import { buildProfileEditorHtml } from "./profileEditorHtml.js";
import { getNonce } from "../player/playerHtml.js";

export interface ProfileEditorDeps {
  getProfile(id: string): Promise<VoiceProfile>;
  /** Validated save; throws with a French message on failure. */
  saveProfile(id: string, next: VoiceProfile): Promise<VoiceProfile>;
  duplicateProfile(id: string): Promise<VoiceProfile>;
  deleteProfile(id: string): Promise<void>;
  /** `LLM Voice: Test Voice`-equivalent for an unsaved, in-editor profile. */
  testProfile(profile: VoiceProfile): Promise<void>;
  /** The current TTS provider's tunables, for the dynamic parameters section (ADR-005). */
  listParameters(profile: VoiceProfile): Promise<readonly TtsParameterDescriptor[]>;
  /** Reuses the `Browse Voices` picker (volet 1); `undefined` if the user cancelled. */
  pickVoice(profile: VoiceProfile): Promise<Voice | undefined>;
}

export interface WebviewToExtensionMessage {
  type: "ready" | "save" | "test" | "duplicate" | "delete" | "browseVoices";
  profile?: unknown;
}

export class ProfileEditorPanel {
  private static readonly panels = new Map<string, ProfileEditorPanel>();

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private profileId: string;

  private constructor(
    private readonly deps: ProfileEditorDeps,
    private readonly extensionUri: vscode.Uri,
    profileId: string
  ) {
    this.profileId = profileId;
    this.panel = vscode.window.createWebviewPanel(
      "llmVoice.profileEditor",
      "LLM Voice — Profil",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media", "profileEditor")]
      }
    );
    this.panel.webview.html = this.renderHtml();
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
        void this.handleMessage(message);
      })
    );
    this.panel.onDidDispose(() => this.dispose());
  }

  static async open(deps: ProfileEditorDeps, extensionUri: vscode.Uri, profileId: string): Promise<void> {
    const existing = ProfileEditorPanel.panels.get(profileId);
    if (existing !== undefined) {
      existing.panel.reveal();
      return;
    }
    const created = new ProfileEditorPanel(deps, extensionUri, profileId);
    ProfileEditorPanel.panels.set(profileId, created);
  }

  /** Test-only: the live webview behind an open editor, for CSP/message-round-trip assertions. Not a public extension API. */
  static testOnlyWebviewFor(profileId: string): vscode.Webview | undefined {
    return ProfileEditorPanel.panels.get(profileId)?.panel.webview;
  }

  /**
   * Test-only: simulates a message the real `media/profileEditor/profileEditor.js`
   * would have posted, without a `postMessage` round-trip (there is no way
   * to script the webview's own JS engine from an extension-host test).
   * Not a public extension API.
   */
  static async testOnlyDispatch(profileId: string, message: WebviewToExtensionMessage): Promise<void> {
    const panel = ProfileEditorPanel.panels.get(profileId);
    if (panel === undefined) {
      throw new Error(`ProfileEditorPanel.testOnlyDispatch: no open editor for "${profileId}"`);
    }
    await panel.handleMessage(message);
  }

  /** Test-only: closes an open editor directly, for test teardown. Not a public extension API. */
  static testOnlyClose(profileId: string): void {
    ProfileEditorPanel.panels.get(profileId)?.dispose();
  }

  private renderHtml(): string {
    const webview = this.panel.webview;
    return buildProfileEditorHtml({
      nonce: getNonce(),
      cspSource: webview.cspSource,
      scriptUri: webview
        .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "profileEditor", "profileEditor.js"))
        .toString(),
      styleUri: webview
        .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "profileEditor", "profileEditor.css"))
        .toString()
    });
  }

  private async handleMessage(message: WebviewToExtensionMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        await this.sendLoad();
        return;
      case "save":
        await this.handleSave(message.profile);
        return;
      case "test":
        await this.handleTest(message.profile);
        return;
      case "duplicate":
        await this.handleDuplicate();
        return;
      case "delete":
        await this.handleDelete();
        return;
      case "browseVoices":
        await this.handleBrowseVoices(message.profile);
        return;
      default:
        return;
    }
  }

  private async sendLoad(): Promise<void> {
    const profile = await this.deps.getProfile(this.profileId);
    const parameters = await this.deps.listParameters(profile).catch(() => []);
    await this.panel.webview.postMessage({ type: "load", profile, parameters });
  }

  private async handleSave(rawProfile: unknown): Promise<void> {
    const candidate = { ...(rawProfile as Record<string, unknown>), id: this.profileId };
    const validation = validateProfileFormData(candidate);
    if (!validation.ok) {
      await this.panel.webview.postMessage({ type: "saveResult", ok: false, errors: validation.errors });
      return;
    }
    try {
      await this.deps.saveProfile(this.profileId, validation.profile);
      await this.panel.webview.postMessage({ type: "saveResult", ok: true });
      void vscode.window.showInformationMessage(`LLM Voice : profil « ${validation.profile.label} » enregistré.`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.panel.webview.postMessage({ type: "saveResult", ok: false, errors: [detail] });
    }
  }

  private async handleTest(rawProfile: unknown): Promise<void> {
    const candidate = { ...(rawProfile as Record<string, unknown>), id: this.profileId };
    const validation = validateProfileFormData(candidate);
    if (!validation.ok) {
      await this.panel.webview.postMessage({ type: "testResult", ok: false, error: validation.errors.join(" ; ") });
      return;
    }
    try {
      await this.deps.testProfile(validation.profile);
      await this.panel.webview.postMessage({ type: "testResult", ok: true });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.panel.webview.postMessage({ type: "testResult", ok: false, error: detail });
    }
  }

  private async handleDuplicate(): Promise<void> {
    const copy = await this.deps.duplicateProfile(this.profileId);
    void vscode.window.showInformationMessage(`LLM Voice : profil « ${copy.label} » créé.`);
    this.panel.dispose();
    await ProfileEditorPanel.open(this.deps, this.extensionUri, copy.id);
  }

  private async handleDelete(): Promise<void> {
    const profile = await this.deps.getProfile(this.profileId).catch(() => undefined);
    const confirm = await vscode.window.showWarningMessage(
      `LLM Voice : supprimer le profil « ${profile?.label ?? this.profileId} » ?`,
      { modal: true },
      "Supprimer"
    );
    if (confirm !== "Supprimer") {
      return;
    }
    await this.deps.deleteProfile(this.profileId);
    void vscode.window.showInformationMessage("LLM Voice : profil supprimé.");
    this.panel.dispose();
  }

  private async handleBrowseVoices(rawProfile: unknown): Promise<void> {
    const candidate = { ...(rawProfile as Record<string, unknown>), id: this.profileId };
    const validation = validateProfileFormData(candidate);
    const profile = validation.ok ? validation.profile : await this.deps.getProfile(this.profileId);
    const picked = await this.deps.pickVoice(profile);
    if (picked === undefined) {
      return;
    }
    const warning = isEnglishVoice(picked, profile.language)
      ? "Voix anglophone pour un profil dont la langue n'est pas l'anglais."
      : undefined;
    await this.panel.webview.postMessage({
      type: "voiceSelected",
      voiceId: picked.id,
      ...(warning !== undefined ? { warning } : {})
    });
  }

  dispose(): void {
    ProfileEditorPanel.panels.delete(this.profileId);
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.panel.dispose();
  }
}
