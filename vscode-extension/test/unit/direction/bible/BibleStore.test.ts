/**
 * ADR-015 §4 and test 9 (store side): persistence, 0600/0700, tolerant
 * reading, compaction, oblivion, in-memory documents, promotion, precedence.
 */
import { mkdir, readFile, readdir, stat, symlink, truncate, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  BibleStore,
  BibleStoreError,
  MAX_JOURNAL_BYTES,
  USER_SCOPE,
  documentKeyOf,
  documentScope,
  seriesScope,
  seriesSlug,
  shouldPersistDocument,
  type BibleRejection,
  type BibleWarning
} from "../../../../src/direction/bible/index.js";
import { T0, tempDirs } from "./helpers.js";

const newDir = tempDirs();
const RAW = "file:///home/guilhem/Livres/secret-novel.md";
const DOC_FILE = documentScope(RAW, { persist: true });
const modelEvents = {
  role: { type: "addRole", roleId: "anna", names: ["Anna"] },
  trait: { type: "addTrait", roleId: "anna", key: "accent", value: "rauque", sourceIds: ["s1"] }
} as const;

async function fixedStore(extra: Partial<ConstructorParameters<typeof BibleStore>[0]> = {}) {
  const directory = await newDir();
  const rejections: BibleRejection[] = [];
  const warnings: BibleWarning[] = [];
  const store = new BibleStore({
    directory,
    now: () => new Date(T0),
    onRejection: (r) => rejections.push(r),
    onWarning: (w) => warnings.push(w),
    ...extra
  });
  return { directory, store, rejections, warnings };
}

async function tree(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      out.push(full);
      if (entry.isDirectory()) {
        await walk(full);
      }
    }
  }
  await walk(dir);
  return out;
}

const posixOnly = process.platform === "win32" ? it.skip : it;

