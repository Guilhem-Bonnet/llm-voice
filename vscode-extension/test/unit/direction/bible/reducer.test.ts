/**
 * ADR-015 §4: the journal reducer. Write rights per scope and origin, the
 * enrich-never-rewrite rule (candidates, tombstones), edit, retract and
 * promote semantics.
 */
import { describe, expect, it } from "vitest";

import { NARRATOR_SPEAKER_ID } from "../../../../src/core/direction.js";
import {
  BIBLE_LIMITS,
  applyEntry,
  authorize,
  initialState,
  parseBibleEvent,
  replay,
  tombstoneKey,
  type BibleEvent,
  type JournalEntry
} from "../../../../src/direction/bible/index.js";
import { DOC, Sim, T0, expectValidBible } from "./helpers.js";

const addRole = (roleId: string, names: string[] = []): BibleEvent => ({ type: "addRole", roleId, names });
const addTrait = (roleId: string, key: string, value: string): BibleEvent => ({ type: "addTrait", roleId, key, value });

describe("authorisation matrix (ADR-015 §4, droits d'écriture)", () => {
  it.each(["analyst", "director", "casting"] as const)("refuses every event of the model origin %s in series and user", (origin) => {
    for (const scope of ["series", "user"] as const) {
      const sim = new Sim(scope);
      for (const event of [addRole("anna"), addTrait("narrator", "k", "v"), { type: "assignVoice", roleId: "narrator", providerId: "p", voiceRef: "v" } as BibleEvent]) {
        const before = sim.state;
        const outcome = sim.apply(origin, event);
        expect(outcome).toEqual({ kind: "refused", reason: "model-outside-document-scope" });
        expect(sim.state).toBe(before);
      }
    }
  });

  it("refuses user-only events sent by a model, even in the document scope", () => {
    const sim = new Sim();
    const forged: BibleEvent[] = [
      { type: "userEdit", target: { kind: "trait", roleId: "narrator", key: "k", value: "v" } },
      { type: "userRetract", target: { kind: "role", roleId: "anna" } },
      { type: "userPromote", fromDocumentKey: DOC, item: { kind: "names", roleId: "anna", names: ["Anna"] } }
    ];
    for (const event of forged) {
      expect(sim.apply("analyst", event)).toEqual({ kind: "refused", reason: "user-only-event" });
    }
    expect(sim.bible.revision).toBe(0);
  });

  it("gives casting the voice assignment only, and the analyst/director everything but that", () => {
    const sim = new Sim();
    sim.apply("analyst", addRole("anna"));
    expect(sim.apply("casting", addTrait("anna", "age", "40"))).toEqual({ kind: "refused", reason: "origin-not-allowed" });
    expect(sim.apply("casting", addRole("bob"))).toEqual({ kind: "refused", reason: "origin-not-allowed" });
    expect(sim.apply("casting", { type: "assignVoice", roleId: "anna", providerId: "piper", voiceRef: "fr-a" }).kind).toBe("applied");
    expect(sim.apply("director", { type: "assignVoice", roleId: "anna", providerId: "piper", voiceRef: "fr-b" })).toEqual({ kind: "refused", reason: "origin-not-allowed" });
  });

  it("keeps `analysis` in the document scope, `userPromote` out of it", () => {
    expect(authorize("series", "user", { type: "setAnalysis", field: "genre", value: "x" })).toBe("analysis-document-only");
    expect(authorize("user", "user", { type: "userEdit", target: { kind: "analysis", field: "genre", value: "x" } })).toBe("analysis-document-only");
    expect(authorize("document", "user", { type: "userPromote", fromDocumentKey: DOC, item: { kind: "names", roleId: "a", names: ["A"] } })).toBe("promote-needs-series-or-user");
  });

  it("accepts the user in every scope", () => {
    for (const scope of ["document", "series", "user"] as const) {
      const sim = new Sim(scope);
      expect(sim.apply("user", addRole("anna", ["Anna"])).kind).toBe("applied");
      expect(expectValidBible(sim.bible)).toBeUndefined();
      const fact = sim.bible.characters[0];
      expect(fact?.names).toEqual(["Anna"]);
    }
  });
});

