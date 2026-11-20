/**
 * ADR-015 test 9, property side. No fast-check in the tree: seeded PRNG
 * (mulberry32), the seed is in the test name so a failure replays.
 *
 * - no sequence of model events changes a series or the preferences;
 * - add-only: nothing disappears except through `userRetract`;
 * - a `user` or `locked` fact is never replaced by a model fact;
 * - replaying the journal always gives the same state, live, from the file
 *   text, and through a compaction; the projection stays a valid bible.
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import type { Bible } from "../../../../src/core/direction.js";
import {
  BibleStore,
  MODEL_ORIGINS,
  USER_SCOPE,
  applyEntry,
  documentKeyOf,
  documentScope,
  initialState,
  parseBibleEvent,
  parseJournal,
  replay,
  seriesScope,
  seriesSlug,
  serializeEventLine,
  type BibleEvent,
  type BibleState,
  type EventOrigin,
  type JournalEntry
} from "../../../../src/direction/bible/index.js";
import { DOC, T0, expectValidBible, pick, prng, tempDirs } from "./helpers.js";

const SEEDS = [1, 7, 42, 2026, 90210];
const ROLES = ["narrator", "anna", "bob", "carl"] as const;
const KEYS = ["age", "accent", "timbre", "gait"] as const;
const VALUES = ["a", "b", "rauque", "clair", "é".repeat(300)] as const;
const PROVIDERS = ["piper", "chatterbox"] as const;
const VOICES = ["v1", "v2", "v3"] as const;
const LABELS = ["ivre", "épuisé"] as const;
const SOURCES = ["s1", "s2", "s3"] as const;
const FIELDS = ["genre", "intent", "audience", "baseTone", "narratorPersona", "readingProfileId"] as const;

function modelEvent(random: () => number): BibleEvent {
  const roleId = pick(random, ROLES);
  switch (Math.floor(random() * 8)) {
    case 0: return { type: "addRole", roleId, names: [pick(random, ["Anna", "Bob", "Carl", "Mme Roux"])] };
    case 1: return { type: "addTrait", roleId, key: pick(random, KEYS), value: pick(random, VALUES), ...(random() < 0.3 ? { locked: true } : {}) };
    case 2: return { type: "addState", roleId, label: pick(random, LABELS), fromSourceId: pick(random, SOURCES) };
    case 3: return { type: "closeState", roleId, label: pick(random, LABELS), fromSourceId: pick(random, SOURCES), untilSourceId: pick(random, SOURCES) };
    case 4: return { type: "setDescriptor", roleId, value: pick(random, VALUES) };
    case 5: return { type: "assignVoice", roleId, providerId: pick(random, PROVIDERS), voiceRef: pick(random, VOICES) };
    case 6: return { type: "setAnalysis", field: pick(random, FIELDS), value: pick(random, VALUES) };
    default: return { type: "addRole", roleId, names: [] };
  }
}

function userEvent(random: () => number): BibleEvent {
  const roleId = pick(random, ROLES);
  switch (Math.floor(random() * 7)) {
    case 0: return { type: "userEdit", target: { kind: "trait", roleId, key: pick(random, KEYS), value: pick(random, VALUES), ...(random() < 0.4 ? { locked: true } : {}) } };
    case 1: return { type: "userEdit", target: { kind: "descriptor", roleId, value: pick(random, VALUES) } };
    case 2: return { type: "userEdit", target: { kind: "names", roleId, names: [pick(random, ["Anna", "Bob"])] } };
    case 3: return { type: "userEdit", target: { kind: "assignment", roleId, providerId: pick(random, PROVIDERS), voiceRef: pick(random, VOICES), ...(random() < 0.4 ? { locked: true } : {}) } };
    case 4: return { type: "userEdit", target: { kind: "analysis", field: pick(random, FIELDS), value: pick(random, VALUES) } };
    case 5: return { type: "userPromote", fromDocumentKey: DOC, item: { kind: "trait", roleId, key: pick(random, KEYS), value: pick(random, VALUES) } };
    default: return modelEvent(random);
  }
}

function retractEvent(random: () => number): BibleEvent {
  const roleId = pick(random, ROLES);
  const target = pick(random, [
    { kind: "trait", roleId, key: pick(random, KEYS) },
    { kind: "descriptor", roleId },
    { kind: "name", roleId, name: pick(random, ["Anna", "Bob"]) },
    { kind: "assignment", roleId, providerId: pick(random, PROVIDERS) },
    { kind: "state", roleId, label: pick(random, LABELS), fromSourceId: pick(random, SOURCES) },
    { kind: "role", roleId },
    { kind: "analysis", field: pick(random, FIELDS) }
  ] as const);
  return { type: "userRetract", target };
}

/** Everything a bible holds, as comparable paths. */
function paths(bible: Bible): Set<string> {
  const out = new Set<string>();
  for (const role of [bible.narrator, ...bible.characters]) {
    out.add(`role:${role.id}`);
    role.names.forEach((name) => out.add(`name:${role.id}:${name}`));
    Object.keys(role.traits).forEach((key) => out.add(`trait:${role.id}:${key}`));
    if (role.voice.descriptor !== undefined) out.add(`descriptor:${role.id}`);
    Object.keys(role.voice.assignments ?? {}).forEach((p) => out.add(`assign:${role.id}:${p}`));
    (role.states ?? []).forEach((s) => out.add(`state:${role.id}:${s.label}:${s.fromSourceId}`));
  }
  Object.keys(bible.analysis ?? {}).forEach((field) => out.add(`analysis:${field}`));
  return out;
}

