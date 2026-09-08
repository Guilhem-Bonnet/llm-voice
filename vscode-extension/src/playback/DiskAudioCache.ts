/**
 * Disk-backed `AudioCacheStore` over `globalStorageUri/cache` (ADR-004).
 *
 * Layout: `cache/<2 first hex chars of the key>/<key>.wav`, plus a sidecar
 * `<key>.json` with `{createdAt, lastAccessAt, bytes}`. Writes are atomic
 * (tmp file + rename), `put` is idempotent (an existing key is touched, not
 * rewritten), and eviction is LRU by `lastAccessAt` down to 90% of the
 * configured `maxSizeMb` budget, run best-effort after every write and once
 * at construction.
 *
 * Deliberately free of any `vscode` import: the extension layer passes in
 * `context.globalStorageUri.fsPath` as `root`, which is what keeps this class
 * unit-testable in plain Node (mirrors `AudioCache.ts`).
 *
 * Known gap vs. the full ADR-004 sidecar shape: `AudioCacheStore.put()` (a
 * contract already frozen in S3.2) only receives `key` and `bytes`, so
 * `format`/`durationMs`/`providerId` cannot be recorded here; every file is
 * written with a fixed `.wav` extension, which matches every TTS provider in
 * this slice (Fake and OpenAI-compatible both request `wav`). Likewise, this
 * store has no notion of "referenced by a session in progress" (no pinning
 * API exists on `AudioCacheStore`), so eviction never special-cases a chunk
 * that is currently playing. Both are noted for a follow-up story rather than
 * forking the interface here.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AudioCacheStore } from "./AudioCache.js";

export interface DiskAudioCacheOptions {
  /** Absolute path to the cache root, e.g. `<globalStorageUri>/cache`. */
  root: string;
  /** Eviction budget in megabytes; defaults to 512 (ADR-004). */
  maxSizeMb?: number;
}

interface SidecarMeta {
  createdAt: number;
  lastAccessAt: number;
  bytes: number;
}

interface DiskEntry {
  key: string;
  filePath: string;
  sidecarPath: string;
  bytes: number;
  lastAccessAt: number;
}

const DEFAULT_MAX_SIZE_MB = 512;

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isEnoent(error: unknown): boolean {
  return isNodeError(error) && error.code === "ENOENT";
}

async function tempSuffix(): Promise<string> {
  return `${process.pid}-${Date.now()}-${createHash("sha1").update(`${Math.random()}`).digest("hex").slice(0, 8)}`;
}

export class DiskAudioCache implements AudioCacheStore {
  private readonly root: string;
  private readonly maxBytes: number;
  private readonly ready: Promise<void>;
  /**
   * Tie-breaker appended to `Date.now()` for `lastAccessAt`/`createdAt`: two
   * writes inside the same millisecond (common under fast disks/tests) must
   * still sort deterministically for LRU eviction, so this process-local
   * counter — not wall-clock alone — is what actually orders entries.
   */
  private sequence = 0;

  constructor(options: DiskAudioCacheOptions) {
    this.root = options.root;
    this.maxBytes = Math.max(0, (options.maxSizeMb ?? DEFAULT_MAX_SIZE_MB) * 1024 * 1024);
    this.ready = fs.mkdir(this.root, { recursive: true }).then(() => undefined);
    // ADR-004: eviction also runs once at startup.
    void this.ready.then(() => this.evictIfOverBudget()).catch(() => {});
  }