describe("persistence", () => {
  it("survives a restart: a new store replays the journal to the same bible", async () => {
    const { directory, store } = await fixedStore();
    await store.appendModelEvent(DOC_FILE, "analyst", modelEvents.role);
    await store.appendModelEvent(DOC_FILE, "analyst", modelEvents.trait);
    await store.appendModelEvent(DOC_FILE, "casting", { type: "assignVoice", roleId: "anna", providerId: "piper", voiceRef: "fr-a" });
    const before = await store.read(DOC_FILE);
    const reopened = new BibleStore({ directory });
    const after = await reopened.read(DOC_FILE);
    expect(after.bible).toEqual(before.bible);
    expect(after.bible.revision).toBe(3);
    expect(after.report).toMatchObject({ ephemeral: false, lastSeq: 3, skippedLines: 0, ignoredEvents: 0 });
  });

  it("names document files by hash and keeps the clé out of every name and content", async () => {
    const { directory, store } = await fixedStore();
    await store.appendModelEvent(DOC_FILE, "analyst", modelEvents.role);
    await store.appendModelEvent(seriesScope("Saga d'Anna"), "analyst", modelEvents.role); // refused: still leaves a log
    const files = await tree(directory);
    const journal = files.find((f) => f.endsWith(`${documentKeyOf(RAW)}.jsonl`));
    expect(journal).toBeDefined();
    expect(documentKeyOf(RAW)).toMatch(/^[a-f0-9]{64}$/);
    for (const file of files) {
      expect(file).not.toContain("secret-novel");
      if ((await stat(file)).isFile()) {
        expect(await readFile(file, "utf8")).not.toContain("secret-novel");
      }
    }
  });

  posixOnly("writes files 0600 and directories 0700", async () => {
    const { directory, store } = await fixedStore();
    await store.appendModelEvent(DOC_FILE, "analyst", modelEvents.role);
    await store.appendUserEvent(USER_SCOPE, { type: "userEdit", target: { kind: "trait", roleId: "narrator", key: "tempo", value: "1.1" } });
    await store.appendModelEvent(seriesScope("saga"), "analyst", modelEvents.role); // refused, logs a rejection
    for (const entry of await tree(directory)) {
      const mode = (await stat(entry)).mode & 0o777;
      expect(mode, entry).toBe((await stat(entry)).isDirectory() ? 0o700 : 0o600);
    }
    expect((await tree(directory)).some((f) => f.endsWith(".snapshot.json"))).toBe(true);
    expect((await tree(directory)).some((f) => f.endsWith("rejections.jsonl"))).toBe(true);
  });

  it("does not journal a no-op, a tombstoned or a refused event", async () => {
    const { directory, store } = await fixedStore();
    await store.appendModelEvent(DOC_FILE, "analyst", modelEvents.role);
    await store.appendModelEvent(DOC_FILE, "analyst", modelEvents.role);
    await store.appendModelEvent(DOC_FILE, "analyst", { type: "addTrait", roleId: "ghost", key: "k", value: "v" });
    const journal = path.join(directory, "bibles", "document", `${documentKeyOf(RAW)}.jsonl`);
    expect((await readFile(journal, "utf8")).trim().split("\n")).toHaveLength(1);
  });

  it("picks up a journal changed by another store (another window) before its next append", async () => {
    const { directory, store } = await fixedStore();
    const other = new BibleStore({ directory, now: () => new Date(T0) });
    await store.appendModelEvent(DOC_FILE, "analyst", modelEvents.role);
    await other.appendModelEvent(DOC_FILE, "analyst", modelEvents.trait);
    const result = await store.appendModelEvent(DOC_FILE, "analyst", { type: "addTrait", roleId: "anna", key: "age", value: "40" });
    expect(result).toMatchObject({ status: "applied", seq: 3 });
    expect((await store.read(DOC_FILE)).bible.characters[0]?.traits).toHaveProperty("accent");
  });

  it("serialises concurrent appends: every event lands once, seq unique", async () => {
    const { store } = await fixedStore();
    await store.appendModelEvent(DOC_FILE, "analyst", modelEvents.role);
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) => store.appendModelEvent(DOC_FILE, "analyst", { type: "addTrait", roleId: "anna", key: `k${i}`, value: "v" }))
    );
    const seqs = results.map((r) => (r.status === "applied" ? r.seq : -1));
    expect(new Set(seqs).size).toBe(40);
    expect(Math.max(...seqs)).toBe(41);
    expect(Object.keys((await store.read(DOC_FILE)).bible.characters[0]?.traits ?? {})).toHaveLength(40);
  });
});

describe("write rights at the store (ADR-015 §4)", () => {
  it("refuses, logs without content, and never writes a model event to a series or the preferences", async () => {
    const { directory, store, rejections } = await fixedStore();
    const SENTINEL = "SENTINEL-poison-42";
    for (const origin of ["analyst", "director", "casting"] as const) {
      for (const ref of [seriesScope("saga"), USER_SCOPE]) {
        const result = await store.appendModelEvent(ref, origin, { type: "addTrait", roleId: "narrator", key: "tone", value: SENTINEL });
        expect(result).toEqual({ status: "refused", reason: "model-outside-document-scope" });
      }
    }
    expect(rejections).toHaveLength(6);
    expect(rejections[0]).toMatchObject({ scope: "series", origin: "analyst", eventType: "addTrait", reason: "model-outside-document-scope" });
    const files = await tree(directory);
    expect(files.some((f) => f.endsWith(".jsonl") && !f.endsWith("rejections.jsonl"))).toBe(false);
    const log = await readFile(path.join(directory, "bibles", "rejections.jsonl"), "utf8");
    expect(log.trim().split("\n")).toHaveLength(6);
    expect(log).not.toContain(SENTINEL);
    expect((await store.read(seriesScope("saga"))).bible.revision).toBe(0);
    expect((await store.read(USER_SCOPE)).bible.revision).toBe(0);
  });

  it("refuses the user origin on the model door and a garbage event", async () => {
    const { store } = await fixedStore();
    expect(await store.appendModelEvent(DOC_FILE, "user" as never, modelEvents.role)).toEqual({ status: "refused", reason: "origin-not-model" });
    expect(await store.appendModelEvent(DOC_FILE, "analyst", { type: "dropTable" })).toEqual({ status: "refused", reason: "invalid-event" });
    expect(await store.appendModelEvent(DOC_FILE, "analyst", null)).toEqual({ status: "refused", reason: "invalid-event" });
    expect(await store.appendModelEvent(DOC_FILE, "analyst", { type: "userEdit", target: { kind: "names", roleId: "anna", names: ["A"] } })).toEqual({ status: "refused", reason: "user-only-event" });
  });

  it("tells a broken observer apart from a refusal", async () => {
    const { store } = await fixedStore({
      onRejection: () => {
        throw new Error("boom");
      }
    });
    await expect(store.appendModelEvent(USER_SCOPE, "analyst", modelEvents.trait)).resolves.toMatchObject({ status: "refused" });
  });
});

