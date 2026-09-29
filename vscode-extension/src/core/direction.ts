/**
 * Reading-direction contracts (ADR-015): the engine-independent score
 * ("partition") produced by the director, and the bible (cast + memory) it
 * reads. The canonical, language-neutral definition is the pair of JSON
 * Schemas under `contracts/direction-v1/`; this module is their Zod twin
 * (same fields, same bounds — `direction-v1.contract.test.ts` replays every
 * shared example through both), plus the pure code around them:
 *
 * - `boundPartition`: safety bounds (ADR-015 §7). An out-of-bound value is
 *   brought back inside the bound and counted, never rejected.
 * - `checkPartition` / `checkBible`: the few rules JSON Schema cannot express
 *   (unknown speaker, duplicate ids, narrator voice reused).
 * - the neutral cue and its conversion to and from today's narrator contract
 *   `{ sourceIds, spokenText }` (ADR-015 §9, backwards compatibility).
 *
 * Nothing here imports `vscode` or performs I/O. `DirectionProvider` (the LLM
 * roles, ADR-015 §2) is deliberately not defined yet: it belongs to the
 * provider card, not to the contract.
 */

import { z } from "zod";

import type { NarrationSegment } from "./narration.js";
import type { SourceRange, SourceSegment } from "./source.js";
import type { TtsRequest } from "./tts.js";

// ---------------------------------------------------------------------------
// Constants (mirrored by the JSON Schemas; a contract test guards the drift)
// ---------------------------------------------------------------------------

export const DIRECTION_SCHEMA_VERSION = "1.0";

/** Reserved speaker id of the narrator (ADR-015 §3). */
export const NARRATOR_SPEAKER_ID = "narrator";

/** Same pattern as Core v1's `segmentId`, so `cueId` can seed segment ids. */
export const CUE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
export const ROLE_ID_PATTERN = /^[a-z0-9-]+$/;
export const DOCUMENT_KEY_PATTERN = /^[a-f0-9]{64}$/;
export const RFC3339_DATE_TIME_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$/;

/**
 * Safety bounds of ADR-015 §7. They are bounds, not style rules: nothing here
 * says how a passage should be read.
 */
export const DIRECTION_BOUNDS = {
  pauseMs: { min: 0, max: 3000 },
  /** `pauseAfterMs` of a cue plus `pauseBeforeMs` of the next one. */
  silenceBetweenCuesMaxMs: 3000,
  tempo: { min: 0.7, max: 1.4 },
  intensity: { min: 0, max: 1 },
  valence: { min: -1, max: 1 },
  arousal: { min: 0, max: 1 },
  emphasisMax: 5,
  directionMaxChars: 280,
  statesMax: 4,
  stateMaxChars: 40,
  emotionLabelMaxChars: 40,
  nonverbalMax: 2,
  factValueMaxChars: 200
} as const;

export const NONVERBAL_KINDS = ["breath", "sigh", "laugh", "cough", "hesitation"] as const;
export const NONVERBAL_POSITIONS = ["before", "after"] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NonverbalKind = (typeof NONVERBAL_KINDS)[number];

export interface Nonverbal {
  readonly kind: NonverbalKind;
  readonly at: (typeof NONVERBAL_POSITIONS)[number];
}

export interface Emotion {
  /** Free label, no imposed vocabulary. */
  readonly label: string;
  readonly intensity: number;
  readonly valence?: number;
  readonly arousal?: number;
}

/** One playing instruction: who says what, and how (ADR-015 §3). */
export interface Cue {
  readonly cueId: string;
  readonly sourceIds: readonly string[];
  readonly speakerId: string;
  /** Spoken form of the text; never a paraphrase (ADR-015 §6). */
  readonly spokenText: string;
  readonly emotion?: Emotion;
  /** Multiplier of the profile speed. */
  readonly tempo?: number;
  readonly pauseBeforeMs?: number;
  readonly pauseAfterMs?: number;
  /** Exact substrings of `spokenText`. */
  readonly emphasis?: readonly string[];
  /** Natural-language playing note, never synthesised. */
  readonly direction?: string;
  readonly states?: readonly string[];
  readonly nonverbal?: readonly Nonverbal[];
}

/** Validated score for one reading window or document. */
export interface Partition {
  readonly schemaVersion: typeof DIRECTION_SCHEMA_VERSION;
  readonly documentKey: string;
  readonly bibleRevision: number;
  readonly cues: readonly Cue[];
}