/** Facts the model must never displace: by user or locked, with their exact content. */
function protectedFacts(bible: Bible): Map<string, string> {
  const out = new Map<string, string>();
  for (const role of [bible.narrator, ...bible.characters]) {
    for (const [key, fact] of Object.entries(role.traits)) {
      if (fact.by === "user" || fact.locked === true) out.set(`trait:${role.id}:${key}`, JSON.stringify(fact));
    }
    const d = role.voice.descriptor;
    if (d !== undefined && (d.by === "user" || d.locked === true)) out.set(`descriptor:${role.id}`, JSON.stringify(d));
    for (const [p, a] of Object.entries(role.voice.assignments ?? {})) {
      if (a.by === "user" || a.locked === true) out.set(`assign:${role.id}:${p}`, JSON.stringify(a));
    }
  }
  return out;
}

/** What the store does before it applies anything: validate (a model's over-long text is cut, a user's refused). */
function feed(state: BibleState, seq: number, origin: EventOrigin, event: BibleEvent): BibleState {
  const parsed = parseBibleEvent(event, origin);
  return parsed.ok ? applyEntry(state, { seq, at: T0, origin, event: parsed.event }).state : state;
}

function run(seed: number, steps: number, next: (random: () => number) => { origin: EventOrigin; event: BibleEvent }) {
  const random = prng(seed);
  const entries: JournalEntry[] = [];
  const states: BibleState[] = [initialState("document", DOC)];
  let state = states[0] as BibleState;
  for (let seq = 1; seq <= steps; seq++) {
    const { origin, event } = next(random);
    const parsed = parseBibleEvent(event, origin);
    if (parsed.ok) {
      const entry: JournalEntry = { seq, at: T0, origin, event: parsed.event };
      const result = applyEntry(state, entry);
      if (result.outcome.kind === "applied" || result.outcome.kind === "candidate") entries.push(entry);
      state = result.state;
    }
    states.push(state);
  }
  return { entries, states, final: state };
}

const newDir = tempDirs();

