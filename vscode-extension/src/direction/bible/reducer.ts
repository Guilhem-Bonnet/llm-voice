/**
 * Pure projection of a bible journal (ADR-015 §4): `applyEntry` folds one
 * event into a state, `replay` folds a whole journal. Deterministic by
 * construction: no clock, no random, no I/O; everything an event needs
 * (`seq`, `at`, `origin`) is in the entry, so replaying a journal always
 * gives the same state.
 *
 * The write-rights rule lives HERE and not only in the store, so that it
 * holds for a live append AND for a replay of a file that was tampered with:
 *
 * - a model origin (`analyst`, `director`, `casting`) is honoured in the
 *   `document` scope only; in `series` and `user` it is refused;
 * - `userEdit`, `userRetract`, `userPromote` are user-only;
 * - a model never replaces, retracts or locks anything: a model fact that
 *   contradicts an existing one is kept as a *candidate*, not applied
 *   (ADR-015 §4, "Enrichie, jamais réécrite"); what the user retracted stays
 *   retracted (tombstone) for the model.
 */

import {
  DIRECTION_SCHEMA_VERSION,
  NARRATOR_SPEAKER_ID,
  type Bible,
  type BibleAnalysis,
  type BibleScope,
  type Fact,
  type FactAuthor,
  type Role,
  type RoleState,
  type VoiceAssignment
} from "../../core/direction.js";
import {
  BIBLE_LIMITS,
  MODEL_EVENT_TYPES,
  USER_ONLY_EVENT_TYPES,
  isModelOrigin,
  type BibleEvent,
  type EditTargetOf,
  type EventOrigin,
  type PromoteItem,
  type RetractTargetOf
} from "./events.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** A model proposal that contradicts what the bible already holds: kept, flagged, never applied. */
export interface Candidate {
  readonly seq: number;
  readonly at: string;
  readonly by: EventOrigin;
  readonly roleId: string | null;
  readonly kind: "trait" | "descriptor" | "assignment" | "analysis";
  readonly key: string | null;
  readonly value: string;
}

export interface BibleState {
  readonly bible: Bible;
  readonly candidates: readonly Candidate[];
  /** What the user retracted (keys only, never values): a model may not bring it back. */
  readonly tombstones: readonly string[];
}

export type Refusal =
  | "model-outside-document-scope"
  | "user-only-event"
  | "origin-not-allowed"
  | "analysis-document-only"
  | "promote-needs-series-or-user"
  | "narrator-reserved"
  | "unknown-role"
  | "not-found"
  | "exists"
  | "limit-reached"
  | "narrator-voice-reused";

export type ApplyOutcome =
  | { readonly kind: "applied" }
  | { readonly kind: "noop" }
  | { readonly kind: "candidate" }
  | { readonly kind: "tombstoned" }
  | { readonly kind: "refused"; readonly reason: Refusal };

export interface JournalEntry {
  readonly seq: number;
  readonly at: string;
  readonly origin: EventOrigin;
  readonly event: BibleEvent;
}

export function initialState(scope: BibleScope, scopeKey: string): BibleState {
  return {
    bible: {
      schemaVersion: DIRECTION_SCHEMA_VERSION,
      scope,
      scopeKey,
      revision: 0,
      ...(scope === "document" ? { analysis: {} } : {}),
      narrator: { id: NARRATOR_SPEAKER_ID, names: [], traits: {}, voice: {} },
      characters: []
    },
    candidates: [],
    tombstones: []
  };
}

// ---------------------------------------------------------------------------
// Authorisation
// ---------------------------------------------------------------------------

