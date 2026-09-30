/** ADR-015 §8, "Cache de partition": key, bible stamp, storage (0600/0700, atomic, LRU), tolerance to corruption. */
import { chmod, lstat, mkdir, readdir, stat, symlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import type { Partition } from "../../../../src/core/direction.js";
import { neutralPartitionForSource } from "../../../../src/direction/controller/index.js";
import {
  PartitionCache,
  cacheBibleStamp,
  canonicalJson,
  windowCacheKey,
  type WindowKeyInput
} from "../../../../src/direction/director/index.js";
import { BibleStore, documentScope } from "../../../../src/direction/bible/index.js";
import { makeBlocks, newDirectory, sleep } from "./support.js";

const DOC = "b".repeat(64);
const blocks = makeBlocks(6);
const baseKey: WindowKeyInput = {
  documentKey: DOC,
  window: blocks.slice(2, 4),
  before: blocks.slice(0, 2),
  after: blocks.slice(4, 6),
  bibleStamp: "stamp-a",
  model: "qwen2.5:7b",
  promptVersion: "p1",
  profileId: "profile-a",
  faithful: false
};
const partitionOf = (window = blocks.slice(2, 4), documentKey = DOC): Partition => neutralPartitionForSource(window, { documentKey, bibleRevision: 0 });

describe("windowCacheKey", () => {
  it("is a SHA-256 that is stable for the same input", () => {
    expect(windowCacheKey(baseKey)).toMatch(/^[a-f0-9]{64}$/);
    expect(windowCacheKey({ ...baseKey })).toBe(windowCacheKey(baseKey));
  });

  it.each<[string, Partial<WindowKeyInput>]>([
    ["document", { documentKey: "c".repeat(64) }],
    ["window text", { window: makeBlocks(6, { 2: "Un autre texte." }).slice(2, 4) }],
    ["context before", { before: makeBlocks(6, { 1: "Autre contexte." }).slice(0, 2) }],
    ["context after", { after: makeBlocks(6, { 5: "Autre suite." }).slice(4, 6) }],
    ["bible stamp", { bibleStamp: "stamp-b" }],
    ["model", { model: "qwen2.5:3b" }],
    ["prompt version", { promptVersion: "p2" }],
    ["profile", { profileId: "profile-b" }],
    ["faithful mode", { faithful: true }]
  ])("changes with the %s", (_name, change) => {
    expect(windowCacheKey({ ...baseKey, ...change })).not.toBe(windowCacheKey(baseKey));
  });

  it("prefers the spoken text of a block to its raw text, as the director does", () => {
    const spoken = baseKey.window.map((block) => ({ ...block, spokenText: "Texte prononcé." }));
    expect(windowCacheKey({ ...baseKey, window: spoken })).not.toBe(windowCacheKey(baseKey));
  });

  it("canonicalJson ignores key order", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 1, c: undefined }] })).toBe(canonicalJson({ a: [{ c: undefined, d: 1 }], b: 1 }));
  });
});

describe("cacheBibleStamp", () => {
  async function bible() {
    const store = new BibleStore({ directory: await newDirectory() });
    const document = documentScope("file:///x.md", { persist: false });
    await store.appendModelEvent(document, "analyst", { type: "setAnalysis", field: "genre", value: "roman" });
    await store.appendModelEvent(document, "analyst", { type: "addRole", roleId: "anna", names: ["Anna"] });
    await store.appendModelEvent(document, "analyst", { type: "addTrait", roleId: "anna", key: "age", value: "vieille" });
    const stamp = async () => cacheBibleStamp(await store.effective(document));
    return { store, document, stamp };
  }

  it("ignores what the director adds while reading: its facts, its states, its new roles", async () => {
    const { store, document, stamp } = await bible();
    const before = await stamp();
    await store.appendModelEvent(document, "director", { type: "addTrait", roleId: "anna", key: "état", value: "essoufflée" });
    await store.appendModelEvent(document, "director", { type: "addState", roleId: "anna", label: "ivre", fromSourceId: "seg-3" });
    await store.appendModelEvent(document, "director", { type: "addRole", roleId: "marc", names: ["Marc"] });
    await store.appendModelEvent(document, "director", { type: "addTrait", roleId: "marc", key: "voix", value: "grave" });
    await store.appendModelEvent(document, "director", { type: "setDescriptor", roleId: "marc", value: "voix grave" });
    expect((await store.effective(document)).revision).toBeGreaterThan(3);
    expect(await stamp()).toBe(before);
  });

  it("changes when the analysis, an analyst fact or a user fact changes", async () => {
    const { store, document, stamp } = await bible();
    const seen = new Set([await stamp()]);
    await store.appendModelEvent(document, "analyst", { type: "addTrait", roleId: "anna", key: "timbre", value: "rauque" });
    seen.add(await stamp());
    await store.appendUserEvent(document, { type: "userEdit", target: { kind: "trait", roleId: "anna", key: "age", value: "très vieille" } });
    seen.add(await stamp());
    await store.appendUserEvent(document, { type: "userEdit", target: { kind: "analysis", field: "baseTone", value: "sombre" } });
    seen.add(await stamp());
    expect(seen.size).toBe(4);
  });
});

