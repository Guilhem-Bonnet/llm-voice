/**
 * Seam between commands (CdC §7) and the synthesis/playback pipeline.
 *
 * S3.4 wires the VS Code surface only — the real pipeline lands in S3.1-S3.3
 * and gets connected in S3.5. `NotWiredPipeline` implements this interface so
 * every command is safe to invoke today: it reports "not wired yet" instead
 * of throwing.
 */

import * as vscode from "vscode";
import type { CaptureContext } from "../core/source.js";

export interface PipelineFacade {
  /** Captures `source` and starts a new reading session. */
  start(source: CaptureContext): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  previousSegment(): Promise<void>;
  nextSegment(): Promise<void>;
  selectProfile(): Promise<void>;
  /** Non-interactive: selects a profile by id without a Quick Pick (CdC §47). */
  selectProfileById(id: string): Promise<void>;
  openProfiles(): Promise<void>;
  duplicateProfile(): Promise<void>;
  deleteProfile(): Promise<void>;
  importProfile(): Promise<void>;
  exportProfile(): Promise<void>;
  setDefaultProfile(): Promise<void>;
  /** `LLM Voice: Test Voice` (CdC §50). */
  testVoice(): Promise<void>;
  /** `LLM Voice: Provider Status` (CdC §51). */
  providerStatus(): Promise<void>;
  /** `LLM Voice: Show Performance Report` (S6.2): TTFA/synthesis/cache stats of the current session. */
  performanceReport(): Promise<void>;
  /** `LLM Voice: Set Provider API Key` (AC-17). */
  setProviderApiKey(): Promise<void>;
  /** `LLM Voice: Clear Provider API Key` (AC-17). */
  clearProviderApiKey(): Promise<void>;
  openInbox(): Promise<void>;
  speakLatestClaudeResponse(): Promise<void>;
  clearAudioCache(): Promise<void>;
  verifyLocalMode(): Promise<void>;
  installClaudeHook(): Promise<void>;
  uninstallClaudeHook(): Promise<void>;
  /** `LLM Voice: Install Local Voice (Piper)` (S7.1, ADR-009 §3). */
  installPiperVoice(): Promise<void>;
}

const NOT_WIRED_MESSAGE = "LLM Voice : pipeline non câblé (S3.5)";

/** No-op `PipelineFacade` used until S3.5 wires the real pipeline. */
export class NotWiredPipeline implements PipelineFacade {
  constructor(private readonly output: vscode.OutputChannel) {}

  start(): Promise<void> {
    return this.notWired();
  }

  play(): Promise<void> {
    return this.notWired();
  }

  pause(): Promise<void> {
    return this.notWired();
  }

  stop(): Promise<void> {
    return this.notWired();
  }

  previousSegment(): Promise<void> {
    return this.notWired();
  }

  nextSegment(): Promise<void> {
    return this.notWired();
  }

  selectProfile(): Promise<void> {
    return this.notWired();
  }

  selectProfileById(): Promise<void> {
    return this.notWired();
  }

  openProfiles(): Promise<void> {
    return this.notWired();
  }

  duplicateProfile(): Promise<void> {
    return this.notWired();
  }

  deleteProfile(): Promise<void> {
    return this.notWired();
  }

  importProfile(): Promise<void> {
    return this.notWired();
  }

  exportProfile(): Promise<void> {
    return this.notWired();
  }

  setDefaultProfile(): Promise<void> {
    return this.notWired();
  }

  testVoice(): Promise<void> {
    return this.notWired();
  }

  providerStatus(): Promise<void> {
    return this.notWired();
  }

  performanceReport(): Promise<void> {
    return this.notWired();
  }

  setProviderApiKey(): Promise<void> {
    return this.notWired();
  }

  clearProviderApiKey(): Promise<void> {
    return this.notWired();
  }

  openInbox(): Promise<void> {
    return this.notWired();
  }

  speakLatestClaudeResponse(): Promise<void> {
    return this.notWired();
  }

  clearAudioCache(): Promise<void> {
    return this.notWired();
  }

  verifyLocalMode(): Promise<void> {
    return this.notWired();
  }

  installClaudeHook(): Promise<void> {
    return this.notWired();
  }

  uninstallClaudeHook(): Promise<void> {
    return this.notWired();
  }

  installPiperVoice(): Promise<void> {
    return this.notWired();
  }

  private async notWired(): Promise<void> {
    this.output.appendLine(NOT_WIRED_MESSAGE);
    // Fire-and-forget: `showInformationMessage` only resolves once the user
    // dismisses the notification, and command execution must never block on
    // that (AC: no crash, no hang).
    void vscode.window.showInformationMessage(NOT_WIRED_MESSAGE);
  }
}