export function authorize(scope: BibleScope, origin: EventOrigin, event: BibleEvent): Refusal | undefined {
  const userOnly = USER_ONLY_EVENT_TYPES.includes(event.type);
  if (isModelOrigin(origin)) {
    if (scope !== "document") {
      return "model-outside-document-scope";
    }
    if (userOnly) {
      return "user-only-event";
    }
    if (!MODEL_EVENT_TYPES[origin].includes(event.type)) {
      return "origin-not-allowed";
    }
  }
  if (event.type === "userPromote" && scope === "document") {
    return "promote-needs-series-or-user";
  }
  if (scope !== "document") {
    if (event.type === "setAnalysis" || (event.type === "userEdit" && event.target.kind === "analysis")) {
      return "analysis-document-only";
    }
    if (event.type === "userRetract" && event.target.kind === "analysis") {
      return "analysis-document-only";
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

type DeepMutable<T> = T extends readonly (infer U)[]
  ? DeepMutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
    : T;

type Work = DeepMutable<BibleState>;
type WorkRole = DeepMutable<Role>;

const has = (record: object, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);

export function tombstoneKey(kind: string, ...parts: readonly string[]): string {
  return JSON.stringify([kind, ...parts]);
}

const refuse = (reason: Refusal): { readonly kind: "refused"; readonly reason: Refusal } => ({ kind: "refused", reason });
const APPLIED: ApplyOutcome = { kind: "applied" };
const NOOP: ApplyOutcome = { kind: "noop" };
const CANDIDATE: ApplyOutcome = { kind: "candidate" };
const TOMBSTONED: ApplyOutcome = { kind: "tombstoned" };

function factAuthor(origin: EventOrigin): FactAuthor {
  return origin === "user" ? "user" : origin === "casting" ? "analyst" : origin;
}

function findRole(work: Work, roleId: string): WorkRole | undefined {
  if (roleId === NARRATOR_SPEAKER_ID) {
    return work.bible.narrator;
  }
  return work.bible.characters.find((role) => role.id === roleId);
}

/** The user may edit a role that does not exist yet: the editor is how roles are born by hand. */
function obtainRole(work: Work, roleId: string): WorkRole | Refusal {
  const existing = findRole(work, roleId);
  if (existing !== undefined) {
    return existing;
  }
  if (work.bible.characters.length >= BIBLE_LIMITS.roles) {
    return "limit-reached";
  }
  const created: WorkRole = { id: roleId, names: [], traits: {}, voice: {} };
  work.bible.characters.push(created);
  dropTombstone(work, tombstoneKey("role", roleId));
  return created;
}

const isRefusal = (value: WorkRole | Refusal): value is Refusal => typeof value === "string";

function dropTombstone(work: Work, key: string): void {
  const index = work.tombstones.indexOf(key);
  if (index >= 0) {
    work.tombstones.splice(index, 1);
  }
}

function addTombstone(work: Work, key: string): boolean {
  if (work.tombstones.includes(key)) {
    return false;
  }
  work.tombstones.push(key);
  return true;
}

function pushCandidate(work: Work, candidate: Candidate): void {
  work.candidates.push({ ...candidate });
  if (work.candidates.length > BIBLE_LIMITS.candidatesMax) {
    work.candidates.splice(0, work.candidates.length - BIBLE_LIMITS.candidatesMax);
  }
}

function purgeCandidates(work: Work, match: (candidate: Candidate) => boolean): void {
  for (let index = work.candidates.length - 1; index >= 0; index--) {
    if (match(work.candidates[index] as Candidate)) {
      work.candidates.splice(index, 1);
    }
  }
}

function makeFact(
  value: string,
  by: FactAuthor,
  at: string,
  sourceIds: readonly string[] | undefined,
  locked: boolean | undefined
): DeepMutable<Fact> {
  return {
    value,
    by,
    at,
    ...(sourceIds !== undefined && sourceIds.length > 0 ? { sourceIds: [...sourceIds] } : {}),
    ...(locked === true ? { locked: true } : {})
  };
}

function reusesNarratorVoice(work: Work, role: WorkRole, providerId: string, voiceRef: string): boolean {
  if (role.id === NARRATOR_SPEAKER_ID) {
    return work.bible.characters.some((character) => character.voice.assignments?.[providerId]?.voiceRef === voiceRef);
  }
  return work.bible.narrator.voice.assignments?.[providerId]?.voiceRef === voiceRef;
}

type Place = "trait" | "descriptor";

/** Sets a trait or the descriptor. `replace` is the user's right; a model only ever adds. */
function putFact(
  work: Work,
  role: WorkRole,
  place: Place,
  key: string,
  fact: DeepMutable<Fact>,
  replace: boolean,
  entry: JournalEntry
): ApplyOutcome {
  const existing: Fact | undefined = place === "trait" ? (has(role.traits, key) ? role.traits[key] : undefined) : role.voice.descriptor;
  const tombstone = place === "trait" ? tombstoneKey("trait", role.id, key) : tombstoneKey("descriptor", role.id);
  if (isModelOrigin(entry.origin) && work.tombstones.includes(tombstone)) {
    return TOMBSTONED;
  }
  if (existing !== undefined && !replace) {
    if (existing.value === fact.value) {
      return NOOP;
    }
    if (isModelOrigin(entry.origin)) {
      pushCandidate(work, {
        seq: entry.seq,
        at: entry.at,
        by: entry.origin,
        roleId: role.id,
        kind: place,
        key: place === "trait" ? key : null,
        value: fact.value
      });
      return CANDIDATE;
    }
    return refuse("exists");
  }
  if (existing !== undefined && existing.value === fact.value && existing.by === fact.by && existing.locked === fact.locked) {
    return NOOP;
  }
  if (place === "trait") {
    if (existing === undefined && Object.keys(role.traits).length >= BIBLE_LIMITS.traitsPerRole) {
      return refuse("limit-reached");
    }
    role.traits = { ...role.traits, [key]: fact };
  } else {
    role.voice.descriptor = fact;
  }
  if (entry.origin === "user") {
    dropTombstone(work, tombstone);
  }
  return APPLIED;
}

function putAssignment(
  work: Work,
  role: WorkRole,
  providerId: string,
  voiceRef: string,
  locked: boolean | undefined,
  replace: boolean,
  entry: JournalEntry
): ApplyOutcome {
  const tombstone = tombstoneKey("assignment", role.id, providerId);
  if (isModelOrigin(entry.origin) && work.tombstones.includes(tombstone)) {
    return TOMBSTONED;
  }
  const assignments = role.voice.assignments ?? {};
  const existing: VoiceAssignment | undefined = has(assignments, providerId) ? assignments[providerId] : undefined;
  const by = entry.origin === "user" ? "user" : "casting";
  if (existing !== undefined && !replace) {
    if (existing.voiceRef === voiceRef) {
      return NOOP;
    }
    if (isModelOrigin(entry.origin)) {
      pushCandidate(work, {
        seq: entry.seq,
        at: entry.at,
        by: entry.origin,
        roleId: role.id,
        kind: "assignment",
        key: providerId,
        value: voiceRef
      });
      return CANDIDATE;
    }
    return refuse("exists");
  }
  if (existing !== undefined && existing.voiceRef === voiceRef && existing.by === by && existing.locked === (locked === true ? true : undefined)) {
    return NOOP;
  }
  if (reusesNarratorVoice(work, role, providerId, voiceRef)) {
    return refuse("narrator-voice-reused");
  }
  role.voice.assignments = { ...assignments, [providerId]: { voiceRef, by, ...(locked === true ? { locked: true } : {}) } };
  if (entry.origin === "user") {
    dropTombstone(work, tombstone);
  }
  return APPLIED;
}

function putAnalysis(work: Work, field: keyof BibleAnalysis, value: string, replace: boolean, entry: JournalEntry): ApplyOutcome {
  const tombstone = tombstoneKey("analysis", field);
  if (isModelOrigin(entry.origin) && work.tombstones.includes(tombstone)) {
    return TOMBSTONED;
  }
  const analysis = (work.bible.analysis ??= {});
  const existing = analysis[field];
  if (existing === value) {
    return NOOP;
  }
  if (existing !== undefined && !replace) {
    if (isModelOrigin(entry.origin)) {
      pushCandidate(work, { seq: entry.seq, at: entry.at, by: entry.origin, roleId: null, kind: "analysis", key: field, value });
      return CANDIDATE;
    }
    return refuse("exists");
  }
  analysis[field] = value;
  if (entry.origin === "user") {
    dropTombstone(work, tombstone);
  }
  return APPLIED;
}

/** Names are additive for everyone: removing one is a retract (`userRetract` of kind `name`). */
function putNames(work: Work, role: WorkRole, names: readonly string[], origin: EventOrigin): ApplyOutcome {
  const wanted = isModelOrigin(origin)
    ? names.filter((name) => !work.tombstones.includes(tombstoneKey("name", role.id, name)))
    : names;
  if (wanted.length === 0 && names.length > 0) {
    return TOMBSTONED;
  }
  const next = [...new Set([...role.names, ...wanted])];
  if (next.length > BIBLE_LIMITS.namesPerRole) {
    return refuse("limit-reached");
  }
  if (next.length === role.names.length) {
    return NOOP;
  }
  role.names = next;
  if (origin === "user") {
    for (const name of wanted) {
      dropTombstone(work, tombstoneKey("name", role.id, name));
    }
  }
  return APPLIED;
}

function applyEdit(work: Work, target: EditTargetOf | PromoteItem, entry: JournalEntry): ApplyOutcome {
  if (target.kind === "analysis") {
    return putAnalysis(work, target.field, target.value, true, entry);
  }
  const role = obtainRole(work, target.roleId);
  if (isRefusal(role)) {
    return refuse(role);
  }
  switch (target.kind) {
    case "trait":
      return putFact(work, role, "trait", target.key, makeFact(target.value, "user", entry.at, undefined, "locked" in target ? target.locked : undefined), true, entry);
    case "descriptor":
      return putFact(work, role, "descriptor", "", makeFact(target.value, "user", entry.at, undefined, "locked" in target ? target.locked : undefined), true, entry);
    case "names":
      return putNames(work, role, target.names, entry.origin);
    case "assignment":
      return putAssignment(work, role, target.providerId, target.voiceRef, "locked" in target ? target.locked : undefined, true, entry);
  }
}

function applyRetract(work: Work, target: RetractTargetOf): ApplyOutcome {
  let removed = false;
  let key: string;
  switch (target.kind) {
    case "analysis": {
      key = tombstoneKey("analysis", target.field);
      if (work.bible.analysis !== undefined && has(work.bible.analysis, target.field)) {
        delete work.bible.analysis[target.field];
        removed = true;
      }
      purgeCandidates(work, (c) => c.kind === "analysis" && c.key === target.field);
      break;
    }
    case "role": {
      if (target.roleId === NARRATOR_SPEAKER_ID) {
        return refuse("narrator-reserved");
      }
      key = tombstoneKey("role", target.roleId);
      const before = work.bible.characters.length;
      work.bible.characters = work.bible.characters.filter((role) => role.id !== target.roleId);
      removed = work.bible.characters.length !== before;
      purgeCandidates(work, (c) => c.roleId === target.roleId);
      break;
    }
    default: {
      const role = findRole(work, target.roleId);
      switch (target.kind) {
        case "trait":
          key = tombstoneKey("trait", target.roleId, target.key);
          if (role !== undefined && has(role.traits, target.key)) {
            const { [target.key]: _gone, ...rest } = role.traits;
            role.traits = rest;
            removed = true;
          }
          purgeCandidates(work, (c) => c.kind === "trait" && c.roleId === target.roleId && c.key === target.key);
          break;
        case "name":
          key = tombstoneKey("name", target.roleId, target.name);
          if (role !== undefined && role.names.includes(target.name)) {
            role.names = role.names.filter((name) => name !== target.name);
            removed = true;
          }
          break;
        case "descriptor":
          key = tombstoneKey("descriptor", target.roleId);
          if (role?.voice.descriptor !== undefined) {
            delete role.voice.descriptor;
            removed = true;
          }
          purgeCandidates(work, (c) => c.kind === "descriptor" && c.roleId === target.roleId);
          break;
        case "assignment":
          key = tombstoneKey("assignment", target.roleId, target.providerId);
          if (role?.voice.assignments !== undefined && has(role.voice.assignments, target.providerId)) {
            const { [target.providerId]: _gone, ...rest } = role.voice.assignments;
            if (Object.keys(rest).length > 0) {
              role.voice.assignments = rest;
            } else {
              delete role.voice.assignments;
            }
            removed = true;
          }
          purgeCandidates(work, (c) => c.kind === "assignment" && c.roleId === target.roleId && c.key === target.providerId);
          break;
        case "state": {
          key = tombstoneKey("state", target.roleId, target.label, target.fromSourceId);
          const before = role?.states?.length ?? 0;
          if (role?.states !== undefined) {
            const kept = role.states.filter((s) => !(s.label === target.label && s.fromSourceId === target.fromSourceId));
            removed = kept.length !== before;
            if (kept.length > 0) {
              role.states = kept;
            } else {
              delete role.states;
            }
          }
          break;
        }
      }
    }
  }
  const newTombstone = addTombstone(work, key);
  return removed || newTombstone ? APPLIED : NOOP;
}

/** Les attributions automatiques de ce moteur s'en vont ; `by: user` et `locked` restent. Aucune tombe. */
function applyRecast(work: Work, providerId: string): ApplyOutcome {
  let removed = false;
  for (const role of work.bible.characters) {
    const assignments = role.voice.assignments;
    const assignment = assignments !== undefined && has(assignments, providerId) ? assignments[providerId] : undefined;
    if (assignments === undefined || assignment === undefined || assignment.by === "user" || assignment.locked === true) {
      continue;
    }
    const { [providerId]: _gone, ...rest } = assignments;
    if (Object.keys(rest).length > 0) {
      role.voice.assignments = rest;
    } else {
      delete role.voice.assignments;
    }
    removed = true;
  }
  purgeCandidates(work, (c) => c.kind === "assignment" && c.key === providerId);
  return removed ? APPLIED : NOOP;
}

function applyModelOrUserAdd(work: Work, event: Exclude<BibleEvent, { type: "userEdit" | "userRetract" | "userRecast" | "userPromote" }>, entry: JournalEntry): ApplyOutcome {
  const by = factAuthor(entry.origin);
  const locked = isModelOrigin(entry.origin) ? undefined : "locked" in event ? event.locked : undefined;
  if (event.type === "setAnalysis") {
    return putAnalysis(work, event.field, event.value, false, entry);
  }
  if (event.type === "addRole") {
    if (event.roleId === NARRATOR_SPEAKER_ID) {
      return refuse("narrator-reserved");
    }
    const key = tombstoneKey("role", event.roleId);
    if (work.tombstones.includes(key)) {
      if (isModelOrigin(entry.origin)) {
        return TOMBSTONED;
      }
      dropTombstone(work, key);
    }
    const existing = findRole(work, event.roleId);
    if (existing !== undefined) {
      return putNames(work, existing, event.names, entry.origin);
    }
    if (work.bible.characters.length >= BIBLE_LIMITS.roles) {
      return refuse("limit-reached");
    }
    const created: WorkRole = { id: event.roleId, names: [], traits: {}, voice: {} };
    work.bible.characters.push(created);
    putNames(work, created, event.names, entry.origin);
    return APPLIED;
  }
  const role = findRole(work, event.roleId);
  if (role === undefined) {
    return refuse("unknown-role");
  }
  switch (event.type) {
    case "addTrait":
      return putFact(work, role, "trait", event.key, makeFact(event.value, by, entry.at, event.sourceIds, locked), false, entry);
    case "setDescriptor":
      return putFact(work, role, "descriptor", "", makeFact(event.value, by, entry.at, event.sourceIds, locked), false, entry);
    case "assignVoice":
      return putAssignment(work, role, event.providerId, event.voiceRef, locked, false, entry);
    case "addState": {
      const stateKey = tombstoneKey("state", role.id, event.label, event.fromSourceId);
      if (isModelOrigin(entry.origin) && work.tombstones.includes(stateKey)) {
        return TOMBSTONED;
      }
      const states = role.states ?? [];
      if (states.some((s) => s.label === event.label && s.fromSourceId === event.fromSourceId)) {
        return NOOP;
      }
      if (states.length >= BIBLE_LIMITS.statesPerRole) {
        return refuse("limit-reached");
      }
      const state: RoleState = {
        label: event.label,
        fromSourceId: event.fromSourceId,
        ...(event.untilSourceId !== undefined ? { untilSourceId: event.untilSourceId } : {}),
        by
      };
      role.states = [...states, state];
      dropTombstone(work, stateKey);
      return APPLIED;
    }
    case "closeState": {
      const state = role.states?.find((s) => s.label === event.label && s.fromSourceId === event.fromSourceId);
      if (state === undefined) {
        return refuse("not-found");
      }
      if (state.untilSourceId !== undefined) {
        return NOOP;
      }
      state.untilSourceId = event.untilSourceId;
      return APPLIED;
    }
  }
}

/**
 * Folds one entry into `state`. Returns the very same `state` object when the
 * outcome changes nothing; otherwise a new one (the input is never mutated).
 */
export function applyEntry(state: BibleState, entry: JournalEntry): { state: BibleState; outcome: ApplyOutcome } {
  const refusal = authorize(state.bible.scope, entry.origin, entry.event);
  if (refusal !== undefined) {
    return { state, outcome: refuse(refusal) };
  }
  const work = structuredClone(state) as unknown as Work;
  const event = entry.event;
  let outcome: ApplyOutcome;
  switch (event.type) {
    case "userEdit":
      outcome = applyEdit(work, event.target, entry);
      break;
    case "userPromote":
      outcome = applyEdit(work, event.item, entry);
      break;
    case "userRetract":
      outcome = applyRetract(work, event.target);
      break;
    case "userRecast":
      outcome = applyRecast(work, event.providerId);
      break;
    default:
      outcome = applyModelOrUserAdd(work, event, entry);
  }
  if (outcome.kind !== "applied" && outcome.kind !== "candidate") {
    return { state, outcome };
  }
  if (outcome.kind === "applied") {
    work.bible.revision += 1;
  }
  return { state: work as unknown as BibleState, outcome };
}

/** Folds a journal in order. Refused entries are ignored (and counted), never fatal. */
export function replay(initial: BibleState, entries: Iterable<JournalEntry>): { state: BibleState; ignored: number } {
  let state = initial;
  let ignored = 0;
  for (const entry of entries) {
    const result = applyEntry(state, entry);
    if (result.outcome.kind === "refused") {
      ignored += 1;
    }
    state = result.state;
  }
  return { state, ignored };
}