describe("enrich, never rewrite (ADR-015 §4)", () => {
  it("keeps a contradicting model fact as a candidate, not applied", () => {
    const sim = new Sim();
    sim.apply("analyst", addRole("anna"));
    sim.apply("analyst", addTrait("anna", "age", "40"));
    const revision = sim.bible.revision;
    expect(sim.apply("director", addTrait("anna", "age", "25"))).toEqual({ kind: "candidate" });
    expect(sim.bible.characters[0]?.traits.age?.value).toBe("40");
    expect(sim.bible.revision).toBe(revision);
    expect(sim.state.candidates).toMatchObject([{ roleId: "anna", kind: "trait", key: "age", value: "25", by: "director" }]);
  });

  it("is idempotent: the same model fact twice is a no-op, and not journaled as a change", () => {
    const sim = new Sim();
    sim.apply("analyst", addRole("anna"));
    sim.apply("analyst", addTrait("anna", "age", "40"));
    const before = sim.state;
    expect(sim.apply("analyst", addTrait("anna", "age", "40"))).toEqual({ kind: "noop" });
    expect(sim.state).toBe(before);
  });

  it("never replaces a user or locked fact, whatever the model sends", () => {
    const sim = new Sim();
    sim.apply("user", { type: "userEdit", target: { kind: "trait", roleId: "anna", key: "accent", value: "rauque", locked: true } });
    sim.apply("user", { type: "userEdit", target: { kind: "assignment", roleId: "anna", providerId: "piper", voiceRef: "fr-a", locked: true } });
    sim.apply("analyst", addTrait("anna", "accent", "clair"));
    sim.apply("casting", { type: "assignVoice", roleId: "anna", providerId: "piper", voiceRef: "fr-z" });
    expect(sim.bible.characters[0]?.traits.accent).toMatchObject({ value: "rauque", by: "user", locked: true });
    expect(sim.bible.characters[0]?.voice.assignments?.piper).toMatchObject({ voiceRef: "fr-a", by: "user", locked: true });
  });

  it("drops a `locked` sent by a model: only the user locks", () => {
    const sim = new Sim();
    sim.apply("analyst", addRole("anna"));
    const parsed = parseBibleEvent({ type: "addTrait", roleId: "anna", key: "k", value: "v", locked: true }, "analyst");
    expect(parsed.ok && parsed.event.type === "addTrait" && parsed.event.locked).toBeFalsy();
    // ...and a replayed line that carries it anyway does not lock either.
    const outcome = sim.apply("analyst", { type: "addTrait", roleId: "anna", key: "k2", value: "v", locked: true });
    expect(outcome.kind).toBe("applied");
    expect(sim.bible.characters[0]?.traits.k2?.locked).toBeUndefined();
  });

  it("cuts a model's over-long value to the bound and refuses a user's", () => {
    const long = "é".repeat(500);
    const model = parseBibleEvent({ type: "addTrait", roleId: "anna", key: "k", value: long }, "analyst");
    expect(model.ok && model.event.type === "addTrait" && Array.from(model.event.value).length).toBe(200);
    expect(parseBibleEvent({ type: "addTrait", roleId: "anna", key: "k", value: long }, "user").ok).toBe(false);
    expect(parseBibleEvent({ type: "addTrait", roleId: "anna", key: "__proto__", value: "x" }, "user").ok).toBe(false);
  });

  it("refuses model facts about a role that does not exist and a model narrator role", () => {
    const sim = new Sim();
    expect(sim.apply("analyst", addTrait("ghost", "k", "v"))).toEqual({ kind: "refused", reason: "unknown-role" });
    expect(sim.apply("analyst", addRole(NARRATOR_SPEAKER_ID))).toEqual({ kind: "refused", reason: "narrator-reserved" });
    expect(sim.apply("analyst", addTrait(NARRATOR_SPEAKER_ID, "tone", "chaud")).kind).toBe("applied");
  });

  it("bounds a bible: roles, traits and states", () => {
    const sim = new Sim();
    for (let i = 0; i < BIBLE_LIMITS.roles; i++) {
      expect(sim.apply("analyst", addRole(`r${i}`)).kind).toBe("applied");
    }
    expect(sim.apply("analyst", addRole("one-too-many"))).toEqual({ kind: "refused", reason: "limit-reached" });
    for (let i = 0; i < BIBLE_LIMITS.traitsPerRole; i++) {
      sim.apply("analyst", addTrait("r0", `k${i}`, "v"));
    }
    expect(sim.apply("analyst", addTrait("r0", "extra", "v"))).toEqual({ kind: "refused", reason: "limit-reached" });
    for (let i = 0; i < BIBLE_LIMITS.statesPerRole; i++) {
      sim.apply("analyst", { type: "addState", roleId: "r1", label: `s${i}`, fromSourceId: "a" });
    }
    expect(sim.apply("analyst", { type: "addState", roleId: "r1", label: "over", fromSourceId: "a" })).toEqual({ kind: "refused", reason: "limit-reached" });
  });

  it("refuses a voice that would give the narrator's voice to a character, in either order", () => {
    const sim = new Sim();
    sim.apply("analyst", addRole("anna"));
    sim.apply("user", { type: "userEdit", target: { kind: "assignment", roleId: "narrator", providerId: "piper", voiceRef: "fr-n" } });
    expect(sim.apply("casting", { type: "assignVoice", roleId: "anna", providerId: "piper", voiceRef: "fr-n" })).toEqual({ kind: "refused", reason: "narrator-voice-reused" });
    expect(sim.apply("casting", { type: "assignVoice", roleId: "anna", providerId: "chatterbox", voiceRef: "fr-n" }).kind).toBe("applied");
    sim.apply("casting", { type: "assignVoice", roleId: "anna", providerId: "kokoro", voiceRef: "fr-k" });
    expect(sim.apply("user", { type: "userEdit", target: { kind: "assignment", roleId: "narrator", providerId: "kokoro", voiceRef: "fr-k" } })).toEqual({ kind: "refused", reason: "narrator-voice-reused" });
    expect(expectValidBible(sim.bible)).toBeUndefined();
  });

  it("opens and closes a state, and never reopens or rewrites a closed one", () => {
    const sim = new Sim();
    sim.apply("analyst", addRole("anna"));
    sim.apply("analyst", { type: "addState", roleId: "anna", label: "ivre", fromSourceId: "c3-01" });
    expect(sim.apply("analyst", { type: "closeState", roleId: "anna", label: "ivre", fromSourceId: "c3-01", untilSourceId: "c3-40" }).kind).toBe("applied");
    expect(sim.apply("director", { type: "closeState", roleId: "anna", label: "ivre", fromSourceId: "c3-01", untilSourceId: "c9-01" })).toEqual({ kind: "noop" });
    expect(sim.apply("analyst", { type: "closeState", roleId: "anna", label: "épuisé", fromSourceId: "c3-01", untilSourceId: "x" })).toEqual({ kind: "refused", reason: "not-found" });
    expect(sim.bible.characters[0]?.states).toEqual([{ label: "ivre", fromSourceId: "c3-01", untilSourceId: "c3-40", by: "analyst" }]);
  });
});