  /** Strictly increasing across calls within this process, epoch-ms based. */
  private nextTimestamp(): number {
    this.sequence = (this.sequence + 1) % 1000;
    return Date.now() * 1000 + this.sequence;
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    await this.ready;
    try {
      const bytes = await fs.readFile(this.filePath(key));
      await this.touch(key, bytes.byteLength);
      return new Uint8Array(bytes);
    } catch (error) {
      if (isEnoent(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async put(key: string, bytes: Uint8Array): Promise<string> {
    await this.ready;
    const dest = this.filePath(key);
    const already = await this.exists(dest);
    if (already) {
      await this.touch(key, bytes.byteLength);
      return dest;
    }

    await fs.mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.tmp-${await tempSuffix()}`;
    await fs.writeFile(tmp, bytes);
    await fs.rename(tmp, dest);

    const now = this.nextTimestamp();
    await this.writeSidecar(key, { createdAt: now, lastAccessAt: now, bytes: bytes.byteLength });
    void this.evictIfOverBudget().catch(() => {});
    return dest;
  }

  async size(): Promise<number> {
    await this.ready;
    const entries = await this.listEntries();
    return entries.reduce((total, entry) => total + entry.bytes, 0);
  }

  async evict(targetBytes: number): Promise<void> {
    await this.ready;
    const entries = await this.listEntries();
    let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    if (total <= targetBytes) {
      return;
    }
    const oldestFirst = [...entries].sort((left, right) => left.lastAccessAt - right.lastAccessAt);
    for (const entry of oldestFirst) {
      if (total <= targetBytes) {
        break;
      }
      await Promise.allSettled([fs.rm(entry.filePath, { force: true }), fs.rm(entry.sidecarPath, { force: true })]);
      total -= entry.bytes;
    }
  }

  /** Empties the whole cache (`Clear Audio Cache`, ADR-004: purely derived data). */
  async clear(): Promise<void> {
    await this.ready;
    await fs.rm(this.root, { recursive: true, force: true });
    await fs.mkdir(this.root, { recursive: true });
  }

  private async evictIfOverBudget(): Promise<void> {
    const total = await this.size();
    if (total > this.maxBytes) {
      await this.evict(Math.floor(this.maxBytes * 0.9));
    }
  }

  private shard(key: string): string {
    return key.slice(0, 2) || "00";
  }

  private filePath(key: string): string {
    return path.join(this.root, this.shard(key), `${key}.wav`);
  }

  private sidecarPath(key: string): string {
    return path.join(this.root, this.shard(key), `${key}.json`);
  }

  private async exists(target: string): Promise<boolean> {
    try {
      await fs.access(target);
      return true;
    } catch {
      return false;
    }
  }

  private async writeSidecar(key: string, meta: SidecarMeta): Promise<void> {
    const dest = this.sidecarPath(key);
    const tmp = `${dest}.tmp-${await tempSuffix()}`;
    await fs.writeFile(tmp, JSON.stringify(meta));
    await fs.rename(tmp, dest);
  }

  private async readSidecar(key: string): Promise<SidecarMeta | undefined> {
    try {
      const raw = await fs.readFile(this.sidecarPath(key), "utf8");
      return JSON.parse(raw) as SidecarMeta;
    } catch {
      return undefined;
    }
  }

  private async touch(key: string, bytes: number): Promise<void> {
    const existing = await this.readSidecar(key);
    await this.writeSidecar(key, {
      createdAt: existing?.createdAt ?? this.nextTimestamp(),
      lastAccessAt: this.nextTimestamp(),
      bytes: existing?.bytes ?? bytes
    });
  }

  private async listEntries(): Promise<DiskEntry[]> {
    const entries: DiskEntry[] = [];
    let shards: string[];
    try {
      shards = await fs.readdir(this.root);
    } catch (error) {
      if (isEnoent(error)) {
        return entries;
      }
      throw error;
    }
    for (const shard of shards) {
      const shardDir = path.join(this.root, shard);
      let files: string[];
      try {
        files = await fs.readdir(shardDir);
      } catch {
        continue;
      }
      for (const file of files) {
        if (!file.endsWith(".wav")) {
          continue;
        }
        const key = file.slice(0, -".wav".length);
        const filePath = path.join(shardDir, file);
        const sidecarPath = path.join(shardDir, `${key}.json`);
        const meta = await this.readSidecar(key);
        if (meta !== undefined) {
          entries.push({ key, filePath, sidecarPath, bytes: meta.bytes, lastAccessAt: meta.lastAccessAt });
          continue;
        }
        try {
          const stat = await fs.stat(filePath);
          entries.push({ key, filePath, sidecarPath, bytes: stat.size, lastAccessAt: stat.mtimeMs });
        } catch {
          // Vanished between readdir and stat; ignore.
        }
      }
    }
    return entries;
  }
}