export type FactAuthor = "analyst" | "director" | "user";
export type AssignmentAuthor = "casting" | "user";
export type BibleScope = "document" | "series" | "user";

export interface Fact {
  readonly value: string;
  readonly by: FactAuthor;
  /** RFC 3339 date-time. */
  readonly at: string;
  readonly sourceIds?: readonly string[];
  readonly locked?: boolean;
}

export interface RoleState {
  readonly label: string;
  readonly fromSourceId: string;
  readonly untilSourceId?: string;
  readonly by: FactAuthor;
}

export interface VoiceAssignment {
  readonly voiceRef: string;
  readonly by: AssignmentAuthor;
  readonly locked?: boolean;
}

export interface RoleVoice {
  readonly descriptor?: Fact;
  /** Keyed by `providerId`. */
  readonly assignments?: Readonly<Record<string, VoiceAssignment>>;
}

export interface Role {
  readonly id: string;
  readonly names: readonly string[];
  readonly traits: Readonly<Record<string, Fact>>;
  readonly states?: readonly RoleState[];
  readonly voice: RoleVoice;
}

export interface BibleAnalysis {
  readonly genre?: string;
  readonly intent?: string;
  readonly audience?: string;
  readonly baseTone?: string;
  readonly narratorPersona?: string;
  readonly readingProfileId?: string;
}

/** Projection of a bible for one scope (the journal itself is a later card). */
export interface Bible {
  readonly schemaVersion: typeof DIRECTION_SCHEMA_VERSION;
  readonly scope: BibleScope;
  readonly scopeKey: string;
  readonly revision: number;
  readonly analysis?: BibleAnalysis;
  readonly narrator: Role;
  readonly characters: readonly Role[];
}

// ---------------------------------------------------------------------------
// Zod schemas (twin of contracts/direction-v1/*.schema.json)
// ---------------------------------------------------------------------------

/** JSON Schema counts code points; `String.length` counts UTF-16 units. */
export function codePointLength(text: string): number {
  return Array.from(text).length;
}

/** Keeps the first `max` code points of `text`. */
export function truncateCodePoints(text: string, max: number): string {
  return codePointLength(text) <= max ? text : Array.from(text).slice(0, max).join("");
}

const maxChars = (max: number) =>
  z.string().refine((value) => codePointLength(value) <= max, { message: `at most ${max} characters` });

const boundedNumber = (range: { readonly min: number; readonly max: number }) =>
  z.number().min(range.min).max(range.max);

const CueIdSchema = z.string().regex(CUE_ID_PATTERN);
const RoleIdSchema = z.string().regex(ROLE_ID_PATTERN);
const SpokenTextSchema = z.string().min(1);
const NonverbalSchema = z
  .object({ kind: z.enum(NONVERBAL_KINDS), at: z.enum(NONVERBAL_POSITIONS) })
  .strict();

const EmotionSchema = z
  .object({
    label: maxChars(DIRECTION_BOUNDS.emotionLabelMaxChars),
    intensity: boundedNumber(DIRECTION_BOUNDS.intensity),
    valence: boundedNumber(DIRECTION_BOUNDS.valence).optional(),
    arousal: boundedNumber(DIRECTION_BOUNDS.arousal).optional()
  })
  .strict();

/** A cue inside the safety bounds of ADR-015 §7 (`partition.schema.json#/$defs/cue`). */
export const CueSchema = z
  .object({
    cueId: CueIdSchema,
    sourceIds: z.array(z.string()).min(1),
    speakerId: RoleIdSchema,
    spokenText: SpokenTextSchema,
    emotion: EmotionSchema.optional(),
    tempo: boundedNumber(DIRECTION_BOUNDS.tempo).optional(),
    pauseBeforeMs: z.number().int().min(DIRECTION_BOUNDS.pauseMs.min).max(DIRECTION_BOUNDS.pauseMs.max).optional(),
    pauseAfterMs: z.number().int().min(DIRECTION_BOUNDS.pauseMs.min).max(DIRECTION_BOUNDS.pauseMs.max).optional(),
    emphasis: z.array(z.string().min(1)).max(DIRECTION_BOUNDS.emphasisMax).optional(),
    direction: maxChars(DIRECTION_BOUNDS.directionMaxChars).optional(),
    states: z.array(maxChars(DIRECTION_BOUNDS.stateMaxChars)).max(DIRECTION_BOUNDS.statesMax).optional(),
    nonverbal: z.array(NonverbalSchema).max(DIRECTION_BOUNDS.nonverbalMax).optional()
  })
  .strict();

