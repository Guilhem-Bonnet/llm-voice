/**
 * Pure formatting helpers shared by the Quick Pick and the view "Réponses"
 * (ADR-011): relative time, badge. No `vscode` import so these are
 * unit-testable directly.
 */

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

/** A `vscode.TreeView.badge` shape, without importing `vscode` (ADR-011 revision 2026-09-12: the same badge now also surfaces on the `llmVoice` activity bar icon). */
export interface InboxBadge {
  value: number;
  tooltip: string;
}

/** `undefined` clears the badge — `TreeView.badge = undefined` is how VS Code hides it once every reply is read. */
export function computeInboxBadge(unreadCount: number): InboxBadge | undefined {
  if (unreadCount <= 0) {
    return undefined;
  }
  return { value: unreadCount, tooltip: unreadCount === 1 ? "1 réponse non lue" : `${unreadCount} réponses non lues` };
}
