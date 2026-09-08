import { describe, expect, it } from "vitest";
import { InMemoryAudioCache, computeCacheKey } from "../../../src/playback/index.js";

const base = {
  providerId: "chatterbox",
  model: "m1",
  voice: "v1",
  parameters: { speed: 1, pitch: 0.5 },
  spokenText: "Bonjour tout le monde."
};

describe("computeCacheKey", () => {
  it("returns a stable hex SHA-256", () => {
    const key = computeCacheKey(base);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(computeCacheKey(base)).toBe(key);
  });

  it("is insensitive to the declaration order of parameters (ADR-004)", () => {
    const reordered = { ...base, parameters: { pitch: 0.5, speed: 1 } };
    expect(computeCacheKey(reordered)).toBe(computeCacheKey(base));
  });

  it("sorts nested objects and preserves array order", () => {
    const left = { ...base, parameters: { a: { x: 1, y: [1, 2] } } };
    const right = { ...base, parameters: { a: { y: [1, 2], x: 1 } } };
    const swapped = { ...base, parameters: { a: { x: 1, y: [2, 1] } } };
    expect(computeCacheKey(left)).toBe(computeCacheKey(right));
    expect(computeCacheKey(swapped)).not.toBe(computeCacheKey(left));
  });

  it("drops undefined parameter members instead of hashing them", () => {
    const withUndefined = {
      ...base,
      parameters: { speed: 1, pitch: 0.5, extra: undefined }
    };
    expect(computeCacheKey(withUndefined)).toBe(computeCacheKey(base));
  });

  it("changes when any of provider, model, voice, parameters or text changes", () => {
    const key = computeCacheKey(base);
    expect(computeCacheKey({ ...base, providerId: "piper" })).not.toBe(key);
    expect(computeCacheKey({ ...base, model: "m2" })).not.toBe(key);
    expect(computeCacheKey({ ...base, voice: "v2" })).not.toBe(key);
    expect(computeCacheKey({ ...base, parameters: { speed: 2 } })).not.toBe(key);
    expect(computeCacheKey({ ...base, spokenText: "Autre chose." })).not.toBe(key);
  });

  it("treats absent model, voice and parameters as empty rather than throwing", () => {
    const minimal = { providerId: "p", spokenText: "x" };
    expect(computeCacheKey(minimal)).toMatch(/^[0-9a-f]{64}$/);
    expect(computeCacheKey(minimal)).toBe(
      computeCacheKey({ ...minimal, parameters: {} })
    );
  });

  it("cannot be collided by shifting a boundary between two fields", () => {
    const left = computeCacheKey({ providerId: "ab", model: "c", spokenText: "t" });
    const right = computeCacheKey({ providerId: "a", model: "bc", spokenText: "t" });
    expect(left).not.toBe(right);
  });
});

describe("InMemoryAudioCache", () => {
  it("stores bytes and returns a stable URI for the key", async () => {
    const cache = new InMemoryAudioCache();
    const uri = await cache.put("k1", new Uint8Array([1, 2, 3]));
    expect(uri).toBe("memory://audio/k1");
    expect(await cache.get("k1")).toEqual(new Uint8Array([1, 2, 3]));
    expect(await cache.size()).toBe(3);
  });

  it("returns undefined on a miss", async () => {
    const cache = new InMemoryAudioCache();
    expect(await cache.get("absent")).toBeUndefined();
  });

  it("is idempotent: a second put keeps the original payload and URI", async () => {
    const cache = new InMemoryAudioCache();
    await cache.put("k1", new Uint8Array([1, 2, 3]));
    const uri = await cache.put("k1", new Uint8Array([9]));
    expect(uri).toBe("memory://audio/k1");
    expect(await cache.get("k1")).toEqual(new Uint8Array([1, 2, 3]));
    expect(cache.count).toBe(1);
  });

  it("evicts least-recently-used entries down to the target budget", async () => {
    const cache = new InMemoryAudioCache();
    await cache.put("a", new Uint8Array(10));
    await cache.put("b", new Uint8Array(10));
    await cache.put("c", new Uint8Array(10));
    // Touch `a` so `b` becomes the least recently used entry.
    await cache.get("a");

    await cache.evict(20);

    expect(await cache.size()).toBe(20);
    expect(await cache.get("b")).toBeUndefined();
    expect(await cache.get("a")).toBeDefined();
    expect(await cache.get("c")).toBeDefined();
  });

  it("does nothing when already under the budget", async () => {
    const cache = new InMemoryAudioCache();
    await cache.put("a", new Uint8Array(4));
    await cache.evict(100);
    expect(cache.count).toBe(1);
  });

  it("clears everything, like the Clear Audio Cache command", async () => {
    const cache = new InMemoryAudioCache();
    await cache.put("a", new Uint8Array(4));
    cache.clear();
    expect(cache.count).toBe(0);
    expect(await cache.size()).toBe(0);
  });

  it("round-trips the put() meta (ADR-004 full sidecar shape, S4.2)", async () => {
    const cache = new InMemoryAudioCache();
    await cache.put("a", new Uint8Array(4), {
      format: "wav",
      durationMs: 1234,
      providerId: "chatterbox"
    });
    expect(cache.metaFor("a")).toEqual({ format: "wav", durationMs: 1234, providerId: "chatterbox" });
  });

  it("never evicts a pinned entry, however old (ADR-004's reported-to-phase-4 gap, S4.2)", async () => {
    const cache = new InMemoryAudioCache();
    await cache.put("a", new Uint8Array(10));
    await cache.put("b", new Uint8Array(10));
    cache.pin("a"); // oldest entry, would normally be evicted first

    await cache.evict(15);

    expect(await cache.get("a")).toBeDefined();
    expect(cache.isPinned("a")).toBe(true);
  });

  it("unpin() releases the guarantee, clear() releases every pin", async () => {
    const cache = new InMemoryAudioCache();
    await cache.put("a", new Uint8Array(10));
    cache.pin("a");
    cache.unpin("a");
    expect(cache.isPinned("a")).toBe(false);

    cache.pin("a");
    cache.clear();
    expect(cache.isPinned("a")).toBe(false);
  });
});

describe("computeCacheKey — edge material", () => {
  it("serialises an unserialisable member as null instead of throwing", () => {
    const key = computeCacheKey({
      providerId: "p",
      spokenText: "x",
      parameters: { list: [undefined, 1] }
    });
    expect(key).toBe(
      computeCacheKey({ providerId: "p", spokenText: "x", parameters: { list: [null, 1] } })
    );
  });
});