/** Validated partition (`partition.schema.json`). Cast to `Partition` after parsing (see `parsePartition`). */
export const PartitionSchema = z
  .object({
    schemaVersion: z.literal(DIRECTION_SCHEMA_VERSION),
    documentKey: z.string().regex(DOCUMENT_KEY_PATTERN),
    bibleRevision: z.number().int().min(0),
    cues: z.array(CueSchema)
  })
  .strict();

/**
 * Raw director output (ADR-015 §3, second paragraph): same fields, none of the
 * numeric or size bounds, unknown keys stripped. It is what the LLM's
 * structured output is validated against; `boundPartition` then brings the
 * values inside the bounds. Ids and enums stay strict: they cannot be repaired.
 */
export const RawCueSchema = z.object({
  cueId: CueIdSchema,
  sourceIds: z.array(z.string()).min(1),
  speakerId: RoleIdSchema,
  spokenText: SpokenTextSchema,
  emotion: z
    .object({
      label: z.string(),
      intensity: z.number(),
      valence: z.number().optional(),
      arousal: z.number().optional()
    })
    .optional(),
  tempo: z.number().optional(),
  pauseBeforeMs: z.number().optional(),
  pauseAfterMs: z.number().optional(),
  emphasis: z.array(z.string()).optional(),
  direction: z.string().optional(),
  states: z.array(z.string()).optional(),
  nonverbal: z.array(z.object({ kind: z.enum(NONVERBAL_KINDS), at: z.enum(NONVERBAL_POSITIONS) })).optional()
});

export const RawDirectionOutputSchema = z.object({ cues: z.array(RawCueSchema) });

export type RawCue = z.infer<typeof RawCueSchema>;
export type RawDirectionOutput = z.infer<typeof RawDirectionOutputSchema>;

const DateTimeSchema = z.string().regex(RFC3339_DATE_TIME_PATTERN);

function factSchema(by: z.ZodType<FactAuthor>) {
  return z
    .object({
      value: maxChars(DIRECTION_BOUNDS.factValueMaxChars),
      by,
      at: DateTimeSchema,
      sourceIds: z.array(z.string()).optional(),
      locked: z.boolean().optional()
    })
    .strict();
}

function stateSchema(by: z.ZodType<FactAuthor>) {
  return z
    .object({
      label: z.string(),
      fromSourceId: z.string(),
      untilSourceId: z.string().optional(),
      by
    })
    .strict();
}

function assignmentSchema(by: z.ZodType<AssignmentAuthor>) {
  return z.object({ voiceRef: z.string(), by, locked: z.boolean().optional() }).strict();
}

/**
 * `llm: true` is the `document` scope (an analyst, director or casting entry
 * is allowed); `llm: false` is `series` / `user`, where only the user writes
 * (ADR-015 §4, "Portées, droit d'écriture et précédence").
 */
function roleSchema(llm: boolean, id: z.ZodType<string>) {
  const factBy: z.ZodType<FactAuthor> = llm ? z.enum(["analyst", "director", "user"]) : z.literal("user");
  const assignmentBy: z.ZodType<AssignmentAuthor> = llm ? z.enum(["casting", "user"]) : z.literal("user");
  return z
    .object({
      id,
      names: z.array(z.string()),
      traits: z.record(z.string(), factSchema(factBy)),
      states: z.array(stateSchema(factBy)).optional(),
      voice: z
        .object({
          descriptor: factSchema(factBy).optional(),
          assignments: z.record(z.string(), assignmentSchema(assignmentBy)).optional()
        })
        .strict()
    })
    .strict();
}

const AnalysisSchema = z
  .object({
    genre: z.string().optional(),
    intent: z.string().optional(),
    audience: z.string().optional(),
    baseTone: z.string().optional(),
    narratorPersona: z.string().optional(),
    readingProfileId: z.string().optional()
  })
  .strict();

const CharacterIdSchema = RoleIdSchema.refine((value) => value !== NARRATOR_SPEAKER_ID, {
  message: `"${NARRATOR_SPEAKER_ID}" is reserved for the narrator`
});