describe.each(SEEDS)("bible properties (seed %i)", (seed) => {
  it("no sequence of model events, any scope but the document, changes anything (reducer)", () => {
    for (const scope of ["series", "user"] as const) {
      const random = prng(seed);
      const initial = initialState(scope, scope);
      let state = initial;
      for (let i = 0; i < 300; i++) {
        const origin = pick(random, MODEL_ORIGINS);
        const result = applyEntry(state, { seq: i + 1, at: T0, origin, event: random() < 0.5 ? modelEvent(random) : userEvent(random) });
        expect(result.outcome.kind).toBe("refused");
        expect(result.state).toBe(state);
        state = result.state;
      }
      expect(state).toBe(initial);
    }
  });

  it("no sequence of model events reaches a series or the preferences through the store, nothing is written for them", async () => {
    const directory = await newDir();
    const store = new BibleStore({ directory, now: () => new Date(T0) });
    const random = prng(seed);
    const series = seriesScope("saga");
    for (let i = 0; i < 120; i++) {
      const ref = random() < 0.5 ? series : USER_SCOPE;
      const event = random() < 0.7 ? modelEvent(random) : userEvent(random);
      const result = await store.appendModelEvent(ref, pick(random, MODEL_ORIGINS), event);
      expect(result.status).toBe("refused");
    }
    for (const ref of [series, USER_SCOPE]) {
      const view = await store.read(ref);
      expect(view.bible.revision).toBe(0);
      expect(view.bible.characters).toEqual([]);
      expect(view.bible.narrator.traits).toEqual({});
      expect(view.bible.narrator.voice).toEqual({});
    }
    const journals = [path.join(directory, "bibles", "series", `${seriesSlug("saga")}.jsonl`), path.join(directory, "bibles", "user.jsonl")];
    for (const journal of journals) {
      await expect(readFile(journal)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("a model event stream in the document never touches the series or preferences that a user filled", async () => {
    const directory = await newDir();
    const store = new BibleStore({ directory, now: () => new Date(T0) });
    const series = seriesScope("saga");
    const doc = documentScope("file:///x.md", { persist: true });
    await store.appendUserEvent(series, { type: "userEdit", target: { kind: "trait", roleId: "anna", key: "accent", value: "rauque" } });
    await store.appendUserEvent(USER_SCOPE, { type: "userEdit", target: { kind: "trait", roleId: "narrator", key: "tempo", value: "1.1" } });
    const before = [JSON.stringify(await store.read(series)), JSON.stringify(await store.read(USER_SCOPE))];
    const random = prng(seed);
    for (let i = 0; i < 150; i++) {
      await store.appendModelEvent(doc, pick(random, MODEL_ORIGINS), modelEvent(random));
    }
    expect([JSON.stringify(await store.read(series)), JSON.stringify(await store.read(USER_SCOPE))]).toEqual(before);
  });

  it("is add-only: only userRetract removes a fact, and the projection stays valid at every step", () => {
    const random = prng(seed);
    const { states, entries } = run(seed, 400, () => {
      const roll = random();
      if (roll < 0.55) return { origin: pick(random, MODEL_ORIGINS), event: modelEvent(random) };
      if (roll < 0.9) return { origin: "user", event: userEvent(random) };
      return { origin: "user", event: retractEvent(random) };
    });
    // Recompute step by step from the recorded entries (refused ones changed nothing).
    let state = states[0] as BibleState;
    let retracts = 0;
    for (const entry of entries) {
      const before = paths(state.bible);
      state = applyEntry(state, entry).state;
      const after = paths(state.bible);
      expect(expectValidBible(state.bible)).toBeUndefined();
      if (entry.event.type === "userRetract") {
        retracts += 1;
        continue;
      }
      for (const p of before) {
        expect(after.has(p), `${entry.event.type} removed ${p}`).toBe(true);
      }
    }
    expect(entries.length).toBeGreaterThan(50);
    expect(retracts).toBeGreaterThan(0);
  });

  it("never replaces a user or locked fact with a model fact", () => {
    const random = prng(seed);
    let state = initialState("document", DOC);
    let seq = 0;
    const step = (origin: EventOrigin, event: BibleEvent) => {
      state = feed(state, ++seq, origin, event);
    };
    for (let i = 0; i < 30; i++) step("user", userEvent(random));
    for (let i = 0; i < 400; i++) {
      const before = protectedFacts(state.bible);
      const model = random() < 0.9;
      const origin = model ? pick(random, MODEL_ORIGINS) : "user";
      const event = model ? modelEvent(random) : random() < 0.5 ? userEvent(random) : retractEvent(random);
      step(origin, event);
      if (model) {
        const after = protectedFacts(state.bible);
        for (const [key, fact] of before) {
          expect(after.get(key), `${origin}:${event.type} displaced ${key}`).toBe(fact);
        }
      }
    }
  });

  it("a model never produces a user fact, a locked fact or a casting-by-user assignment", () => {
    const { final } = run(seed, 400, (random) => ({ origin: pick(random, MODEL_ORIGINS), event: modelEvent(random) }));
    for (const role of [final.bible.narrator, ...final.bible.characters]) {
      const facts = [...Object.values(role.traits), ...(role.voice.descriptor ? [role.voice.descriptor] : [])];
      for (const fact of facts) {
        expect(fact.by).not.toBe("user");
        expect(fact.locked).toBeUndefined();
      }
      for (const a of Object.values(role.voice.assignments ?? {})) {
        expect(a.by).toBe("casting");
        expect(a.locked).toBeUndefined();
      }
    }
  });

  it("what the user retracted never comes back through a model event (tombstone), until the user adds it", () => {
    const random = prng(seed);
    let state = initialState("document", DOC);
    let seq = 0;
    for (let i = 0; i < 40; i++) state = feed(state, ++seq, "analyst", modelEvent(random));
    for (let i = 0; i < 20; i++) state = feed(state, ++seq, "user", retractEvent(random));
    const tombstoned = state.tombstones.length;
    expect(tombstoned).toBeGreaterThan(0);
    const before = paths(state.bible);
    for (let i = 0; i < 300; i++) {
      state = feed(state, ++seq, pick(random, MODEL_ORIGINS), modelEvent(random));
      expect(state.tombstones).toHaveLength(tombstoned);
    }
    // Only paths that were free of any tombstone may have been added: every tombstoned key is still absent.
    const after = paths(state.bible);
    for (const key of state.tombstones) {
      const [kind, ...parts] = JSON.parse(key) as string[];
      const path = kind === "analysis" ? `analysis:${parts[0]}` : kind === "role" ? `role:${parts[0]}` : `${kind === "assignment" ? "assign" : kind}:${parts.join(":")}`;
      if (!before.has(path)) expect(after.has(path), path).toBe(false);
    }
  });

  it("replaying the journal always gives the same state: live, from the file text, through a checkpoint, twice", () => {
    const random = prng(seed);
    const { entries, final } = run(seed, 500, () => {
      const roll = random();
      if (roll < 0.5) return { origin: pick(random, MODEL_ORIGINS), event: modelEvent(random) };
      if (roll < 0.85) return { origin: "user", event: userEvent(random) };
      return { origin: "user", event: retractEvent(random) };
    });
    const initial = initialState("document", DOC);
    expect(replay(initial, entries).state).toEqual(final);
    expect(replay(initial, entries).state).toEqual(replay(initial, entries).state);
    const text = entries.map((entry) => `${serializeEventLine(entry)}\n`).join("");
    const parsed = parseJournal(text, "document", DOC);
    expect(parsed.state).toEqual(final);
    expect(parsed.skippedLines).toBe(0);
    expect(parsed.ignoredEvents).toBe(0);
    expect(parsed.lastSeq).toBe(entries.at(-1)?.seq ?? 0);
    // Cut anywhere and replay the rest on top of a checkpoint: same final state.
    const cut = Math.floor(entries.length / 2);
    const head = replay(initial, entries.slice(0, cut)).state;
    const viaCheckpoint = parseJournal(
      `${JSON.stringify({ v: 1, kind: "checkpoint", seq: entries[cut - 1]?.seq ?? 0, at: T0, state: head })}\n${entries.slice(cut).map((e) => `${serializeEventLine(e)}\n`).join("")}`,
      "document",
      DOC
    );
    expect(viaCheckpoint.state).toEqual(final);
    expect(viaCheckpoint.skippedLines).toBe(0);
  });

  it("store: the state after any sequence equals a fresh store's replay of the files, before and after compaction", async () => {
    const directory = await newDir();
    const store = new BibleStore({ directory, now: () => new Date(T0) });
    const doc = documentScope("file:///prop.md", { persist: true });
    const random = prng(seed);
    for (let i = 0; i < 120; i++) {
      const roll = random();
      if (roll < 0.6) await store.appendModelEvent(doc, pick(random, MODEL_ORIGINS), modelEvent(random));
      else if (roll < 0.9) await store.appendUserEvent(doc, userEvent(random));
      else await store.appendUserEvent(doc, retractEvent(random));
    }
    const live = await store.read(doc);
    const fresh = await new BibleStore({ directory }).read(doc);
    expect(fresh.bible).toEqual(live.bible);
    expect(fresh.candidates).toEqual(live.candidates);
    expect(fresh.report).toMatchObject({ skippedLines: 0, ignoredEvents: 0, lastSeq: live.report.lastSeq });
    await store.compact(doc);
    const compacted = await new BibleStore({ directory }).read(doc);
    expect(compacted.bible).toEqual(live.bible);
    expect(compacted.candidates).toEqual(live.candidates);
    expect(expectValidBible(compacted.bible)).toBeUndefined();
    expect(documentKeyOf("file:///prop.md")).toBe(doc.documentKey);
  });
});
