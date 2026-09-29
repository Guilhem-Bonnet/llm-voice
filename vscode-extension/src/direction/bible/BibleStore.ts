/**
 * File-backed bible store (ADR-015 §4). No `vscode` import: the extension
 * layer only supplies the resolved `globalStorageUri/direction/` directory.
 *
 * ```
 * direction/
 *   bibles/document/<sha256(clé)>.jsonl   journal ; <…>.snapshot.json = projection
 *   bibles/series/<slug>.jsonl
 *   bibles/user.jsonl
 *   bibles/rejections.jsonl               refused model events (no content, capped)
 * ```
 *
 * - The journal is the source of truth and is append-only; the state is
 *   `replay(journal)`. Only an explicit `compact()` rewrites a journal (one
 *   `checkpoint` line), which is how a retracted value leaves the file.
 * - Write rights are enforced by the reducer (`authorize`): a model event
 *   outside the `document` scope is refused, logged in `rejections.jsonl` and
 *   never written to the target journal. The two public write doors are typed
 *   apart: `appendModelEvent` (origin analyst/director/casting, refused when
 *   the origin is `user`) and `appendUserEvent` / `promote` (always `user`).
 *   The store cannot authenticate its caller: keeping model code away from
 *   the user door is the caller's contract (only UI commands use it).
 * - Files are `0600`, directories `0700`, writes are O_APPEND of one line or
 *   tmp+rename; a symlink or non-regular file is never followed or replaced.
 * - A document with `persist: false` (selection, clipboard, inbox without
 *   opt-in) lives in memory only: nothing is read from or written to disk.
 */

import { constants as fsConstants } from "node:fs";
import * as fs from "node:fs/promises";
import { randomBytes } from "node:crypto";
import * as path from "node:path";

import type { Bible } from "../../core/direction.js";
import { isContainedIn } from "../../core/safePath.js";
import { isModelOrigin, parseBibleEvent, type BibleEvent, type EventOrigin, type ModelOrigin } from "./events.js";
import { MAX_JOURNAL_BYTES, parseJournal, serializeCheckpointLine, serializeEventLine } from "./journal.js";
import { effectiveBible } from "./merge.js";
import { applyEntry, initialState, type BibleState, type Candidate, type JournalEntry, type Refusal } from "./reducer.js";
import {
  scopeId,
  scopeKeyOf,
  type DocumentScope,
  type PersistentScopeRef,
  type ScopeRef,
  seriesSlug
} from "./scopes.js";

const REJECTION_LOG_MAX_BYTES = 256 * 1024;
const REJECTION_LOG_KEEP_LINES = 500;

export type RejectionReason = Refusal | "invalid-event" | "origin-not-model" | "scope-unreadable";

/** A refused write. Carries no text from the document: only identities and codes. */
export interface BibleRejection {
  readonly at: string;
  readonly scope: ScopeRef["scope"];
  readonly scopeId: string;
  readonly origin: EventOrigin;
  readonly eventType: string;
  readonly reason: RejectionReason;
}

export interface BibleWarning {
  readonly code: "corrupt-lines" | "unreadable" | "snapshot-failed" | "rejection-log-failed";
  readonly scope: ScopeRef["scope"];
  readonly scopeId: string;
  readonly count?: number;
  readonly detail?: string;
}

export type AppendResult =
  | { readonly status: "applied" | "candidate"; readonly seq: number; readonly revision: number }
  | { readonly status: "noop" | "tombstoned"; readonly revision: number }
  | { readonly status: "refused"; readonly reason: RejectionReason };

export type Unreadable = "too-large" | "not-regular-file" | "read-error";

export interface LoadReport {
  readonly ephemeral: boolean;
  readonly lastSeq: number;
  readonly skippedLines: number;
  readonly ignoredEvents: number;
  readonly unreadable?: Unreadable;
}

export interface BibleView {
  readonly bible: Bible;
  readonly candidates: readonly Candidate[];
  readonly report: LoadReport;
}

export type PromoteSelector =
  | { readonly kind: "trait"; readonly roleId: string; readonly key: string }
  | { readonly kind: "descriptor"; readonly roleId: string }
  | { readonly kind: "assignment"; readonly roleId: string; readonly providerId: string }
  | { readonly kind: "names"; readonly roleId: string };

export class BibleStoreError extends Error {
  constructor(
    readonly code: "corrupt-lines" | "unreadable" | "exists" | "not-ephemeral" | "unknown-document",
    message: string
  ) {
    super(message);
    this.name = "BibleStoreError";
  }
}