function bibleSchema<S extends BibleScope>(scope: S, llm: boolean) {
  const shape = {
    schemaVersion: z.literal(DIRECTION_SCHEMA_VERSION),
    scope: z.literal(scope),
    scopeKey: z.string().min(1),
    revision: z.number().int().min(0),
    narrator: roleSchema(llm, z.literal(NARRATOR_SPEAKER_ID)),
    characters: z.array(roleSchema(llm, CharacterIdSchema))
  };
  return llm ? z.object({ ...shape, analysis: AnalysisSchema.optional() }).strict() : z.object(shape).strict();
}

/**
 * Bible projection (`bible.schema.json`). A discriminated union on `scope`
 * makes the write-scope rule structural: a `series` or `user` bible carrying
 * an LLM-authored fact, an assignment by `casting` or an `analysis` is invalid.
 */
export const BibleSchema = z.discriminatedUnion("scope", [
  bibleSchema("document", true),
  bibleSchema("series", false),
  bibleSchema("user", false)
]);

export function parsePartition(input: unknown): { ok: true; partition: Partition } | { ok: false; error: z.ZodError } {
  const parsed = PartitionSchema.safeParse(input);
  return parsed.success ? { ok: true, partition: parsed.data as Partition } : { ok: false, error: parsed.error };
}

export function parseBible(input: unknown): { ok: true; bible: Bible } | { ok: false; error: z.ZodError } {
  const parsed = BibleSchema.safeParse(input);
  return parsed.success ? { ok: true, bible: parsed.data as Bible } : { ok: false, error: parsed.error };
}

// ---------------------------------------------------------------------------
// Rules JSON Schema cannot express
// ---------------------------------------------------------------------------

export type DirectionIssueCode =
  | "duplicate-cue-id"
  | "unknown-speaker"
  | "duplicate-role-id"
  | "narrator-voice-reused";

export interface DirectionIssue {
  readonly code: DirectionIssueCode;
  /** Dotted path of the offending entry, without any content from the text. */
  readonly path: string;
  readonly message: string;
}

/**
 * Cross-cue and cross-document rules: every `cueId` is unique (silence ids
 * derive from it) and, when a bible is given, every `speakerId` is the
 * narrator or a role of that bible (unknown speaker = the reading falls back
 * to the narrator voice, so the director must not invent one).
 */
export function checkPartition(partition: Partition, bible?: Bible): DirectionIssue[] {
  const issues: DirectionIssue[] = [];
  const seen = new Set<string>();
  const speakers = bible === undefined ? undefined : new Set([bible.narrator.id, ...bible.characters.map((role) => role.id)]);
  partition.cues.forEach((cue, index) => {
    if (seen.has(cue.cueId)) {
      issues.push({ code: "duplicate-cue-id", path: `cues.${index}.cueId`, message: "cueId is used by an earlier cue" });
    }
    seen.add(cue.cueId);
    if (speakers !== undefined && !speakers.has(cue.speakerId)) {
      issues.push({ code: "unknown-speaker", path: `cues.${index}.speakerId`, message: "speakerId is not a role of the bible" });
    }
  });
  return issues;
}

/**
 * Role ids are unique, and the narrator's concrete voice is never assigned to
 * a character for the same provider (ADR-015 §7, "voix").
 */
export function checkBible(bible: Bible): DirectionIssue[] {
  const issues: DirectionIssue[] = [];
  const seen = new Set<string>([bible.narrator.id]);
  bible.characters.forEach((role, index) => {
    if (seen.has(role.id)) {
      issues.push({ code: "duplicate-role-id", path: `characters.${index}.id`, message: "role id is used by an earlier role" });
    }
    seen.add(role.id);
    for (const [providerId, assignment] of Object.entries(role.voice.assignments ?? {})) {
      if (bible.narrator.voice.assignments?.[providerId]?.voiceRef === assignment.voiceRef) {
        issues.push({
          code: "narrator-voice-reused",
          path: `characters.${index}.voice.assignments.${providerId}`,
          message: "the narrator voice is assigned to a character"
        });
      }
    }
  });
  return issues;
}

// ---------------------------------------------------------------------------
// Safety bounds (ADR-015 §7): out-of-bound values are brought back and counted
// ---------------------------------------------------------------------------

/** How many values were adjusted, by field. Carries no text (never logged content). */
export interface BoundsReport {
  readonly total: number;
  readonly byField: Readonly<Record<string, number>>;
}

export function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

