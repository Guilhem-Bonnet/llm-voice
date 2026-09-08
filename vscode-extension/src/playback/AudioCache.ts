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
import type { AudioCacheKeyMaterial } from "../core/tts.js";

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
  put(key: string, bytes: Uint8Array): Promise<string>;
  /** Total bytes currently held. */
  size(): Promise<number>;
  /** Evicts least-recently-used entries until the store fits `targetBytes`. */
  evict(targetBytes: number): Promise<void>;
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
}

/**
 * Volatile `AudioCacheStore`, used by the unit suite and as the default of
 * `PlaybackController` until the disk store exists.
 */
export class InMemoryAudioCache implements AudioCacheStore {
  private readonly records = new Map<string, CacheRecord>();
  private tick = 0;

  async get(key: string): Promise<Uint8Array | undefined> {
    const record = this.records.get(key);
    if (record === undefined) {
      return undefined;
    }
    record.lastAccessAt = ++this.tick;
    return record.bytes;
  }

  async put(key: string, bytes: Uint8Array): Promise<string> {
    const existing = this.records.get(key);
    if (existing !== undefined) {
      existing.lastAccessAt = ++this.tick;
      return uriFor(key);
    }
    this.records.set(key, { bytes, lastAccessAt: ++this.tick });
    return uriFor(key);
  }

  async size(): Promise<number> {
    let total = 0;
    for (const record of this.records.values()) {
      total += record.bytes.byteLength;
    }
    return total;
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
  }
}

function uriFor(key: string): string {
  return `memory://audio/${key}`;
}
