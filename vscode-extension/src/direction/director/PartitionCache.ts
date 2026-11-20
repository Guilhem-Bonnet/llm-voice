/**
 * Partition cache (ADR-015 §8, "Cache de partition"): one file per window,
 * `direction/partitions/<sha256(key)>.json`, derived data, loss tolerated,
 * least-recently-used eviction by total size. Only directed partitions that
 * passed the controller are stored, never a neutral fallback: an outage must
 * not freeze a flat reading into the cache.
 *
 * - `windowCacheKey`: SHA-256 of the window's text and its context, the bible
 *   stamp, the model, the prompt version, the schema version, the profile and
 *   the document (see the deviations in the evidence pack).
 * - `cacheBibleStamp`: fingerprint of the effective bible **without what the
 *   director itself added while reading** (facts, states and descriptors
 *   authored by `director`, roles that hold nothing else). The director's own
 *   facts must not change the key: with the bible revision they would, and
 *   re-reading a document would never hit its own cache.
 * - A document that is not persisted (selection, clipboard, inbox without
 *   opt-in) uses the in-memory mode: nothing is written to disk.
 * - Files `0600`, directory `0700`, atomic tmp+rename, symlinks never
 *   followed. A file that fails the schema, the speaker check or the coverage
 *   check is a miss. No `vscode`, no network.
 */

import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  DIRECTION_SCHEMA_VERSION,
  PartitionSchema,
  checkPartition,
  type Bible,
  type Partition,
  type Role
} from "../../core/direction.js";
import type { SourceBlock } from "../controller/index.js";

export const DEFAULT_PARTITION_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const MAX_ENTRY_BYTES = 1024 * 1024;
const ENTRY_VERSION = 1;

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/** JSON with sorted object keys: same value, same text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function stableRole(role: Role): Record<string, unknown> | undefined {
  const traits = Object.entries(role.traits)
    .filter(([, fact]) => fact.by !== "director")
    .map(([key, fact]) => [key, { value: fact.value, by: fact.by, locked: fact.locked === true }]);
  const states = (role.states ?? [])
    .filter((state) => state.by !== "director")
    .map((state) => ({ label: state.label, from: state.fromSourceId, until: state.untilSourceId }));
  const descriptor = role.voice.descriptor;
  const keptDescriptor = descriptor !== undefined && descriptor.by !== "director" ? descriptor.value : undefined;
  const assignments = Object.entries(role.voice.assignments ?? {}).map(([providerId, a]) => [
    providerId,
    { voiceRef: a.voiceRef, by: a.by, locked: a.locked === true }
  ]);
  if (traits.length + states.length + assignments.length === 0 && keptDescriptor === undefined) {
    return undefined;
  }
  return { id: role.id, names: [...role.names].sort(), traits, states, descriptor: keptDescriptor, assignments };
}

/** Fingerprint of the effective bible minus the director's own additions (see the module comment). */
export function cacheBibleStamp(bible: Bible): string {
  const roles = [bible.narrator, ...bible.characters].map(stableRole).filter((role) => role !== undefined);
  return sha256(canonicalJson({ analysis: bible.analysis ?? null, roles }));
}

export interface WindowKeyInput {
  readonly documentKey: string;
  readonly window: readonly SourceBlock[];
  readonly before: readonly SourceBlock[];
  readonly after: readonly SourceBlock[];
  readonly bibleStamp: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly profileId: string;
  readonly faithful: boolean;
}

const blockText = (block: SourceBlock): string => block.spokenText ?? block.rawText;

export function windowCacheKey(input: WindowKeyInput): string {
  const blocks = (list: readonly SourceBlock[]) => list.map((block) => [block.id, blockText(block)]);
  return sha256(
    canonicalJson({
      schema: DIRECTION_SCHEMA_VERSION,
      documentKey: input.documentKey,
      window: blocks(input.window),
      before: blocks(input.before),
      after: blocks(input.after),
      bible: input.bibleStamp,
      model: input.model,
      prompt: input.promptVersion,
      profile: input.profileId,
      faithful: input.faithful
    })
  );
}