describe("promotion and precedence (ADR-015 §4)", () => {
  it("copies a document fact into a series on a user action, as a user fact", async () => {
    const { store } = await fixedStore();
    const saga = seriesScope("Saga d'Anna");
    await store.appendModelEvent(DOC_FILE, "analyst", modelEvents.role);
    await store.appendModelEvent(DOC_FILE, "analyst", modelEvents.trait);
    const result = await store.promote(DOC_FILE, saga, { kind: "trait", roleId: "anna", key: "accent" });
    expect(result.status).toBe("applied");
    const series = (await store.read(saga)).bible;
    expect(series.scope).toBe("series");
    expect(series.characters[0]?.traits.accent).toMatchObject({ value: "rauque", by: "user" });
    expect(series.characters[0]?.traits.accent?.sourceIds).toBeUndefined();
    expect(await store.promote(DOC_FILE, USER_SCOPE, { kind: "trait", roleId: "anna", key: "nope" })).toEqual({ status: "refused", reason: "not-found" });
    expect((await store.promote(DOC_FILE, USER_SCOPE, { kind: "names", roleId: "anna" })).status).toBe("applied");
  });

  it("promotes a descriptor and a voice assignment, and survives a restart", async () => {
    const { directory, store } = await fixedStore();
    const saga = seriesScope("saga");
    await store.appendModelEvent(DOC_FILE, "analyst", modelEvents.role);
    await store.appendModelEvent(DOC_FILE, "analyst", { type: "setDescriptor", roleId: "anna", value: "voix rauque" });
    await store.appendModelEvent(DOC_FILE, "casting", { type: "assignVoice", roleId: "anna", providerId: "piper", voiceRef: "fr-a" });
    await store.promote(DOC_FILE, saga, { kind: "descriptor", roleId: "anna" });
    await store.promote(DOC_FILE, saga, { kind: "assignment", roleId: "anna", providerId: "piper" });
    const reopened = new BibleStore({ directory });
    const role = (await reopened.read(saga)).bible.characters[0];
    expect(role?.voice.descriptor).toMatchObject({ value: "voix rauque", by: "user" });
    expect(role?.voice.assignments?.piper).toMatchObject({ voiceRef: "fr-a", by: "user" });
  });

  it("merges user ⊂ series ⊂ document: the most specific wins, but a model fact never overrides a user or locked one", async () => {
    const { store } = await fixedStore();
    const saga = seriesScope("saga");
    const user = (roleId: string, key: string, value: string, locked?: boolean) => ({ type: "userEdit", target: { kind: "trait", roleId, key, value, ...(locked ? { locked } : {}) } }) as const;
    await store.appendUserEvent(USER_SCOPE, user("narrator", "tone", "neutre"));
    await store.appendUserEvent(saga, user("narrator", "tone", "chaleureux"));
    await store.appendUserEvent(saga, user("anna", "accent", "rauque"));
    await store.appendUserEvent(saga, user("anna", "age", "40"));
    await store.appendModelEvent(DOC_FILE, "analyst", modelEvents.role);
    await store.appendModelEvent(DOC_FILE, "analyst", { type: "addTrait", roleId: "anna", key: "accent", value: "clair" }); // model vs series user fact
    await store.appendModelEvent(DOC_FILE, "analyst", { type: "addTrait", roleId: "anna", key: "gait", value: "lent" });
    await store.appendUserEvent(DOC_FILE, user("anna", "age", "41")); // user in the document beats the series
    const effective = await store.effective(DOC_FILE, saga);
    const anna = effective.characters.find((r) => r.id === "anna");
    expect(effective.narrator.traits.tone?.value).toBe("chaleureux");
    expect(anna?.traits.accent?.value).toBe("rauque");
    expect(anna?.traits.age?.value).toBe("41");
    expect(anna?.traits.gait?.value).toBe("lent");
    expect(anna?.names).toEqual(["Anna"]);
    expect(effective.revision).toBe((await store.read(USER_SCOPE)).bible.revision + (await store.read(saga)).bible.revision + (await store.read(DOC_FILE)).bible.revision);
  });

  it("works without a series", async () => {
    const { store } = await fixedStore();
    await store.appendModelEvent(DOC_FILE, "analyst", modelEvents.role);
    expect((await store.effective(DOC_FILE)).characters.map((r) => r.id)).toEqual(["anna"]);
  });
});