describe("user edit, retract (tombstone) and promote", () => {
  it("lets the user replace a fact, which becomes by:user, and edit names", () => {
    const sim = new Sim();
    sim.apply("analyst", addRole("anna"));
    sim.apply("analyst", addTrait("anna", "age", "40"));
    expect(sim.apply("user", { type: "userEdit", target: { kind: "trait", roleId: "anna", key: "age", value: "41" } }).kind).toBe("applied");
    expect(sim.apply("user", { type: "userEdit", target: { kind: "trait", roleId: "anna", key: "age", value: "41" } }).kind).toBe("noop");
    expect(sim.bible.characters[0]?.traits.age).toMatchObject({ value: "41", by: "user" });
    sim.apply("user", { type: "userEdit", target: { kind: "names", roleId: "anna", names: ["Anna", "Mme Roux"] } });
    expect(sim.bible.characters[0]?.names).toEqual(["Anna", "Mme Roux"]);
  });

  it("creates a role by hand on a user edit", () => {
    const sim = new Sim("series");
    expect(sim.apply("user", { type: "userEdit", target: { kind: "descriptor", roleId: "kaelen", value: "voix grave" } }).kind).toBe("applied");
    expect(sim.bible.characters.map((r) => r.id)).toEqual(["kaelen"]);
  });

  it("retracts with a tombstone the model cannot lift, and purges candidates that hold the value", () => {
    const sim = new Sim();
    sim.apply("analyst", addRole("anna"));
    sim.apply("analyst", addTrait("anna", "age", "40"));
    sim.apply("director", addTrait("anna", "age", "25")); // candidate
    expect(sim.state.candidates).toHaveLength(1);
    expect(sim.apply("user", { type: "userRetract", target: { kind: "trait", roleId: "anna", key: "age" } }).kind).toBe("applied");
    expect(sim.bible.characters[0]?.traits.age).toBeUndefined();
    expect(sim.state.candidates).toHaveLength(0);
    expect(sim.state.tombstones).toContain(tombstoneKey("trait", "anna", "age"));
    expect(sim.apply("analyst", addTrait("anna", "age", "40"))).toEqual({ kind: "tombstoned" });
    // The user can add it back, which lifts the tombstone.
    expect(sim.apply("user", addTrait("anna", "age", "42")).kind).toBe("applied");
    expect(sim.state.tombstones).not.toContain(tombstoneKey("trait", "anna", "age"));
  });

  it("retracts a whole role, refuses to retract the narrator, and blocks the model from re-adding the role", () => {
    const sim = new Sim();
    sim.apply("analyst", addRole("anna", ["Anna"]));
    sim.apply("analyst", addTrait("anna", "age", "40"));
    expect(sim.apply("user", { type: "userRetract", target: { kind: "role", roleId: NARRATOR_SPEAKER_ID } })).toEqual({ kind: "refused", reason: "narrator-reserved" });
    sim.apply("user", { type: "userRetract", target: { kind: "role", roleId: "anna" } });
    expect(sim.bible.characters).toEqual([]);
    expect(sim.apply("analyst", addRole("anna"))).toEqual({ kind: "tombstoned" });
  });

  it("retracts a descriptor, an assignment, a state and an analysis field", () => {
    const sim = new Sim();
    sim.apply("analyst", addRole("anna"));
    sim.apply("analyst", { type: "setDescriptor", roleId: "anna", value: "voix rauque" });
    sim.apply("casting", { type: "assignVoice", roleId: "anna", providerId: "piper", voiceRef: "fr-a" });
    sim.apply("analyst", { type: "addState", roleId: "anna", label: "ivre", fromSourceId: "a" });
    sim.apply("analyst", { type: "setAnalysis", field: "genre", value: "roman" });
    for (const target of [
      { kind: "descriptor", roleId: "anna" },
      { kind: "assignment", roleId: "anna", providerId: "piper" },
      { kind: "state", roleId: "anna", label: "ivre", fromSourceId: "a" },
      { kind: "analysis", field: "genre" }
    ] as const) {
      expect(sim.apply("user", { type: "userRetract", target }).kind).toBe("applied");
    }
    const anna = sim.bible.characters[0];
    expect(anna?.voice).toEqual({});
    expect(anna?.states).toBeUndefined();
    expect(sim.bible.analysis).toEqual({});
    expect(sim.apply("analyst", { type: "setAnalysis", field: "genre", value: "roman" })).toEqual({ kind: "tombstoned" });
    expect(sim.apply("casting", { type: "assignVoice", roleId: "anna", providerId: "piper", voiceRef: "fr-a" })).toEqual({ kind: "tombstoned" });
    expect(expectValidBible(sim.bible)).toBeUndefined();
  });

  it("applies a promotion as a user fact in a series, without the document's sourceIds", () => {
    const sim = new Sim("series");
    const outcome = sim.apply("user", { type: "userPromote", fromDocumentKey: DOC, item: { kind: "trait", roleId: "anna", key: "accent", value: "rauque" } });
    expect(outcome.kind).toBe("applied");
    expect(sim.bible.characters[0]?.traits.accent).toMatchObject({ value: "rauque", by: "user" });
    expect(sim.bible.characters[0]?.traits.accent?.sourceIds).toBeUndefined();
    expect(expectValidBible(sim.bible)).toBeUndefined();
  });
});