export interface PartitionCacheOptions {
  /** `direction/` directory; the cache lives in `<directory>/partitions`. Absent = memory only. */
  readonly directory?: string;
  readonly maxBytes?: number;
}

export interface CacheLookup {
  readonly documentKey: string;
  /** The window's readable segments: a hit must cover every one of them. */
  readonly window: readonly SourceBlock[];
  /** Effective bible, to check the speakers of the stored cues. */
  readonly bible?: Bible;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export class PartitionCache {
  private readonly directory: string | undefined;
  private readonly maxBytes: number;
  private readonly memory = new Map<string, Partition>();

  constructor(options: PartitionCacheOptions = {}) {
    this.directory = options.directory === undefined ? undefined : path.join(options.directory, "partitions");
    this.maxBytes = options.maxBytes ?? DEFAULT_PARTITION_CACHE_MAX_BYTES;
  }

  private fileOf(key: string): string {
    return path.join(this.directory as string, `${key}.json`);
  }

  private usable(partition: Partition, lookup: CacheLookup): boolean {
    if (partition.documentKey !== lookup.documentKey) {
      return false;
    }
    if (checkPartition(partition, lookup.bible).length > 0) {
      return false;
    }
    const covered = new Set(partition.cues.flatMap((cue) => cue.sourceIds));
    return lookup.window.every((block) => blockText(block).trim().length === 0 || covered.has(block.id));
  }

  /** The stored partition, or `undefined` (absent, unreadable, corrupt, stale or not covering the window). */
  async get(key: string, lookup: CacheLookup, persist: boolean): Promise<Partition | undefined> {
    if (this.directory === undefined || !persist) {
      const hit = this.memory.get(key);
      return hit !== undefined && this.usable(hit, lookup) ? hit : undefined;
    }
    const file = this.fileOf(key);
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.size > MAX_ENTRY_BYTES) {
        return undefined;
      }
      const entry = JSON.parse(await fs.readFile(file, "utf8")) as { v?: unknown; partition?: unknown };
      const parsed = entry.v === ENTRY_VERSION ? PartitionSchema.safeParse(entry.partition) : undefined;
      if (parsed === undefined || !parsed.success) {
        return undefined;
      }
      const partition = parsed.data as Partition;
      if (!this.usable(partition, lookup)) {
        return undefined;
      }
      const now = new Date();
      await fs.utimes(file, now, now).catch(() => undefined);
      return partition;
    } catch {
      return undefined;
    }
  }

  /** Stores a directed partition. Failure to write is not an error: the cache is derived data. */
  async put(key: string, partition: Partition, persist: boolean): Promise<void> {
    if (this.directory === undefined || !persist) {
      this.memory.set(key, partition);
      return;
    }
    try {
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      const file = this.fileOf(key);
      const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
      await fs.writeFile(tmp, JSON.stringify({ v: ENTRY_VERSION, partition }), { mode: 0o600, flag: "wx" });
      try {
        await fs.rename(tmp, file);
      } catch (error) {
        await fs.rm(tmp, { force: true });
        throw error;
      }
      await this.evict();
    } catch {
      // Derived data: the next reading recomputes.
    }
  }

  /** Least recently used first, until the total size fits `maxBytes`. */
  private async evict(): Promise<void> {
    const directory = this.directory as string;
    let names: string[];
    try {
      names = await fs.readdir(directory);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
    const files: Array<{ file: string; size: number; mtimeMs: number }> = [];
    for (const name of names) {
      if (!name.endsWith(".json")) {
        continue;
      }
      const file = path.join(directory, name);
      try {
        const stat = await fs.lstat(file);
        if (stat.isFile()) {
          files.push({ file, size: stat.size, mtimeMs: stat.mtimeMs });
        }
      } catch {
        // vanished meanwhile
      }
    }
    let total = files.reduce((sum, item) => sum + item.size, 0);
    files.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const item of files) {
      if (total <= this.maxBytes) {
        break;
      }
      await fs.rm(item.file, { force: true });
      total -= item.size;
    }
  }

  /** "Oublier": removes every cached partition. */
  async clear(): Promise<void> {
    this.memory.clear();
    if (this.directory !== undefined) {
      await fs.rm(this.directory, { recursive: true, force: true });
    }
  }
}