export interface BibleStoreOptions {
  /** Resolved `globalStorageUri/direction/` directory. */
  readonly directory: string;
  readonly now?: () => Date;
  readonly onRejection?: (rejection: BibleRejection) => void;
  readonly onWarning?: (warning: BibleWarning) => void;
}

interface Signature {
  readonly exists: boolean;
  readonly size: number;
  readonly mtimeMs: number;
}

interface Handle {
  state: BibleState;
  lastSeq: number;
  endsWithNewline: boolean;
  skippedLines: number;
  ignoredEvents: number;
  unreadable: Unreadable | undefined;
  ephemeral: boolean;
  signature: Signature;
}

const MISSING: Signature = { exists: false, size: 0, mtimeMs: 0 };
const O_NOFOLLOW = (fsConstants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function renameWithRetry(tmp: string, dest: string, attempts = 5, delayMs = 25): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await fs.rename(tmp, dest);
      return;
    } catch (error) {
      const retryable = isNodeError(error) && (error.code === "EPERM" || error.code === "EBUSY");
      if (!retryable || attempt >= attempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
}

async function bestEffortChmod(target: string, mode: number): Promise<void> {
  try {
    await fs.chmod(target, mode);
  } catch {
    // No-op on Windows, can fail on some filesystems: the creation mode already covers the common case.
  }
}

export class BibleStore {
  readonly directory: string;
  private readonly now: () => Date;
  private readonly onRejection: ((rejection: BibleRejection) => void) | undefined;
  private readonly onWarning: ((warning: BibleWarning) => void) | undefined;
  private readonly handles = new Map<string, Handle>();
  private chain: Promise<unknown> = Promise.resolve();

  constructor(options: BibleStoreOptions) {
    this.directory = options.directory;
    this.now = options.now ?? (() => new Date());
    this.onRejection = options.onRejection;
    this.onWarning = options.onWarning;
  }

  // -- paths ----------------------------------------------------------------

  private get biblesDir(): string {
    return path.join(this.directory, "bibles");
  }

  private get rejectionLogPath(): string {
    return path.join(this.biblesDir, "rejections.jsonl");
  }

  /** Journal path of a scope; always inside `directory/bibles`. */
  journalPath(ref: ScopeRef): string {
    const target =
      ref.scope === "document"
        ? path.join(this.biblesDir, "document", `${ref.documentKey}.jsonl`)
        : ref.scope === "series"
          ? path.join(this.biblesDir, "series", `${seriesSlug(ref.name)}.jsonl`)
          : path.join(this.biblesDir, "user.jsonl");
    if (!isContainedIn(this.biblesDir, target)) {
      throw new RangeError("journal path escapes the bibles directory");
    }
    return target;
  }

  snapshotPath(ref: ScopeRef): string {
    return this.journalPath(ref).replace(/\.jsonl$/, ".snapshot.json");
  }

  // -- serialisation --------------------------------------------------------

  /** One operation at a time: appends to the same journal must not interleave with a compaction. */
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.chain.then(operation, operation);
    this.chain = run.catch(() => undefined);
    return run;
  }

  // -- reading --------------------------------------------------------------

  async read(ref: ScopeRef): Promise<BibleView> {
    return this.serial(async () => this.view(await this.handleFor(ref)));
  }

  /** `user` ⊂ `series` ⊂ `document`; `series` is optional (a document may belong to none). */
  async effective(document: DocumentScope, series?: PersistentScopeRef): Promise<Bible> {
    return this.serial(async () => {
      const layers = {
        user: (await this.handleFor({ scope: "user" })).state.bible,
        ...(series !== undefined ? { series: (await this.handleFor(series)).state.bible } : {}),
        document: (await this.handleFor(document)).state.bible
      };
      return effectiveBible(layers);
    });
  }

  private view(handle: Handle): BibleView {
    return {
      bible: handle.state.bible,
      candidates: handle.state.candidates,
      report: {
        ephemeral: handle.ephemeral,
        lastSeq: handle.lastSeq,
        skippedLines: handle.skippedLines,
        ignoredEvents: handle.ignoredEvents,
        ...(handle.unreadable !== undefined ? { unreadable: handle.unreadable } : {})
      }
    };
  }

  private cacheKey(ref: ScopeRef): string {
    return `${ref.scope}:${scopeId(ref)}`;
  }

  private async handleFor(ref: ScopeRef): Promise<Handle> {
    const key = this.cacheKey(ref);
    const cached = this.handles.get(key);
    if (cached !== undefined && cached.ephemeral) {
      return cached;
    }
    if (cached === undefined && ref.scope === "document" && !ref.persist) {
      return this.remember(key, this.freshHandle(ref, true));
    }
    const signature = await this.signatureOf(this.journalPath(ref));
    if (cached !== undefined && cached.signature.exists === signature.exists && cached.signature.size === signature.size && cached.signature.mtimeMs === signature.mtimeMs) {
      return cached;
    }
    return this.remember(key, await this.loadFromDisk(ref));
  }

  private remember(key: string, handle: Handle): Handle {
    this.handles.set(key, handle);
    return handle;
  }

  private freshHandle(ref: ScopeRef, ephemeral: boolean): Handle {
    return {
      state: initialState(ref.scope, scopeKeyOf(ref)),
      lastSeq: 0,
      endsWithNewline: true,
      skippedLines: 0,
      ignoredEvents: 0,
      unreadable: undefined,
      ephemeral,
      signature: MISSING
    };
  }

  private async signatureOf(file: string): Promise<Signature> {
    try {
      const stat = await fs.lstat(file);
      return { exists: true, size: stat.size, mtimeMs: stat.mtimeMs };
    } catch (error) {
      if (isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
        return MISSING;
      }
      return { exists: true, size: -1, mtimeMs: -1 };
    }
  }

  private async loadFromDisk(ref: ScopeRef): Promise<Handle> {
    const file = this.journalPath(ref);
    const handle = this.freshHandle(ref, false);
    let stat;
    try {
      stat = await fs.lstat(file);
    } catch (error) {
      if (isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
        return handle;
      }
      return this.unreadableHandle(ref, handle, "read-error", MISSING);
    }
    const signature: Signature = { exists: true, size: stat.size, mtimeMs: stat.mtimeMs };
    if (!stat.isFile()) {
      return this.unreadableHandle(ref, handle, "not-regular-file", signature);
    }
    if (stat.size > MAX_JOURNAL_BYTES) {
      return this.unreadableHandle(ref, handle, "too-large", signature);
    }
    let text: string;
    try {
      text = await fs.readFile(file, "utf8");
    } catch {
      return this.unreadableHandle(ref, handle, "read-error", signature);
    }
    const parsed = parseJournal(text, ref.scope, scopeKeyOf(ref));
    if (parsed.skippedLines > 0) {
      this.warn({ code: "corrupt-lines", scope: ref.scope, scopeId: scopeId(ref), count: parsed.skippedLines });
    }
    return {
      ...handle,
      state: parsed.state,
      lastSeq: parsed.lastSeq,
      endsWithNewline: parsed.endsWithNewline,
      skippedLines: parsed.skippedLines,
      ignoredEvents: parsed.ignoredEvents,
      signature
    };
  }

  private unreadableHandle(ref: ScopeRef, handle: Handle, reason: Unreadable, signature: Signature): Handle {
    this.warn({ code: "unreadable", scope: ref.scope, scopeId: scopeId(ref), detail: reason });
    return { ...handle, unreadable: reason, signature };
  }

  // -- writing --------------------------------------------------------------

  /**
   * The door of the language-model roles. `origin` must be `analyst`,
   * `director` or `casting`; anything else is refused. `event` is untrusted
   * (it comes out of a model) and is validated, with over-long text cut to
   * the bound and any `locked` dropped.
   */
  appendModelEvent(ref: ScopeRef, origin: ModelOrigin, event: unknown): Promise<AppendResult> {
    return this.serial(() => this.append(ref, origin as EventOrigin, event, true));
  }

  /** The door of a user action (edit, retract, add by hand). Origin is always `user`. */
  appendUserEvent(ref: ScopeRef, event: BibleEvent): Promise<AppendResult> {
    return this.serial(() => this.append(ref, "user", event, false));
  }

  /**
   * "Promouvoir dans la série" / "dans mes préférences": copies one fact of a
   * document bible into a series or the user bible as a `userPromote` event
   * (a user action, so it is the only way a document fact reaches those scopes).
   */
  promote(from: DocumentScope, to: PersistentScopeRef, selector: PromoteSelector): Promise<AppendResult> {
    return this.serial(async () => {
      const source = (await this.handleFor(from)).state.bible;
      const role = selector.roleId === "narrator" ? source.narrator : source.characters.find((r) => r.id === selector.roleId);
      let item: Extract<BibleEvent, { type: "userPromote" }>["item"] | undefined;
      if (role !== undefined) {
        switch (selector.kind) {
          case "trait": {
            const fact = Object.prototype.hasOwnProperty.call(role.traits, selector.key) ? role.traits[selector.key] : undefined;
            item = fact === undefined ? undefined : { kind: "trait", roleId: role.id, key: selector.key, value: fact.value };
            break;
          }
          case "descriptor":
            item = role.voice.descriptor === undefined ? undefined : { kind: "descriptor", roleId: role.id, value: role.voice.descriptor.value };
            break;
          case "assignment": {
            const assignment = role.voice.assignments?.[selector.providerId];
            item = assignment === undefined ? undefined : { kind: "assignment", roleId: role.id, providerId: selector.providerId, voiceRef: assignment.voiceRef };
            break;
          }
          case "names":
            item = role.names.length === 0 ? undefined : { kind: "names", roleId: role.id, names: [...role.names] };
            break;
        }
      }
      if (item === undefined) {
        return this.reject(to, "user", "userPromote", "not-found");
      }
      return this.append(to, "user", { type: "userPromote", fromDocumentKey: from.documentKey, item }, false);
    });
  }

  private async append(ref: ScopeRef, origin: EventOrigin, raw: unknown, viaModelDoor: boolean): Promise<AppendResult> {
    const rawType = typeof raw === "object" && raw !== null && typeof (raw as { type?: unknown }).type === "string" ? String((raw as { type: string }).type).slice(0, 32) : "?";
    if (viaModelDoor && !isModelOrigin(origin)) {
      return this.reject(ref, origin, rawType, "origin-not-model");
    }
    const parsed = parseBibleEvent(raw, origin);
    if (!parsed.ok) {
      return this.reject(ref, origin, rawType, "invalid-event");
    }
    const handle = await this.handleFor(ref);
    if (handle.unreadable !== undefined) {
      return this.reject(ref, origin, parsed.event.type, "scope-unreadable");
    }
    const entry: JournalEntry = { seq: handle.lastSeq + 1, at: this.now().toISOString(), origin, event: parsed.event };
    const result = applyEntry(handle.state, entry);
    const outcome = result.outcome;
    if (outcome.kind === "refused") {
      return this.reject(ref, origin, parsed.event.type, outcome.reason);
    }
    if (outcome.kind === "noop" || outcome.kind === "tombstoned") {
      return { status: outcome.kind, revision: handle.state.bible.revision };
    }
    if (!handle.ephemeral) {
      await this.appendLine(ref, handle, serializeEventLine(entry));
    }
    handle.state = result.state;
    handle.lastSeq = entry.seq;
    if (!handle.ephemeral) {
      await this.writeSnapshot(ref, handle);
    }
    return { status: outcome.kind, seq: entry.seq, revision: handle.state.bible.revision };
  }

  private async appendLine(ref: ScopeRef, handle: Handle, line: string): Promise<void> {
    const file = this.journalPath(ref);
    await this.ensureDirectory(path.dirname(file));
    const descriptor = await fs.open(file, fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_CREAT | O_NOFOLLOW, 0o600);
    try {
      await descriptor.writeFile(`${handle.endsWithNewline ? "" : "\n"}${line}\n`, "utf8");
    } finally {
      await descriptor.close();
    }
    await bestEffortChmod(file, 0o600);
    handle.endsWithNewline = true;
    handle.signature = await this.signatureOf(file);
  }

  private async ensureDirectory(directory: string): Promise<void> {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    for (const dir of new Set([this.directory, this.biblesDir, directory])) {
      await bestEffortChmod(dir, 0o700);
    }
  }

  private async writeAtomic(file: string, content: string): Promise<void> {
    await this.ensureDirectory(path.dirname(file));
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`;
    try {
      await fs.writeFile(tmp, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await renameWithRetry(tmp, file);
    } catch (error) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw error;
    }
    await bestEffortChmod(file, 0o600);
  }

  /** Projection for the editor (ADR-015 §4). Derived, never read back, failure is a warning. */
  private async writeSnapshot(ref: ScopeRef, handle: Handle): Promise<void> {
    try {
      await this.writeAtomic(this.snapshotPath(ref), `${JSON.stringify(handle.state.bible, null, 2)}\n`);
    } catch {
      this.warn({ code: "snapshot-failed", scope: ref.scope, scopeId: scopeId(ref) });
    }
  }

  // -- promotion of an in-memory document ------------------------------------

  /** "Conserver": writes an in-memory document bible to disk as one checkpoint, from now on persisted. */
  keepDocument(document: DocumentScope): Promise<void> {
    return this.serial(async () => {
      const key = this.cacheKey(document);
      const handle = this.handles.get(key);
      if (handle === undefined) {
        throw new BibleStoreError("unknown-document", "no such document in memory");
      }
      if (!handle.ephemeral) {
        throw new BibleStoreError("not-ephemeral", "document is already persisted");
      }
      const file = this.journalPath(document);
      if ((await this.signatureOf(file)).exists) {
        throw new BibleStoreError("exists", "a journal already exists for this document");
      }
      await this.writeAtomic(file, `${serializeCheckpointLine(handle.state, handle.lastSeq, this.now().toISOString())}\n`);
      handle.ephemeral = false;
      handle.endsWithNewline = true;
      handle.signature = await this.signatureOf(file);
      await this.writeSnapshot(document, handle);
    });
  }

  // -- compaction and oblivion ------------------------------------------------

  /**
   * Explicit compaction: the journal becomes one `checkpoint` line holding the
   * current projection, so values the user retracted are no longer in the
   * file. Refuses when the file has unreadable lines (they would be lost, a
   * newer version's events among them) unless `dropUnreadable` is set.
   */
  compact(ref: ScopeRef, options: { readonly dropUnreadable?: boolean } = {}): Promise<void> {
    return this.serial(async () => {
      const handle = await this.handleFor(ref);
      if (handle.ephemeral) {
        return;
      }
      if (handle.unreadable !== undefined) {
        throw new BibleStoreError("unreadable", `journal is unreadable (${handle.unreadable})`);
      }
      if (handle.skippedLines > 0 && options.dropUnreadable !== true) {
        throw new BibleStoreError("corrupt-lines", `${handle.skippedLines} unreadable line(s) would be lost`);
      }
      if (!handle.signature.exists) {
        return;
      }
      const file = this.journalPath(ref);
      await this.writeAtomic(file, `${serializeCheckpointLine(handle.state, handle.lastSeq, this.now().toISOString())}\n`);
      handle.skippedLines = 0;
      handle.ignoredEvents = 0;
      handle.endsWithNewline = true;
      handle.signature = await this.signatureOf(file);
      await this.writeSnapshot(ref, handle);
    });
  }

  /** "Oublier la bible de ce document" (or a series, or the preferences): the files are deleted. */
  forget(ref: ScopeRef): Promise<void> {
    return this.serial(async () => {
      this.handles.delete(this.cacheKey(ref));
      if (ref.scope === "document" && !ref.persist && !(await this.signatureOf(this.journalPath(ref))).exists) {
        return;
      }
      await fs.rm(this.journalPath(ref), { force: true });
      await fs.rm(this.snapshotPath(ref), { force: true });
    });
  }

  /** "Oublier toutes les bibles": every bible file, the rejection log and everything held in memory. */
  forgetAll(): Promise<void> {
    return this.serial(async () => {
      this.handles.clear();
      await fs.rm(this.biblesDir, { recursive: true, force: true });
    });
  }

  // -- rejections ---------------------------------------------------------------

  private async reject(ref: ScopeRef, origin: EventOrigin, eventType: string, reason: RejectionReason): Promise<AppendResult> {
    const rejection: BibleRejection = { at: this.now().toISOString(), scope: ref.scope, scopeId: scopeId(ref), origin, eventType, reason };
    try {
      this.onRejection?.(rejection);
    } catch {
      // A broken observer must not turn a refusal into a crash.
    }
    const ephemeral = ref.scope === "document" && (this.handles.get(this.cacheKey(ref))?.ephemeral ?? !ref.persist);
    if (!ephemeral) {
      await this.logRejection(rejection);
    }
    return { status: "refused", reason };
  }

  private async logRejection(rejection: BibleRejection): Promise<void> {
    const file = this.rejectionLogPath;
    try {
      await this.ensureDirectory(this.biblesDir);
      const descriptor = await fs.open(file, fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_CREAT | O_NOFOLLOW, 0o600);
      try {
        await descriptor.writeFile(`${JSON.stringify(rejection)}\n`, "utf8");
      } finally {
        await descriptor.close();
      }
      await bestEffortChmod(file, 0o600);
      const stat = await fs.lstat(file);
      if (stat.isFile() && stat.size > REJECTION_LOG_MAX_BYTES) {
        const lines = (await fs.readFile(file, "utf8")).split("\n").filter((line) => line.length > 0);
        await this.writeAtomic(file, `${lines.slice(-REJECTION_LOG_KEEP_LINES).join("\n")}\n`);
      }
    } catch {
      this.warn({ code: "rejection-log-failed", scope: rejection.scope, scopeId: rejection.scopeId });
    }
  }

  private warn(warning: BibleWarning): void {
    try {
      this.onWarning?.(warning);
    } catch {
      // Same rule as onRejection.
    }
  }
}