describe("documents that are not persisted (ADR-015 §4, tableau des portées)", () => {
  it("writes nothing at all for a persist:false document, and still serves reads, promotion and merge", async () => {
    const { directory, store } = await fixedStore();
    const memory = documentScope("clipboard:abc", { persist: false });
    await store.appendModelEvent(memory, "analyst", modelEvents.role);
    await store.appendModelEvent(memory, "analyst", modelEvents.trait);
    await store.appendModelEvent(memory, "analyst", { type: "addTrait", roleId: "ghost", key: "k", value: "v" }); // refused
    expect((await store.read(memory)).report.ephemeral).toBe(true);
    expect((await store.read(memory)).bible.characters[0]?.traits.accent?.value).toBe("rauque");
    expect(await tree(directory)).toEqual([]);
    expect((await store.effective(memory)).characters).toHaveLength(1);
    await store.promote(memory, USER_SCOPE, { kind: "trait", roleId: "anna", key: "accent" });
    expect(Object.keys(await tree(directory)).length).toBeGreaterThan(0); // the user bible is persisted, and only it
    expect((await tree(directory)).every((f) => !f.includes(memory.documentKey))).toBe(true);
  });

  it("is not read back from disk after a restart", async () => {
    const { directory, store } = await fixedStore();
    const memory = documentScope("selection:xyz", { persist: false });
    await store.appendModelEvent(memory, "analyst", modelEvents.role);
    const reopened = new BibleStore({ directory });
    expect((await reopened.read(memory)).bible.characters).toEqual([]);
  });

  it("keeps a document on request (Conserver), once", async () => {
    const { directory, store } = await fixedStore();
    const memory = documentScope("selection:keep", { persist: false });
    await store.appendModelEvent(memory, "analyst", modelEvents.role);
    await store.appendModelEvent(memory, "analyst", modelEvents.trait);
    await store.keepDocument(memory);
    const persisted = documentScope("selection:keep", { persist: true });
    const reopened = new BibleStore({ directory });
    expect((await reopened.read(persisted)).bible.characters[0]?.traits.accent?.value).toBe("rauque");
    await expect(store.keepDocument(memory)).rejects.toMatchObject({ code: "not-ephemeral" });
    await expect(store.keepDocument(documentScope("never-seen", { persist: false }))).rejects.toBeInstanceOf(BibleStoreError);
  });

  it("decides persistence by source kind and opt-in", () => {
    expect(shouldPersistDocument("file", { persistInboxBibles: false })).toBe(true);
    expect(shouldPersistDocument("inbox", { persistInboxBibles: false })).toBe(false);
    expect(shouldPersistDocument("inbox", { persistInboxBibles: true })).toBe(true);
    expect(shouldPersistDocument("inbox", { persistInboxBibles: false, keep: true })).toBe(true);
    expect(shouldPersistDocument("selection", { persistInboxBibles: true })).toBe(false);
    expect(shouldPersistDocument("clipboard", { persistInboxBibles: true })).toBe(false);
    expect(shouldPersistDocument("clipboard", { persistInboxBibles: false, keep: true })).toBe(true);
  });
});

