/**
 * Pure formatting helpers shared by the Quick Pick and the Tree View
 * (ADR-011): provider icon, relative time, entries. No `vscode` import so
 * these are unit-testable directly.
 */

import type { InboxProviderId } from "../core/inbox.js";

/** Codicon per known provider (ADR-011: codicons only, never emoji). */
export function inboxProviderIcon(provider: InboxProviderId): string {
  switch (provider) {
    case "claude-code":
      return "$(comment-discussion)";
    case "codex":
      return "$(terminal)";
    case "gemini-cli":
    case "gemini":
      return "$(star-full)";
    case "copilot":
      return "$(github)";
    default:
      return "$(circle-outline)";
  }
}

/** "il y a X min" (CdC's inbox UX), coarse enough to not need live refresh. */
export function formatRelativeTime(capturedAt: number, now: number = Date.now()): string {
  const diffMs = Math.max(0, now - capturedAt);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) {
    return "à l'instant";
  }
  if (minutes < 60) {
    return `il y a ${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `il y a ${hours} h`;
  }
  const days = Math.floor(hours / 24);
  return `il y a ${days} j`;
}
