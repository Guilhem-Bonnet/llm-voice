/**
 * File-backed inbox (ADR-003, ADR-004): the directory *is* the source of
 * truth, no index. Deliberately free of any `vscode` import so it can be
 * unit tested in plain Node — the extension layer only supplies a resolved
 * directory path and a `ReadStateStore` backed by `globalState`.
 *
 * Every `*.json` file is Zod-validated (`InboxMessageSchema`); an invalid
 * file is reported as a rejection and skipped, never thrown (D8: the
 * directory is written to by external, untrusted processes).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  InboxChange,
  InboxEntry,
  InboxMessage,
  InboxRejection,
  InboxRejectionReason,
  InboxScanResult,
  InboxStore
} from "../core/inbox.js";
import { InboxMessageSchema } from "../core/inbox.schema.js";
import { InMemoryReadStateStore, type ReadStateStore } from "./ReadStateStore.js";

const ARCHIVE_DIRNAME = "archive";
const TMP_PREFIX = ".tmp-";

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isEnoent(error: unknown): boolean {
  return isNodeError(error) && error.code === "ENOENT";
}

function idFor(fileName: string): string {
  return fileName.slice(0, -".json".length);
}

function isCandidateFile(fileName: string): boolean {
  return fileName.endsWith(".json") && !fileName.startsWith(TMP_PREFIX);
}

function classifyRejection(parsed: unknown): InboxRejectionReason {
  if (parsed === null || typeof parsed !== "object") {
    return "missing-required-field";
  }
  const record = parsed as Record<string, unknown>;
  if ("schemaVersion" in record && record.schemaVersion !== 1) {
    return "unknown-schema-version";
  }
  return "missing-required-field";
}

export interface InboxRepositoryOptions {
  /** Resolved inbox directory (`resolveInboxPath`). */
  directory: string;
  readState?: ReadStateStore;
  /** Called for every file rejected during a scan; never throws. */
  onWarning?: (rejection: InboxRejection) => void;
}

/** File-backed `InboxStore` (ADR-003/ADR-004): `list()` is the main entry point. */
export class InboxRepository implements InboxStore {
  readonly directory: string;
  private readonly readState: ReadStateStore;
  private readonly onWarning: ((rejection: InboxRejection) => void) | undefined;

  constructor(options: InboxRepositoryOptions) {
    this.directory = options.directory;
    this.readState = options.readState ?? new InMemoryReadStateStore();
    this.onWarning = options.onWarning;
  }

  private get archiveDir(): string {
    return path.join(this.directory, ARCHIVE_DIRNAME);
  }

  /** Creates the inbox directory (mode 0700) if it does not exist yet. */
  async ensureDirectory(): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      await fs.chmod(this.directory, 0o700);
    } catch {
      // Best-effort: chmod is a no-op on Windows and can fail on some
      // filesystems; the mkdir mode above already covers the common case.
    }
  }

  /** Convenience wrapper over `scan()`: entries only, sorted by `capturedAt` desc. */
  async list(signal?: AbortSignal): Promise<readonly InboxEntry[]> {
    return (await this.scan(signal)).entries;
  }

  async scan(signal?: AbortSignal): Promise<InboxScanResult> {
    await this.ensureDirectory();
    const scannedAt = Date.now();

    let dirents: string[];
    try {
      dirents = await fs.readdir(this.directory);
    } catch (error) {
      if (isEnoent(error)) {
        return { entries: [], rejections: [], scannedAt };
      }
      throw error;
    }

    const entries: InboxEntry[] = [];
    const rejections: InboxRejection[] = [];

    for (const fileName of dirents) {
      if (signal?.aborted === true) {
        throw new DOMException("Aborted", "AbortError");
      }
      if (!isCandidateFile(fileName)) {
        continue;
      }
      const fullPath = path.join(this.directory, fileName);

      let stat;
      try {
        stat = await fs.stat(fullPath);
      } catch {
        continue; // removed between readdir() and stat(): not an error, just gone
      }
      if (!stat.isFile()) {
        continue;
      }

      let raw: string;
      try {
        raw = await fs.readFile(fullPath, "utf8");
      } catch {
        continue; // same race as above
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw);
      } catch {
        rejections.push(this.reject(fileName, "invalid-json"));
        continue;
      }

      const result = InboxMessageSchema.safeParse(parsedJson);
      if (!result.success) {
        rejections.push(this.reject(fileName, classifyRejection(parsedJson)));
        continue;
      }
      if (result.data.message.trim().length === 0) {
        rejections.push(this.reject(fileName, "empty-message"));
        continue;
      }

      const id = idFor(fileName);
      entries.push({
        id,
        fileName,
        message: result.data as InboxMessage,
        read: this.readState.isRead(id),
        archived: false,
        bytes: stat.size,
        modifiedAt: stat.mtimeMs
      });
    }

    entries.sort((a, b) => b.message.capturedAt - a.message.capturedAt);
    await this.readState.cleanup(entries.map((entry) => entry.id));

    return { entries, rejections, scannedAt };
  }

  async markRead(id: string, read: boolean): Promise<void> {
    await this.readState.setRead(id, read);
  }

  async archive(id: string): Promise<void> {
    const fileName = await this.resolveFileName(id);
    await fs.mkdir(this.archiveDir, { recursive: true, mode: 0o700 });
    await fs.rename(path.join(this.directory, fileName), path.join(this.archiveDir, fileName));
  }

  async remove(id: string): Promise<void> {
    const fileName = await this.resolveFileName(id);
    await fs.rm(path.join(this.directory, fileName), { force: true });
  }

  private reject(fileName: string, reason: InboxRejectionReason): InboxRejection {
    const rejection: InboxRejection = { fileName, reason };
    this.onWarning?.(rejection);
    return rejection;
  }

  private async resolveFileName(id: string): Promise<string> {
    const direct = `${id}.json`;
    try {
      await fs.access(path.join(this.directory, direct));
      return direct;
    } catch {
      const dirents = await fs.readdir(this.directory).catch(() => [] as string[]);
      const found = dirents.find((fileName) => isCandidateFile(fileName) && idFor(fileName) === id);
      if (found === undefined) {
        throw new Error(`InboxRepository: no message with id "${id}"`);
      }
      return found;
    }
  }
}

/** Re-exported so callers only need one import for the watcher's event shape. */
export type { InboxChange };
