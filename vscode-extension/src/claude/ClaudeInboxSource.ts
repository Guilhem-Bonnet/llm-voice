/**
 * `SourceAdapter` for `scope: "inbox-message"` (ADR-003/ADR-007): turns one
 * inbox entry into a `SourceDocument` on demand. Only ever reached by the
 * pipeline when a command the user triggered captures this scope (Speak in
 * the list "Réponses", its Quick Pick, or `speakLatestResponse`) — never from
 * `InboxWatcher`'s `changed` event (zero autoplay, ADR-003).
 *
 * Free of any `vscode` import: `InboxRepository` already is, and this class
 * only adds pure string formatting on top.
 */

import type { CaptureContext, InboxEntry, SourceAdapter, SourceDocument, SourceType } from "../core/index.js";
import type { InboxRepository } from "./InboxRepository.js";
import { responseTitle } from "./responseRow.js";

/** What the player shows while a reply is read: the same title as its line in the list. */
export function inboxEntryTitle(entry: InboxEntry): string {
  return responseTitle(entry);
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
      throw new Error("LLM Voice : réponse non précisée.");
    }
    const entries = await this.repository.list(signal);
    const entry = entries.find((candidate) => candidate.id === id);
    if (entry === undefined) {
      throw new Error("LLM Voice : cette réponse n'existe plus.");
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
