/**
 * `ProfileStore` with what needs a real VS Code: the settings the migration reads,
 * its messages, and opening the file in an editor.
 */

import * as vscode from "vscode";
import { readModesBySource } from "./bySource.js";
import type { VoiceNotice } from "./migrations.js";
import { ProfileStore, type ProfileStoreEnvironment, type StateStore } from "./profileStore.js";
import { describeVoice } from "./voiceResolution.js";

const KEEP_SAMPLE_LABEL = "Garder mon échantillon";

export class ProfileRepository extends ProfileStore {
  constructor(globalStorageDir: string, globalState: StateStore) {
    const environment: ProfileStoreEnvironment = {
      ttsSettings: () => {
        const config = vscode.workspace.getConfiguration("llmVoice");
        return {
          provider: config.get<string>("tts.provider", "auto"),
          baseUrl: config.get<string>("tts.baseUrl", "http://127.0.0.1:8880")
        };
      },
      modesBySource: () => readModesBySource(vscode.workspace.getConfiguration("llmVoice")),
      legacyDefaultProfile: () => vscode.workspace.getConfiguration("llmVoice").get<string>("defaultProfile"),
      onVoiceNotice: (notice) => this.showVoiceNotice(notice)
    };
    super(globalStorageDir, globalState, environment);
  }

  get uri(): vscode.Uri {
    return vscode.Uri.file(this.filePath);
  }

  /** Opens `profiles.json` for manual editing (`Open Profiles` command). */
  async openInEditor(): Promise<void> {
    await this.load();
    const document = await vscode.workspace.openTextDocument(this.uri);
    await vscode.window.showTextDocument(document);
  }

  private showVoiceNotice(notice: VoiceNotice): void {
    if (notice.kind === "voice-reset") {
      void vscode.window.showInformationMessage(
        "LLM Voice : Voix réinitialisée, la voix système parle désormais. « Choisir la voix » pour en changer."
      );
      return;
    }
    void this.askSampleOrVoice(notice.voice);
  }

  /**
   * ADR-017 §2: we cannot know which of the two the user set last, so nothing
   * changes until they say; `chooseVoice` then keeps them exclusive.
   */
  private async askSampleOrVoice(voiceId: string): Promise<void> {
    const label = describeVoice({ voice: voiceId });
    const useVoice = `Utiliser la voix ${label}`;
    const choice = await vscode.window.showInformationMessage(
      `LLM Voice : votre échantillon est utilisé à la place de la voix ${label}.`,
      useVoice,
      KEEP_SAMPLE_LABEL
    );
    if (choice !== useVoice && choice !== KEEP_SAMPLE_LABEL) {
      return;
    }
    const { speed: _speed, ...current } = await this.getGlobalVoice();
    const { referenceAudio: _sample, ...withoutSample } = current;
    const { voice: _voice, ...withoutVoice } = current;
    await this.setGlobalVoice(choice === useVoice ? withoutSample : withoutVoice);
  }
}
