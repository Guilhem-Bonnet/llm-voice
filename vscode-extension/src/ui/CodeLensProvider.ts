/**
 * "▶ Lire cette section" CodeLens over every Markdown heading (CdC §69,
 * ADR-011). Gated by `llmVoice.codeLens.enabled`.
 */

import * as vscode from "vscode";
import { isHeadingLine } from "./heading.js";

export interface SpeakSectionArgs {
  uri: string;
  line: number;
}

export class MarkdownSpeakSectionCodeLensProvider implements vscode.CodeLensProvider {
  private readonly onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.onDidChangeCodeLensesEmitter.event;

  constructor(private readonly isEnabled: () => boolean = () => true) {}

  /** Call when `llmVoice.codeLens.enabled` changes to force a refresh. */
  refresh(): void {
    this.onDidChangeCodeLensesEmitter.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!this.isEnabled()) {
      return [];
    }
    const lenses: vscode.CodeLens[] = [];
    for (let line = 0; line < document.lineCount; line++) {
      const text = document.lineAt(line).text;
      if (isHeadingLine(text)) {
        const range = new vscode.Range(line, 0, line, text.length);
        const args: SpeakSectionArgs = { uri: document.uri.toString(), line };
        lenses.push(
          new vscode.CodeLens(range, {
            title: "▶ Lire cette section",
            command: "llmVoice.speakSection",
            arguments: [args]
          })
        );
      }
    }
    return lenses;
  }

  dispose(): void {
    this.onDidChangeCodeLensesEmitter.dispose();
  }
}