class Counter {
  private readonly counts = new Map<string, number>();
  hit(field: string): void {
    this.counts.set(field, (this.counts.get(field) ?? 0) + 1);
  }
  report(): BoundsReport {
    const byField: Record<string, number> = {};
    let total = 0;
    for (const [field, count] of this.counts) {
      byField[field] = count;
      total += count;
    }
    return { total, byField };
  }
}

function bindNumber(counter: Counter, field: string, value: number, min: number, max: number, integer: boolean): number {
  const bounded = clampNumber(integer ? Math.round(value) : value, min, max);
  if (bounded !== value) {
    counter.hit(field);
  }
  return bounded;
}

function bindText(counter: Counter, field: string, value: string, max: number): string {
  const bounded = truncateCodePoints(value, max);
  if (bounded !== value) {
    counter.hit(field);
  }
  return bounded;
}

function bindList<T>(counter: Counter, field: string, values: readonly T[], max: number): T[] {
  if (values.length > max) {
    counter.hit(field);
  }
  return values.slice(0, max);
}

function boundCue(raw: RawCue, counter: Counter): Cue {
  const b = DIRECTION_BOUNDS;
  const cue: { -readonly [K in keyof Cue]: Cue[K] } = {
    cueId: raw.cueId,
    sourceIds: [...raw.sourceIds],
    speakerId: raw.speakerId,
    spokenText: raw.spokenText
  };
  if (raw.emotion !== undefined) {
    const emotion: { -readonly [K in keyof Emotion]: Emotion[K] } = {
      label: bindText(counter, "emotion.label", raw.emotion.label, b.emotionLabelMaxChars),
      intensity: bindNumber(counter, "emotion.intensity", raw.emotion.intensity, b.intensity.min, b.intensity.max, false)
    };
    if (raw.emotion.valence !== undefined) {
      emotion.valence = bindNumber(counter, "emotion.valence", raw.emotion.valence, b.valence.min, b.valence.max, false);
    }
    if (raw.emotion.arousal !== undefined) {
      emotion.arousal = bindNumber(counter, "emotion.arousal", raw.emotion.arousal, b.arousal.min, b.arousal.max, false);
    }
    cue.emotion = emotion;
  }
  if (raw.tempo !== undefined) {
    cue.tempo = bindNumber(counter, "tempo", raw.tempo, b.tempo.min, b.tempo.max, false);
  }
  if (raw.pauseBeforeMs !== undefined) {
    cue.pauseBeforeMs = bindNumber(counter, "pauseBeforeMs", raw.pauseBeforeMs, b.pauseMs.min, b.pauseMs.max, true);
  }
  if (raw.pauseAfterMs !== undefined) {
    cue.pauseAfterMs = bindNumber(counter, "pauseAfterMs", raw.pauseAfterMs, b.pauseMs.min, b.pauseMs.max, true);
  }
  if (raw.emphasis !== undefined) {
    // "sous-chaînes exactes de spokenText, sinon ignoré" (ADR-015 §7).
    const usable = raw.emphasis.filter((word) => word.length > 0 && raw.spokenText.includes(word));
    if (usable.length !== raw.emphasis.length) {
      counter.hit("emphasis.notSubstring");
    }
    cue.emphasis = bindList(counter, "emphasis.count", usable, b.emphasisMax);
  }
  if (raw.direction !== undefined) {
    cue.direction = bindText(counter, "direction", raw.direction, b.directionMaxChars);
  }
  if (raw.states !== undefined) {
    cue.states = bindList(counter, "states.count", raw.states, b.statesMax).map((state) =>
      bindText(counter, "states.label", state, b.stateMaxChars)
    );
  }
  if (raw.nonverbal !== undefined) {
    cue.nonverbal = bindList(counter, "nonverbal.count", raw.nonverbal, b.nonverbalMax).map((item) => ({
      kind: item.kind,
      at: item.at
    }));
  }
  return cue;
}

export interface BoundPartitionResult {
  readonly partition: Partition;
  readonly report: BoundsReport;
}

/**
 * Brings a raw director output inside the ADR-015 §7 bounds. Pure, total on
 * any schema-valid raw output, idempotent (re-bounding a bounded partition
 * reports nothing), and it never touches `cueId`, `sourceIds`, `speakerId` or
 * `spokenText`. Beyond the per-cue bounds it enforces the cumulative silence
 * between two consecutive cues (`pauseAfterMs` + next `pauseBeforeMs` <=
 * 3 000 ms) by reducing the later `pauseBeforeMs`.
 *
 * Not done here (controller card, not a numeric bound): `spokenText` length
 * against the source segment, narrator/character voice, re-prompt budget.
 */