describe("replay", () => {
  it("does not mutate its input and is a pure fold", () => {
    const initial = initialState("document", DOC);
    const snapshot = JSON.stringify(initial);
    const entries: JournalEntry[] = [
      { seq: 1, at: T0, origin: "analyst", event: addRole("anna") },
      { seq: 2, at: T0, origin: "analyst", event: addTrait("anna", "age", "40") },
      { seq: 3, at: T0, origin: "user", event: { type: "userRetract", target: { kind: "trait", roleId: "anna", key: "age" } } }
    ];
    const first = replay(initial, entries);
    expect(JSON.stringify(initial)).toBe(snapshot);
    expect(replay(initial, entries)).toEqual(first);
    expect(first.state.bible.revision).toBe(3);
  });

  it("ignores, and counts, a model event that sits in a series journal", () => {
    const entries: JournalEntry[] = [{ seq: 1, at: T0, origin: "analyst", event: addRole("anna") }];
    const { state, ignored } = replay(initialState("series", "saga"), entries);
    expect(ignored).toBe(1);
    expect(state.bible.characters).toEqual([]);
    expect(state.bible.revision).toBe(0);
  });

  it("gives the same initial state as `initialState` for an empty journal", () => {
    const initial = initialState("user", "user");
    expect(replay(initial, []).state).toBe(initial);
    expect(applyEntry(initial, { seq: 1, at: T0, origin: "analyst", event: addRole("x") }).state).toBe(initial);
  });
});
