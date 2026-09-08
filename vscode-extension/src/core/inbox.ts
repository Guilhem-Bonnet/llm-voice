/**
 * Open inbox contract: the directory of agent messages is the single source of
 * truth. See ADR-003 (collector) and ADR-004 (storage), decisions D3 and D8.
 */

/** Provider ids known today; the field stays open for third-party tools (D8). */
export type KnownInboxProviderId =
  | "claude-code"
  | "codex"
  | "gemini-cli"
  | "copilot"
  | "external";

/** Identifier of the tool that deposited a message; free-form by design. */
export type InboxProviderId = string;

/**
 * One JSON file dropped in the inbox directory. `schemaVersion` is the only
 * extension point: an unknown version is reported, never guessed (ADR-003).
 */
export interface InboxMessage {
  schemaVersion: 1;
  provider: InboxProviderId;
  sessionId: string;
  /** Epoch milliseconds at which the agent turn ended. */
  capturedAt: number;
  cwd?: string;
  title?: string;
  message: string;
}

/** An inbox message plus the state the extension derives around it. */
export interface InboxEntry {
  /** File name without extension; also the `globalState` read-state key. */
  id: string;
  fileName: string;
  message: InboxMessage;
  read: boolean;
  archived: boolean;
  /** File size in bytes, used to detect changes during polling. */
  bytes: number;
  modifiedAt: number;
}

/** What the directory watcher reports; polling emits the same events (ADR-004). */
export type InboxChangeKind = "added" | "changed" | "removed";

/** A single observed change in the inbox directory. */
export interface InboxChange {
  kind: InboxChangeKind;
  fileName: string;
}

/** Why a file present in the inbox could not be turned into an entry. */
export type InboxRejectionReason =
  | "invalid-json"
  | "unknown-schema-version"
  | "missing-required-field"
  | "empty-message";

/** A file that was seen but not accepted; surfaced, never silently dropped. */
export interface InboxRejection {
  fileName: string;
  reason: InboxRejectionReason;
}

/** Result of a full directory scan at startup or during a polling tick. */
export interface InboxScanResult {
  entries: readonly InboxEntry[];
  rejections: readonly InboxRejection[];
  scannedAt: number;
}

/** Read/write access to the inbox directory; deleting means deleting a file. */
export interface InboxStore {
  readonly directory: string;
  scan(signal?: AbortSignal): Promise<InboxScanResult>;
  markRead(id: string, read: boolean): Promise<void>;
  archive(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}
