/**
 * Audio cache: key derivation and the in-memory store used by tests.
 *
 * The key is the one CdC §37 and ADR-004 specify —
 * `SHA256(provider + model + voice + parameters + spokenText)` — with two
 * hardening details: `parameters` is serialised with its keys sorted so the
 * key is stable across object literal order, and the five parts are joined by
 * a NUL separator so no concatenation of two different tuples can collide.
 *
 * The disk-backed store over `globalStorageUri/cache` (sidecar metadata, LRU
 * eviction by `lastAccessAt`, atomic tmp+rename) lands in S3.5; it implements
 * this same `AudioCacheStore` interface.
 */

import { createHash } from "node:crypto";
import type { AudioCacheKeyMaterial, AudioFormat } from "../core/tts.js";

/**
 * Sidecar metadata a caller may attach on `put` (ADR-004's full shape:
 * `{format, durationMs, providerId}`, on top of the always-recorded
 * `{createdAt, lastAccessAt, bytes}`). Additive and optional so every
 * existing `put(key, bytes)` call site keeps compiling unchanged.
 */
export interface AudioCachePutMeta {
  format?: AudioFormat;
  durationMs?: number;
  providerId?: string;
}

/**
 * Content-addressed audio store.
 *
 * `put` must be idempotent: calling it with a key that is already stored
 * refreshes the entry's access time and returns the existing URI without
 * rewriting the payload. That is what lets a cache hit — which returns bytes,
 * not a URI — be turned back into something the sink can load.
 */
export interface AudioCacheStore {
  get(key: string): Promise<Uint8Array | undefined>;
  /** Stores (or touches) `key` and returns the URI the sink should load. */
  put(key: string, bytes: Uint8Array, meta?: AudioCachePutMeta): Promise<string>;
  /**
   * S6.2: the sidecar metadata (`format`/`durationMs`/`providerId`) attached
   * on the `put` that first wrote `key`, so a cache *hit* (`AudioQueue.run()`)
   * can restore `AudioChunk.durationMs` — without this, every cache-hit chunk
   * used to reach the sink with `durationMs: undefined`, silently falling
   * back to whatever default the sink assumes instead of the audio's real
   * length. Optional, like `pin`/`unpin`: a store that predates this is
   * simply never able to restore it, not broken.
   */
  getMeta?(key: string): Promise<AudioCachePutMeta | undefined>;
  /** Total bytes currently held. */
  size(): Promise<number>;
  /** Evicts least-recently-used entries until the store fits `targetBytes`. */
  evict(targetBytes: number): Promise<void>;
  /**
   * Marks `key` as referenced by a session in progress (ADR-004's reported
   * gap): `evict` must never remove a pinned entry. Optional — a store that
   * does not implement pinning is simply never protected, not broken.
   */
  pin?(key: string): void;
  /** Releases a pin set by `pin`; a no-op if `key` was not pinned. */
  unpin?(key: string): void;
}

/** Deterministic JSON: object keys sorted, `undefined` members dropped. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, member]) => member !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries
    .map(([key, member]) => `${JSON.stringify(key)}:${stableStringify(member)}`)
    .join(",")}}`;
}

/**
 * Hex SHA-256 of the material of CdC §37. Same text, same voice, same
 * parameters, same provider ⇒ same key ⇒ no second synthesis.
 */
export function computeCacheKey(material: AudioCacheKeyMaterial): string {
  const parts = [
    material.providerId,
    material.model ?? "",
    material.voice ?? "",
    stableStringify(material.parameters ?? {}),
    material.spokenText
  ];
  return createHash("sha256").update(parts.join("\u0000"), "utf8").digest("hex");
}

interface CacheRecord {
  bytes: Uint8Array;
  /** Monotonic counter rather than `Date.now()`: no ties under fake timers. */
  lastAccessAt: number;
  meta?: AudioCachePutMeta;
}

/**
 * Volatile `AudioCacheStore`, used by the unit suite and as the default of
 * `PlaybackController` until the disk store exists.
 */
export class InMemoryAudioCache implements AudioCacheStore {
  private readonly records = new Map<string, CacheRecord>();
  private readonly pinned = new Set<string>();
  private tick = 0;

  async get(key: string): Promise<Uint8Array | undefined> {
    const record = this.records.get(key);
    if (record === undefined) {
      return undefined;
    }
    record.lastAccessAt = ++this.tick;
    return record.bytes;
  }

  async put(key: string, bytes: Uint8Array, meta?: AudioCachePutMeta): Promise<string> {
    const existing = this.records.get(key);
    if (existing !== undefined) {
      existing.lastAccessAt = ++this.tick;
      // S6.2: merge, mirroring `DiskAudioCache.touch()` — a `put(key, ...,
      // {providerId})` re-pin/touch call (`AudioQueue`'s cache-hit path)
      // must not blank out the `format`/`durationMs` an earlier fresh
      // synthesis already recorded for this key.
      if (meta !== undefined) {
        const format = meta.format ?? existing.meta?.format;
        const durationMs = meta.durationMs ?? existing.meta?.durationMs;
        const providerId = meta.providerId ?? existing.meta?.providerId;
        existing.meta = {
          ...(format !== undefined ? { format } : {}),
          ...(durationMs !== undefined ? { durationMs } : {}),
          ...(providerId !== undefined ? { providerId } : {})
        };
      }
      return uriFor(key);
    }
    this.records.set(key, { bytes, lastAccessAt: ++this.tick, ...(meta !== undefined ? { meta } : {}) });
    return uriFor(key);
  }

  async size(): Promise<number> {
    let total = 0;
    for (const record of this.records.values()) {
      total += record.bytes.byteLength;
    }
    return total;
  }

  /** Sidecar metadata attached on `put`, for tests that assert it round-trips. */
  metaFor(key: string): AudioCachePutMeta | undefined {
    return this.records.get(key)?.meta;
  }

  async getMeta(key: string): Promise<AudioCachePutMeta | undefined> {
    return this.records.get(key)?.meta;
  }

  pin(key: string): void {
    this.pinned.add(key);
  }

  unpin(key: string): void {
    this.pinned.delete(key);
  }

  isPinned(key: string): boolean {
    return this.pinned.has(key);
  }

  async evict(targetBytes: number): Promise<void> {
    let total = await this.size();
    if (total <= targetBytes) {
      return;
    }
    const oldestFirst = [...this.records.entries()].sort(
      ([, left], [, right]) => left.lastAccessAt - right.lastAccessAt
    );
    for (const [key, record] of oldestFirst) {
      if (total <= targetBytes) {
        break;
      }
      if (this.pinned.has(key)) {
        continue;
      }
      this.records.delete(key);
      total -= record.bytes.byteLength;
    }
  }

  /** Number of entries held; the cache is derived data, counting it is cheap. */
  get count(): number {
    return this.records.size;
  }

  /** Drops everything, like the `Clear Audio Cache` command (ADR-004). */
  clear(): void {
    this.records.clear();
    this.pinned.clear();
  }
}

function uriFor(key: string): string {
  return `memory://audio/${key}`;
}