describe("corrupt and hostile files", () => {
  async function journalWith(lines: string[], endWithNewline = true) {
    const ctx = await fixedStore();
    const file = path.join(ctx.directory, "bibles", "document", `${DOC_FILE.documentKey}.jsonl`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, lines.join("\n") + (endWithNewline ? "\n" : ""), "utf8");
    return { ...ctx, file };
  }
  const good = (seq: number, event: object) => JSON.stringify({ v: 1, kind: "event", seq, at: T0, origin: "analyst", event });

  it("skips garbage lines, keeps the rest, reports and warns", async () => {
    const { store, warnings } = await journalWith([
      good(1, modelEvents.role),
      "{not json",
      JSON.stringify({ v: 2, kind: "event", seq: 2, at: T0, origin: "analyst", event: modelEvents.trait }),
      JSON.stringify({ v: 1, kind: "event", seq: 3, at: "yesterday", origin: "analyst", event: modelEvents.trait }),
      JSON.stringify({ v: 1, kind: "event", seq: 4, at: T0, origin: "analyst", event: { type: "dropTable" } }),
      "x".repeat(70_000),
      "null",
      "[]",
      good(5, modelEvents.trait)
    ]);
    const view = await store.read(DOC_FILE);
    expect(view.report.skippedLines).toBe(7);
    expect(view.bible.characters[0]?.traits.accent?.value).toBe("rauque");
    expect(view.bible.revision).toBe(2);
    expect(warnings).toEqual([{ code: "corrupt-lines", scope: "document", scopeId: DOC_FILE.documentKey, count: 7 }]);
  });

  it("survives a torn last line (crash mid-write) and keeps appending on a fresh line", async () => {
    const { store, directory } = await journalWith([good(1, modelEvents.role), good(2, modelEvents.trait).slice(0, 40)], false);
    expect((await store.read(DOC_FILE)).report.skippedLines).toBe(1);
    await store.appendModelEvent(DOC_FILE, "analyst", { type: "addTrait", roleId: "anna", key: "age", value: "40" });
    const reopened = new BibleStore({ directory });
    const view = await reopened.read(DOC_FILE);
    expect(view.bible.characters[0]?.traits.age?.value).toBe("40");
    expect(view.report.skippedLines).toBe(1);
  });

  it("replays but ignores model events hand-planted in a series or preferences journal", async () => {
    const { directory, store } = await fixedStore();
    const seriesFile = path.join(directory, "bibles", "series", `${seriesSlug("saga")}.jsonl`);
    const userFile = path.join(directory, "bibles", "user.jsonl");
    await mkdir(path.dirname(seriesFile), { recursive: true });
    const planted = [good(1, modelEvents.role), good(2, modelEvents.trait)].join("\n") + "\n";
    await writeFile(seriesFile, planted);
    await writeFile(userFile, planted);
    for (const ref of [seriesScope("saga"), USER_SCOPE]) {
      const view = await store.read(ref);
      expect(view.bible.characters).toEqual([]);
      expect(view.bible.revision).toBe(0);
      expect(view.report.ignoredEvents).toBe(2);
    }
  });

  it("refuses a planted checkpoint whose scope or content is wrong", async () => {
    const { directory, store } = await fixedStore();
    const userFile = path.join(directory, "bibles", "user.jsonl");
    await mkdir(path.dirname(userFile), { recursive: true });
    const llmFact = { value: "v", by: "analyst", at: T0 };
    const bible = (scope: string, by: object) => ({
      schemaVersion: "1.0", scope, scopeKey: "user", revision: 9,
      narrator: { id: "narrator", names: [], traits: { k: by }, voice: {} }, characters: []
    });
    const line = (b: object) => JSON.stringify({ v: 1, kind: "checkpoint", seq: 9, at: T0, state: { bible: b, candidates: [], tombstones: [] } });
    await writeFile(userFile, [line(bible("user", llmFact)), line(bible("series", { ...llmFact, by: "user" }))].join("\n") + "\n");
    const view = await store.read(USER_SCOPE);
    expect(view.report.skippedLines).toBe(2);
    expect(view.bible.revision).toBe(0);
  });

  it("never overwrites or follows a directory or a symlink standing where a journal should be", async () => {
    const { directory, store, rejections } = await fixedStore();
    const file = path.join(directory, "bibles", "document", `${DOC_FILE.documentKey}.jsonl`);
    await mkdir(file, { recursive: true }); // a directory
    expect((await store.read(DOC_FILE)).report.unreadable).toBe("not-regular-file");
    expect(await store.appendModelEvent(DOC_FILE, "analyst", modelEvents.role)).toEqual({ status: "refused", reason: "scope-unreadable" });
    expect(rejections.at(-1)?.reason).toBe("scope-unreadable");

    const victim = path.join(directory, "victim.txt");
    await writeFile(victim, "precious");
    const other = documentScope("other", { persist: true });
    const link = path.join(directory, "bibles", "document", `${other.documentKey}.jsonl`);
    await symlink(victim, link);
    expect((await store.read(other)).report.unreadable).toBe("not-regular-file");
    await store.appendModelEvent(other, "analyst", modelEvents.role);
    expect(await readFile(victim, "utf8")).toBe("precious");
  });

  it("treats an oversized journal as unreadable rather than loading it", async () => {
    const { store, file } = await journalWith([]);
    await truncate(file, MAX_JOURNAL_BYTES + 1);
    expect((await store.read(DOC_FILE)).report.unreadable).toBe("too-large");
    await expect(store.compact(DOC_FILE)).rejects.toMatchObject({ code: "unreadable" });
  });
});