export function boundPartition(
  raw: RawDirectionOutput,
  meta: { readonly documentKey: string; readonly bibleRevision: number }
): BoundPartitionResult {
  const counter = new Counter();
  const cues = raw.cues.map((cue) => boundCue(cue, counter));
  for (let index = 1; index < cues.length; index += 1) {
    const previous = cues[index - 1];
    const current = cues[index];
    if (previous === undefined || current === undefined) {
      continue;
    }
    const cumulative = (previous.pauseAfterMs ?? 0) + (current.pauseBeforeMs ?? 0);
    if (cumulative > DIRECTION_BOUNDS.silenceBetweenCuesMaxMs) {
      counter.hit("silenceBetweenCues");
      cues[index] = { ...current, pauseBeforeMs: DIRECTION_BOUNDS.silenceBetweenCuesMaxMs - (previous.pauseAfterMs ?? 0) };
    }
  }
  return {
    partition: {
      schemaVersion: DIRECTION_SCHEMA_VERSION,
      documentKey: meta.documentKey,
      bibleRevision: meta.bibleRevision,
      cues
    },
    report: counter.report()
  };
}

/** Segment id of the silence inserted before/after a cue (ADR-015 §5.4). */
export function silenceSegmentId(cueId: string, position: "pre" | "post"): string {
  return `${cueId}-${position === "pre" ? "pre" : "post"}`;
}

// ---------------------------------------------------------------------------
// Neutral cue and compatibility with today's narrator contract (ADR-015 §9)
// ---------------------------------------------------------------------------

/** Today's `narration-segments` element (`src/narrator/narrationContract.ts`), after `BLOCK_xxx` mapping. */
export interface NarratorContractSegment {
  readonly sourceIds: readonly string[];
  readonly spokenText: string;
}

/**
 * The neutral cue of ADR-015 §9: narrator voice, the segment's text, tempo 1,
 * no pause, no emotion. Translated, it yields exactly today's synthesis request.
 */
export function neutralCue(input: { cueId: string; sourceIds: readonly string[]; spokenText: string }): Cue {
  return {
    cueId: input.cueId,
    sourceIds: [...input.sourceIds],
    speakerId: NARRATOR_SPEAKER_ID,
    spokenText: input.spokenText,
    tempo: 1,
    pauseBeforeMs: 0,
    pauseAfterMs: 0
  };
}

/** True when nothing in the cue departs from the neutral reading. */
export function isNeutralCue(cue: Cue): boolean {
  return (
    cue.speakerId === NARRATOR_SPEAKER_ID &&
    (cue.tempo ?? 1) === 1 &&
    (cue.pauseBeforeMs ?? 0) === 0 &&
    (cue.pauseAfterMs ?? 0) === 0 &&
    cue.emotion === undefined &&
    (cue.emphasis?.length ?? 0) === 0 &&
    cue.direction === undefined &&
    (cue.states?.length ?? 0) === 0 &&
    (cue.nonverbal?.length ?? 0) === 0
  );
}

export class DirectionContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DirectionContractError";
  }
}

export interface NeutralPartitionMeta {
  readonly documentKey: string;
  readonly bibleRevision: number;
}

function assertConvertible(segment: NarratorContractSegment, index: number): void {
  if (segment.sourceIds.length === 0) {
    throw new DirectionContractError(`segment ${index}: sourceIds is empty`);
  }
  if (segment.spokenText.length === 0) {
    throw new DirectionContractError(`segment ${index}: spokenText is empty`);
  }
}

/**
 * A narrator result (`{ sourceIds, spokenText }[]`) as a neutral partition,
 * without loss: the contract is a subset of the cue. Cue ids default to
 * `cue-001`, `cue-002`, … Throws `DirectionContractError` on an empty
 * `sourceIds` or `spokenText`, which the narrator contract already forbids
 * (`minItems`/`minLength` 1).
 */
export function narratorSegmentsToNeutralPartition(
  segments: readonly NarratorContractSegment[],
  meta: NeutralPartitionMeta,
  cueIdFor: (index: number) => string = (index) => `cue-${String(index + 1).padStart(3, "0")}`
): Partition {
  return {
    schemaVersion: DIRECTION_SCHEMA_VERSION,
    documentKey: meta.documentKey,
    bibleRevision: meta.bibleRevision,
    cues: segments.map((segment, index) => {
      assertConvertible(segment, index);
      return neutralCue({ cueId: cueIdFor(index), sourceIds: segment.sourceIds, spokenText: segment.spokenText });
    })
  };
}

