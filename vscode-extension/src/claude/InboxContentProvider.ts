/**
 * Read-only virtual document for "Open full response" (`llm-voice-inbox:`
 * scheme). The URI path carries the entry id; content is fetched from
 * `InboxRepository` on demand, never cached — the inbox is the single
 * source of truth (ADR-004).
 */

import * as vscode from "vscode";
import type { InboxRepository } from "./InboxRepository.js";

export const INBOX_CONTENT_SCHEME = "llm-voice-inbox";

export function inboxContentUri(id: string): vscode.Uri {
  return vscode.Uri.from({ scheme: INBOX_CONTENT_SCHEME, path: `/${id}.txt` });
}

function idFromUri(uri: vscode.Uri): string {
  return uri.path.replace(/^\//, "").replace(/\.txt$/, "");
}

export class InboxContentProvider implements vscode.TextDocumentContentProvider {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(private readonly repository: InboxRepository) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const id = idFromUri(uri);
    const entries = await this.repository.list();
    const entry = entries.find((candidate) => candidate.id === id);
    if (entry === undefined) {
      return "LLM Voice : ce message d'inbox n'existe plus.";
    }
    const header = `${entry.message.provider}${entry.message.cwd !== undefined ? ` — ${entry.message.cwd}` : ""}`;
    return `${header}\n${"=".repeat(header.length)}\n\n${entry.message.message}\n`;
  }

  dispose(): void {
    this.onDidChangeEmitter.dispose();
  }
}