describe("compaction and oblivion", () => {
  it("compaction removes retracted values from the file and keeps the state, revision and future appends", async () => {
    const { directory, store } = await fixedStore();
    const SECRET = "valeur-a-oublier";
    await store.appendModelEvent(DOC_FILE, "analyst", modelEvents.role);
    await store.appendModelEvent(DOC_FILE, "analyst", { type: "addTrait", roleId: "anna", key: "secret", value: SECRET });
    await store.appendModelEvent(DOC_FILE, "director", { type: "addTrait", roleId: "anna", key: "secret", value: `${SECRET}-2` }); // candidate
    await store.appendUserEvent(DOC_FILE, { type: "userRetract", target: { kind: "trait", roleId: "anna", key: "secret" } });
    const file = path.join(directory, "bibles", "document", `${DOC_FILE.documentKey}.jsonl`);
    const snapshot = file.replace(/\.jsonl$/, ".snapshot.json");
    expect(await readFile(file, "utf8")).toContain(SECRET); // tombstone first: still in the journal
    const before = await store.read(DOC_FILE);
    await store.compact(DOC_FILE);
    expect(await readFile(file, "utf8")).not.toContain(SECRET);
    expect(await readFile(snapshot, "utf8")).not.toContain(SECRET);
    expect((await readFile(file, "utf8")).trim().split("\n")).toHaveLength(1);
    const after = await new BibleStore({ directory }).read(DOC_FILE);
    expect(after.bible).toEqual(before.bible);
    expect(after.candidates).toEqual(before.candidates);
    expect(after.report.lastSeq).toBe(before.report.lastSeq);
    // The tombstone survives compaction: the model still cannot bring the value back.
    expect(await store.appendModelEvent(DOC_FILE, "analyst", { type: "addTrait", roleId: "anna", key: "secret", value: SECRET })).toMatchObject({ status: "tombstoned" });
    expect(await store.appendModelEvent(DOC_FILE, "analyst", { type: "addTrait", roleId: "anna", key: "age", value: "40" })).toMatchObject({ status: "applied", seq: before.report.lastSeq + 1 });
  });

  it("refuses to compact a journal with unreadable lines unless told to drop them", async () => {
    const { directory, store } = await fixedStore();
    await store.appendModelEvent(DOC_FILE, "analyst", modelEvents.role);
    const file = path.join(directory, "bibles", "document", `${DOC_FILE.documentKey}.jsonl`);
    await writeFile(file, `${await readFile(file, "utf8")}{garbage\n`);
    await expect(store.compact(DOC_FILE)).rejects.toMatchObject({ code: "corrupt-lines" });
    await store.compact(DOC_FILE, { dropUnreadable: true });
    expect((await store.read(DOC_FILE)).report.skippedLines).toBe(0);
    expect((await store.read(DOC_FILE)).bible.characters).toHaveLength(1);
  });

  it("compacting a scope with no file, or an in-memory one, does nothing", async () => {
    const { directory, store } = await fixedStore();
    await store.compact(seriesScope("nothing"));
    await store.compact(documentScope("mem", { persist: false }));
    expect(await tree(directory)).toEqual([]);
  });

  it("forget deletes the journal and the projection of one scope only", async () => {
    const { directory, store } = await fixedStore();
    const other = documentScope("other", { persist: true });
    await store.appendModelEvent(DOC_FILE, "analyst", modelEvents.role);
    await store.appendModelEvent(other, "analyst", modelEvents.role);
    await store.forget(DOC_FILE);
    const files = await tree(directory);
    expect(files.some((f) => f.includes(DOC_FILE.documentKey))).toBe(false);
    expect(files.some((f) => f.includes(other.documentKey))).toBe(true);
    expect((await store.read(DOC_FILE)).bible.characters).toEqual([]);
    expect((await new BibleStore({ directory }).read(DOC_FILE)).bible.revision).toBe(0);
    await store.forget(seriesScope("never-existed")); // idempotent
  });

  it("forgetAll deletes every bible file, the rejection log and everything in memory", async () => {
    const { directory, store } = await fixedStore();
    await store.appendModelEvent(DOC_FILE, "analyst", modelEvents.role);
    await store.appendUserEvent(seriesScope("saga"), { type: "userEdit", target: { kind: "names", roleId: "anna", names: ["Anna"] } });
    await store.appendUserEvent(USER_SCOPE, { type: "userEdit", target: { kind: "trait", roleId: "narrator", key: "tempo", value: "1.1" } });
    await store.appendModelEvent(USER_SCOPE, "analyst", modelEvents.role);
    const memory = documentScope("mem", { persist: false });
    await store.appendModelEvent(memory, "analyst", modelEvents.role);
    await store.forgetAll();
    expect((await tree(directory)).filter((f) => (f.endsWith(".jsonl") || f.endsWith(".json")))).toEqual([]);
    for (const ref of [DOC_FILE, seriesScope("saga"), USER_SCOPE, memory]) {
      expect((await store.read(ref)).bible.revision).toBe(0);
    }
  });

  it("caps the rejection log", async () => {
    const { directory, store } = await fixedStore();
    const big = { type: "addTrait", roleId: "narrator", key: "k", value: "v" };
    for (let i = 0; i < 20; i++) {
      await store.appendModelEvent(USER_SCOPE, "analyst", big);
    }
    const log = path.join(directory, "bibles", "rejections.jsonl");
    expect((await readFile(log, "utf8")).trim().split("\n")).toHaveLength(20);
    await writeFile(log, `${"x".repeat(100)}\n`.repeat(3000));
    await store.appendModelEvent(USER_SCOPE, "analyst", big);
    expect((await readFile(log, "utf8")).trim().split("\n").length).toBeLessThanOrEqual(500);
  });
});

describe("scope identities", () => {
  it("gives every series name its own file name, safe on any filesystem", () => {
    const names = ["saga", "Saga", "source:claude-code", "../../etc/passwd", "saga ", "a".repeat(150), "é"];
    const slugs = names.map(seriesSlug);
    expect(new Set(slugs).size).toBe(names.length);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
      expect(slug).toBe(slug.toLowerCase());
    }
  });

  it("rejects an unusable series name", () => {
    expect(() => seriesScope("")).toThrow(RangeError);
    expect(() => seriesScope("  ")).toThrow(RangeError);
    expect(() => seriesScope("a\u0000b")).toThrow(RangeError);
    expect(() => seriesScope("x".repeat(201))).toThrow(RangeError);
    expect(seriesScope("source:claude-code").name).toBe("source:claude-code");
  });
});
