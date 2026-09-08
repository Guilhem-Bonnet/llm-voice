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
  openProfiles(): Promise<void>;
  openInbox(): Promise<void>;
  speakLatestClaudeResponse(): Promise<void>;
  clearAudioCache(): Promise<void>;
  verifyLocalMode(): Promise<void>;
  installClaudeHook(): Promise<void>;
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

  openProfiles(): Promise<void> {
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

  private async notWired(): Promise<void> {
    this.output.appendLine(NOT_WIRED_MESSAGE);
    // Fire-and-forget: `showInformationMessage` only resolves once the user
    // dismisses the notification, and command execution must never block on
    // that (AC: no crash, no hang).
    void vscode.window.showInformationMessage(NOT_WIRED_MESSAGE);
  }
}
