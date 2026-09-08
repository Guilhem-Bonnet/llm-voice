import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DiskAudioCache } from "../../../src/playback/DiskAudioCache.js";

function bytes(sizeInBytes: number, fill = 7): Uint8Array {
  return new Uint8Array(sizeInBytes).fill(fill);
}

describe("DiskAudioCache (ADR-004)", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "llm-voice-cache-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("get() returns undefined for an unknown key", async () => {
    const cache = new DiskAudioCache({ root });
    expect(await cache.get("missing")).toBeUndefined();
  });

  it("put() then get() round-trips the exact bytes", async () => {
    const cache = new DiskAudioCache({ root });
    const payload = bytes(128, 42);
    const uri = await cache.put("abcdef", payload);
    expect(typeof uri).toBe("string");
    expect(uri.endsWith(".wav")).toBe(true);

    const read = await cache.get("abcdef");
    expect(read).toEqual(payload);
  });

  it("put() is idempotent: a second call with the same key does not rewrite the payload", async () => {
    const cache = new DiskAudioCache({ root });
    const first = await cache.put("idempotent", bytes(16, 1));
    const second = await cache.put("idempotent", bytes(16, 2));
    expect(second).toBe(first);

    // The payload written first is the one still on disk.
    const read = await cache.get("idempotent");
    expect(read).toEqual(bytes(16, 1));
  });

  it("size() sums every stored entry", async () => {
    const cache = new DiskAudioCache({ root });
    await cache.put("a", bytes(100));
    await cache.put("b", bytes(200));
    expect(await cache.size()).toBe(300);
  });

  it("shards entries into a two-character subdirectory of the key", async () => {
    const cache = new DiskAudioCache({ root });
    await cache.put("ab1234", bytes(4));
    const shardDirs = readdirSync(root);
    expect(shardDirs).toContain("ab");
  });

  it("evict() removes least-recently-used entries down to the target size", async () => {
    // A generous default budget keeps the automatic post-write eviction from
    // racing with this test's explicit `evict()` call below.
    const cache = new DiskAudioCache({ root });
    await cache.put("old", bytes(100));
    await cache.put("new", bytes(100));
    await cache.evict(100);

    expect(await cache.get("old")).toBeUndefined();
    expect(await cache.get("new")).toBeDefined();
  });

  it("evict() never touches entries once the budget is respected", async () => {
    const cache = new DiskAudioCache({ root });
    await cache.put("a", bytes(50));
    await cache.evict(1_000_000);
    expect(await cache.get("a")).toBeDefined();
  });

  it("get() refreshes lastAccessAt so a recently-read entry survives eviction over an untouched one", async () => {
    const cache = new DiskAudioCache({ root });
    await cache.put("stale", bytes(50));
    await cache.put("fresh", bytes(50));
    // Touch "stale" so it becomes the most recently accessed of the two.
    await cache.get("stale");
    await cache.evict(50);

    expect(await cache.get("stale")).toBeDefined();
    expect(await cache.get("fresh")).toBeUndefined();
  });

  it("clear() empties the whole cache (Clear Audio Cache, ADR-004)", async () => {
    const cache = new DiskAudioCache({ root });
    await cache.put("a", bytes(10));
    await cache.put("b", bytes(10));
    await cache.clear();

    expect(await cache.size()).toBe(0);
    expect(await cache.get("a")).toBeUndefined();
  });

  it("evicts automatically after a write that crosses maxSizeMb", async () => {
    // 1 byte budget: any write immediately triggers eviction back to ~90%.
    const cache = new DiskAudioCache({ root, maxSizeMb: 1 / (1024 * 1024) });
    await cache.put("first", bytes(10));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const size = await cache.size();
    expect(size).toBeLessThanOrEqual(10);
  });
});