describe("PartitionCache", () => {
  const lookup = (window = blocks.slice(2, 4), documentKey = DOC) => ({ documentKey, window });

  it("stores a partition with private permissions and reads it back", async () => {
    const directory = await newDirectory();
    const cache = new PartitionCache({ directory });
    const partition = partitionOf();
    await cache.put("k1", partition, true);
    expect(await cache.get("k1", lookup(), true)).toEqual(partition);
    expect((await stat(path.join(directory, "partitions"))).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(directory, "partitions", "k1.json"))).mode & 0o777).toBe(0o600);
    expect((await readdir(path.join(directory, "partitions"))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(await cache.get("absent", lookup(), true)).toBeUndefined();
  });

  it.each<[string, (file: string) => Promise<void>]>([
    ["not JSON", (file) => writeFile(file, "{oops")],
    ["wrong entry version", (file) => writeFile(file, JSON.stringify({ v: 9, partition: partitionOf() }))],
    ["not a partition", (file) => writeFile(file, JSON.stringify({ v: 1, partition: { cues: "x" } }))],
    ["out-of-bound cue", (file) => writeFile(file, JSON.stringify({ v: 1, partition: { ...partitionOf(), cues: [{ ...partitionOf().cues[0], tempo: 9 }] } }))],
    ["too large", (file) => writeFile(file, " ".repeat(1024 * 1024 + 1))]
  ])("treats a stored file that is %s as a miss", async (_name, corrupt) => {
    const directory = await newDirectory();
    const cache = new PartitionCache({ directory });
    await cache.put("k1", partitionOf(), true);
    await corrupt(path.join(directory, "partitions", "k1.json"));
    expect(await cache.get("k1", lookup(), true)).toBeUndefined();
  });

  it("misses when the stored partition belongs to another document, does not cover the window, or names an unknown speaker", async () => {
    const directory = await newDirectory();
    const cache = new PartitionCache({ directory });
    await cache.put("k1", partitionOf(), true);
    expect(await cache.get("k1", lookup(blocks.slice(2, 4), "c".repeat(64)), true)).toBeUndefined();
    expect(await cache.get("k1", lookup(blocks.slice(2, 5)), true)).toBeUndefined();
    const narratorOnly = { schemaVersion: "1.0", scope: "document", scopeKey: DOC, revision: 0, narrator: { id: "narrator", names: [], traits: {}, voice: {} }, characters: [] } as never;
    const speaking = { ...partitionOf(), cues: partitionOf().cues.map((cue) => ({ ...cue, speakerId: "anna" })) };
    await cache.put("k2", speaking, true);
    expect(await cache.get("k2", { ...lookup(), bible: narratorOnly }, true)).toBeUndefined();
    expect(await cache.get("k2", lookup(), true)).toEqual(speaking);
  });

  it("never follows a symlink planted in the cache directory", async () => {
    const directory = await newDirectory();
    const cache = new PartitionCache({ directory });
    await mkdir(path.join(directory, "partitions"), { recursive: true });
    const target = path.join(directory, "elsewhere.json");
    await writeFile(target, JSON.stringify({ v: 1, partition: partitionOf() }));
    await symlink(target, path.join(directory, "partitions", "k1.json"));
    expect(await cache.get("k1", lookup(), true)).toBeUndefined();
  });

  it("evicts the least recently used entries once over its size", async () => {
    const directory = await newDirectory();
    await new PartitionCache({ directory }).put("a", partitionOf(), true);
    const entrySize = (await stat(path.join(directory, "partitions", "a.json"))).size;
    const tight = new PartitionCache({ directory, maxBytes: Math.floor(entrySize * 2.5) });
    await sleep(20);
    await tight.put("b", partitionOf(), true);
    await sleep(20);
    expect(await tight.get("a", lookup(), true)).toBeDefined();
    await sleep(20);
    await tight.put("c", partitionOf(), true);
    const left = (await readdir(path.join(directory, "partitions"))).sort();
    expect(left).toEqual(["a.json", "c.json"]);
  });

  it("stays silent when the directory cannot be written: the cache is derived data", async () => {
    const directory = await newDirectory();
    await mkdir(directory, { recursive: true });
    await chmod(directory, 0o500);
    try {
      const cache = new PartitionCache({ directory });
      await expect(cache.put("k1", partitionOf(), true)).resolves.toBeUndefined();
      expect(await cache.get("k1", lookup(), true)).toBeUndefined();
    } finally {
      await chmod(directory, 0o700);
    }
  });

  it("keeps a non-persisted document in memory only, and forgets everything on clear", async () => {
    const directory = await newDirectory();
    const cache = new PartitionCache({ directory });
    await cache.put("m", partitionOf(), false);
    expect(await cache.get("m", lookup(), false)).toEqual(partitionOf());
    await expect(lstat(path.join(directory, "partitions"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await cache.get("m", lookup(), true)).toBeUndefined();
    await cache.put("d", partitionOf(), true);
    await cache.clear();
    expect(await cache.get("m", lookup(), false)).toBeUndefined();
    expect(await cache.get("d", lookup(), true)).toBeUndefined();
  });

  it("works in memory only when it has no directory", async () => {
    const cache = new PartitionCache();
    await cache.put("k", partitionOf(), true);
    expect(await cache.get("k", lookup(), true)).toEqual(partitionOf());
  });
});
