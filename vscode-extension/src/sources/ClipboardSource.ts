/**
 * `SourceAdapter` for "Speak Clipboard" (CdC §10.3). The command handler
 * (`src/commands/index.ts`) already reads `vscode.env.clipboard.readText()`
 * once and forwards it via `CaptureContext.text` so the capture itself is
 * free of a second, racy clipboard read; falling back to reading the
 * clipboard here as well keeps `capture()` usable on its own (e.g. tests, or
 * a future non-command entry point).
 */

import * as vscode from "vscode";
import type { CaptureContext, SourceAdapter, SourceDocument, SourceType } from "../core/source.js";

export class ClipboardSource implements SourceAdapter {
  readonly id = "source-clipboard";
  readonly sourceType: SourceType = "clipboard";

  canCapture(context: CaptureContext): boolean {
    return context.scope === "clipboard";
  }

  async capture(context: CaptureContext, signal?: AbortSignal): Promise<SourceDocument> {
    const text = context.text ?? (await vscode.env.clipboard.readText());
    if (signal?.aborted === true) {
      throw new DOMException("Aborted", "AbortError");
    }
    return {
      id: `clipboard-${Date.now()}`,
      sourceType: this.sourceType,
      title: "Presse-papiers",
      rawText: text,
      capturedAt: Date.now()
    };
  }
}
