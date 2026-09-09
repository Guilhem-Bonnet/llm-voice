/**
 * `SourceAdapter` for `scope: "inbox-message"` (ADR-003/ADR-007): turns one
 * inbox entry into a `SourceDocument` on demand. Only ever reached by the
 * pipeline when a command the user triggered captures this scope (Speak in
 * the Quick Pick / Tree View, or `speakLatestClaudeResponse`) — never from
 * `InboxWatcher`'s `changed` event (zero autoplay, ADR-003).
 *
 * Free of any `vscode` import: `InboxRepository` already is, and this class
 * only adds pure string formatting on top.
 */

import * as path from "node:path";
import type { CaptureContext, InboxEntry, SourceAdapter, SourceDocument, SourceType } from "../core/index.js";
import type { InboxRepository } from "./InboxRepository.js";

function firstLineOf(text: string): string {
  const line = text.split(/\r?\n/, 1)[0] ?? "";
  return line.trim();
}

/** `provider • basename(cwd)` — the label used across Quick Pick/Tree/title. */
export function inboxEntrySummary(entry: InboxEntry): string {
  const cwdPart = entry.message.cwd !== undefined ? ` • ${path.basename(entry.message.cwd)}` : "";
  return `${entry.message.provider}${cwdPart}`;
}

/** `provider • basename(cwd) — première ligne du message`. */
export function inboxEntryTitle(entry: InboxEntry): string {
  const summary = inboxEntrySummary(entry);
  const firstLine = firstLineOf(entry.message.message);
  return firstLine.length > 0 ? `${summary} — ${firstLine}` : summary;
}

export class ClaudeInboxSource implements SourceAdapter {
  readonly id = "source-claude-inbox";
  // `SourceType` has no per-provider variant beyond "claude-code": every
  // inbox-backed capture (Claude Code, Codex, Gemini, generic CLI, D8) is
  // tagged this way; the actual provider is preserved in `metadata.provider`
  // and surfaces in the title.
  readonly sourceType: SourceType = "claude-code";

  constructor(private readonly repository: InboxRepository) {}

  canCapture(context: CaptureContext): boolean {
    return context.scope === "inbox-message" && context.inboxMessageId !== undefined;
  }

  async capture(context: CaptureContext, signal?: AbortSignal): Promise<SourceDocument> {
    const id = context.inboxMessageId;
    if (id === undefined) {
      throw new Error("LLM Voice : identifiant de message d'inbox manquant.");
    }
    const entries = await this.repository.list(signal);
    const entry = entries.find((candidate) => candidate.id === id);
    if (entry === undefined) {
      throw new Error("LLM Voice : ce message d'inbox n'existe plus.");
    }
    return {
      id: `inbox-${entry.id}`,
      sourceType: this.sourceType,
      title: inboxEntryTitle(entry),
      rawText: entry.message.message,
      capturedAt: entry.message.capturedAt,
      metadata: {
        inboxId: entry.id,
        provider: entry.message.provider,
        sessionId: entry.message.sessionId,
        ...(entry.message.cwd !== undefined ? { cwd: entry.message.cwd } : {})
      }
    };
  }
}