/**
 * The narrator-contract projection of a partition. Lossless for a neutral
 * partition; for a directed one it keeps only what today's contract can
 * carry (which is what the current pipeline consumes).
 */
export function partitionToNarratorSegments(partition: Partition): NarratorContractSegment[] {
  return partition.cues.map((cue) => ({ sourceIds: [...cue.sourceIds], spokenText: cue.spokenText }));
}

/** `cueId` for a narration segment id: same id when it already fits, else unsafe characters become `_`; unique in the batch. */
function cueIdsFor(ids: readonly string[]): string[] {
  const used = new Set<string>();
  return ids.map((id) => {
    const base = CUE_ID_PATTERN.test(id) ? id : id.replace(/[^A-Za-z0-9_-]/g, "_") || "cue";
    let candidate = base;
    for (let suffix = 2; used.has(candidate); suffix += 1) {
      candidate = `${base}-${suffix}`;
    }
    used.add(candidate);
    return candidate;
  });
}

/**
 * Today's narration segments as a neutral partition. `cueId` is the segment
 * id when it already matches the Core `segmentId` pattern (`faithful-…`,
 * `narrated-N` do), so the round trip keeps ids.
 */
export function narrationSegmentsToNeutralPartition(
  segments: readonly NarrationSegment[],
  meta: NeutralPartitionMeta
): Partition {
  const ids = cueIdsFor(segments.map((segment) => segment.id));
  return narratorSegmentsToNeutralPartition(
    segments.map((segment) => ({ sourceIds: segment.sourceSegmentIds, spokenText: segment.spokenText })),
    meta,
    (index) => ids[index] ?? `cue-${index + 1}`
  );
}

/** Same lookup `parseNarration` performs: the source range of every known source id that has one. */
export function sourceRangeResolver(
  segments: readonly SourceSegment[]
): (sourceIds: readonly string[]) => readonly SourceRange[] {
  const byId = new Map(segments.map((segment) => [segment.id, segment]));
  return (sourceIds) =>
    sourceIds
      .map((id) => byId.get(id)?.sourceRange)
      .filter((range): range is SourceRange => range !== undefined);
}

/**
 * A partition as the segments the existing pipeline consumes. A neutral cue
 * yields a plain `NarrationSegment` (no `metadata`), identical to today's;
 * a directed cue carries itself in `metadata.direction` (ADR-015 §9) so the
 * translator can read it without changing the pipeline signature.
 */
export function partitionToNarrationSegments(
  partition: Partition,
  rangesFor: (sourceIds: readonly string[]) => readonly SourceRange[] = () => []
): NarrationSegment[] {
  return partition.cues.map((cue) => ({
    id: cue.cueId,
    spokenText: cue.spokenText,
    sourceSegmentIds: [...cue.sourceIds],
    sourceRanges: [...rangesFor(cue.sourceIds)],
    ...(isNeutralCue(cue) ? {} : { metadata: { direction: cue } })
  }));
}

/** Engine binding of a session: what `AudioQueue` copies into each request. */
export interface SynthesisBinding {
  readonly language?: string;
  readonly voice?: string;
  readonly model?: string;
  readonly speed?: number;
  readonly format?: TtsRequest["format"];
  readonly parameters?: Readonly<Record<string, unknown>>;
}

/**
 * Baseline synthesis request of a cue: the spoken text plus the session's
 * binding, exactly as `AudioQueue` builds it today (same keys, same omission
 * of undefined ones). A neutral cue needs nothing more, which is the
 * backwards-compatibility guarantee; the capability-aware translation of a
 * directed cue (voice per role, intensity, tempo) is the translator card.
 */
export function baselineTtsRequest(cue: Cue, binding: SynthesisBinding): TtsRequest {
  return {
    text: cue.spokenText,
    ...(binding.language !== undefined ? { language: binding.language } : {}),
    ...(binding.voice !== undefined ? { voice: binding.voice } : {}),
    ...(binding.model !== undefined ? { model: binding.model } : {}),
    ...(binding.speed !== undefined ? { speed: binding.speed } : {}),
    ...(binding.format !== undefined ? { format: binding.format } : {}),
    ...(binding.parameters !== undefined ? { parameters: binding.parameters } : {})
  };
}
