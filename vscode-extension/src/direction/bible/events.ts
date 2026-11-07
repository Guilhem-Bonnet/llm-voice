/**
 * Bible journal events (ADR-015 §4, "Enrichie, jamais réécrite"). The bible is
 * an append-only journal; its state is a projection of that journal
 * (`reducer.ts`). This module only defines what an event *is* and validates
 * one; who may write which event in which scope is decided by the reducer.
 *
 * The ADR names eight events (`addRole`, `addTrait`, `addState`, `closeState`,
 * `assignVoice`, `userEdit`, `userRetract`, `userPromote`). Two are added here
 * because the contract has a slot that none of the eight can fill:
 * `setDescriptor` (`voice.descriptor`) and `setAnalysis` (`analysis`).
 *
 * No `vscode` import, no I/O.
 */

import { z } from "zod";

import {
  DIRECTION_BOUNDS,
  DOCUMENT_KEY_PATTERN,
  RFC3339_DATE_TIME_PATTERN,
  ROLE_ID_PATTERN,
  truncateCodePoints,
  codePointLength
} from "../../core/direction.js";

// ---------------------------------------------------------------------------
// Origins
// ---------------------------------------------------------------------------

/** Roles of the direction pipeline that are driven by a language model. */
export const MODEL_ORIGINS = ["analyst", "director", "casting"] as const;
export type ModelOrigin = (typeof MODEL_ORIGINS)[number];
export type EventOrigin = ModelOrigin | "user";
export const EVENT_ORIGINS: readonly EventOrigin[] = [...MODEL_ORIGINS, "user"];

export function isModelOrigin(origin: string): origin is ModelOrigin {
  return (MODEL_ORIGINS as readonly string[]).includes(origin);
}

export const ANALYSIS_FIELDS = ["genre", "intent", "audience", "baseTone", "narratorPersona", "readingProfileId"] as const;
export type AnalysisField = (typeof ANALYSIS_FIELDS)[number];

/** Bounds of the journal itself (not of a partition): keep a hostile document from growing a bible without limit. */
export const BIBLE_LIMITS = {
  roles: 200,
  traitsPerRole: 64,
  statesPerRole: 32,
  namesPerRole: 16,
  nameMaxChars: 80,
  keyMaxChars: 64,
  sourceIdsMax: 64,
  sourceIdMaxChars: 256,
  candidatesMax: 100
} as const;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const bounded = (max: number, min = 1) =>
  z.string().refine((value) => codePointLength(value) >= min && codePointLength(value) <= max, {
    message: `between ${min} and ${max} characters`
  });

const RoleId = z.string().regex(ROLE_ID_PATTERN);
/** Free key (trait name, provider id). `__proto__` is refused: keys index plain records. */
const Key = bounded(BIBLE_LIMITS.keyMaxChars).refine((value) => value !== "__proto__");
const FactValue = bounded(DIRECTION_BOUNDS.factValueMaxChars);
const SourceIds = z.array(bounded(BIBLE_LIMITS.sourceIdMaxChars)).max(BIBLE_LIMITS.sourceIdsMax);
const Names = z.array(bounded(BIBLE_LIMITS.nameMaxChars)).max(BIBLE_LIMITS.namesPerRole);
const AnalysisFieldSchema = z.enum(ANALYSIS_FIELDS);

const strict = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();

// -- Events any origin may send (subject to the reducer's authorisation) ----

const AddRole = strict({ type: z.literal("addRole"), roleId: RoleId, names: Names });
const AddTrait = strict({
  type: z.literal("addTrait"),
  roleId: RoleId,
  key: Key,
  value: FactValue,
  sourceIds: SourceIds.optional(),
  locked: z.boolean().optional()
});
const AddState = strict({
  type: z.literal("addState"),
  roleId: RoleId,
  label: bounded(DIRECTION_BOUNDS.stateMaxChars),
  fromSourceId: bounded(BIBLE_LIMITS.sourceIdMaxChars),
  untilSourceId: bounded(BIBLE_LIMITS.sourceIdMaxChars).optional()
});
const CloseState = strict({
  type: z.literal("closeState"),
  roleId: RoleId,
  label: bounded(DIRECTION_BOUNDS.stateMaxChars),
  fromSourceId: bounded(BIBLE_LIMITS.sourceIdMaxChars),
  untilSourceId: bounded(BIBLE_LIMITS.sourceIdMaxChars)
});
const SetDescriptor = strict({
  type: z.literal("setDescriptor"),
  roleId: RoleId,
  value: FactValue,
  sourceIds: SourceIds.optional(),
  locked: z.boolean().optional()
});
const AssignVoice = strict({
  type: z.literal("assignVoice"),
  roleId: RoleId,
  providerId: Key,
  voiceRef: bounded(512),
  locked: z.boolean().optional()
});
const SetAnalysis = strict({ type: z.literal("setAnalysis"), field: AnalysisFieldSchema, value: FactValue });

// -- User-only events -------------------------------------------------------

const EditTarget = z.discriminatedUnion("kind", [
  strict({ kind: z.literal("trait"), roleId: RoleId, key: Key, value: FactValue, locked: z.boolean().optional() }),
  strict({ kind: z.literal("descriptor"), roleId: RoleId, value: FactValue, locked: z.boolean().optional() }),
  strict({ kind: z.literal("names"), roleId: RoleId, names: Names }),
  strict({
    kind: z.literal("assignment"),
    roleId: RoleId,
    providerId: Key,
    voiceRef: bounded(512),
    locked: z.boolean().optional()
  }),
  strict({ kind: z.literal("analysis"), field: AnalysisFieldSchema, value: FactValue })
]);

const RetractTarget = z.discriminatedUnion("kind", [
  strict({ kind: z.literal("trait"), roleId: RoleId, key: Key }),
  strict({ kind: z.literal("descriptor"), roleId: RoleId }),
  strict({ kind: z.literal("name"), roleId: RoleId, name: bounded(BIBLE_LIMITS.nameMaxChars) }),
  strict({ kind: z.literal("assignment"), roleId: RoleId, providerId: Key }),
  strict({
    kind: z.literal("state"),
    roleId: RoleId,
    label: bounded(DIRECTION_BOUNDS.stateMaxChars),
    fromSourceId: bounded(BIBLE_LIMITS.sourceIdMaxChars)
  }),
  strict({ kind: z.literal("role"), roleId: RoleId }),
  strict({ kind: z.literal("analysis"), field: AnalysisFieldSchema })
]);

/** What a promotion copies out of a document bible: the value travels in the event, so replay needs one journal only. */
const PromoteItem = z.discriminatedUnion("kind", [
  strict({ kind: z.literal("trait"), roleId: RoleId, key: Key, value: FactValue }),
  strict({ kind: z.literal("descriptor"), roleId: RoleId, value: FactValue }),
  strict({ kind: z.literal("assignment"), roleId: RoleId, providerId: Key, voiceRef: bounded(512) }),
  strict({ kind: z.literal("names"), roleId: RoleId, names: Names })
]);

const UserEdit = strict({ type: z.literal("userEdit"), target: EditTarget });
const UserRetract = strict({ type: z.literal("userRetract"), target: RetractTarget });
/**
 * « Refaire la distribution » (panneau Distribution) : retire, pour ce moteur, les attributions
 * automatiques du document ; les choix de l'utilisateur restent. Rien n'est tombé : le calcul
 * automatique peut réattribuer aussitôt, avec les voix disponibles alors.
 */
const UserRecast = strict({ type: z.literal("userRecast"), providerId: Key });
const UserPromote = strict({
  type: z.literal("userPromote"),
  fromDocumentKey: z.string().regex(DOCUMENT_KEY_PATTERN),
  item: PromoteItem
});

export const BibleEventSchema = z.discriminatedUnion("type", [
  AddRole,
  AddTrait,
  AddState,
  CloseState,
  SetDescriptor,
  AssignVoice,
  SetAnalysis,
  UserEdit,
  UserRetract,
  UserRecast,
  UserPromote
]);

export type BibleEvent = z.infer<typeof BibleEventSchema>;
export type BibleEventType = BibleEvent["type"];
export type EditTargetOf = z.infer<typeof EditTarget>;
export type RetractTargetOf = z.infer<typeof RetractTarget>;
export type PromoteItem = z.infer<typeof PromoteItem>;

export const USER_ONLY_EVENT_TYPES: readonly BibleEventType[] = ["userEdit", "userRetract", "userRecast", "userPromote"];
export type ModelEvent = Exclude<BibleEvent, { type: "userEdit" | "userRetract" | "userRecast" | "userPromote" }>;

/** Which non-user events each model role may send. `casting` only casts voices. */
export const MODEL_EVENT_TYPES: Readonly<Record<ModelOrigin, readonly BibleEventType[]>> = {
  analyst: ["addRole", "addTrait", "addState", "closeState", "setDescriptor", "setAnalysis"],
  director: ["addRole", "addTrait", "addState", "closeState", "setDescriptor", "setAnalysis"],
  casting: ["assignVoice"]
};

// ---------------------------------------------------------------------------
// Journal lines
// ---------------------------------------------------------------------------

export const JOURNAL_VERSION = 1;
const DateTime = z.string().regex(RFC3339_DATE_TIME_PATTERN);

export const EventLineSchema = strict({
  v: z.literal(JOURNAL_VERSION),
  kind: z.literal("event"),
  seq: z.number().int().min(1),
  at: DateTime,
  origin: z.enum(["analyst", "director", "casting", "user"]),
  event: BibleEventSchema
});
export type EventLine = z.infer<typeof EventLineSchema>;

export type EventParseResult = { ok: true; event: BibleEvent } | { ok: false };

/**
 * Validates one event. A model's over-long text is brought back to the bound
 * (language models overshoot; losing the whole event for one extra word would
 * be worse), and a model cannot set `locked`: only the user locks a fact.
 * A user's over-long text is refused, never silently cut.
 */
export function parseBibleEvent(raw: unknown, origin: EventOrigin): EventParseResult {
  let candidate = raw;
  if (isModelOrigin(origin) && typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const copy: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
    if (typeof copy.value === "string") {
      copy.value = truncateCodePoints(copy.value, DIRECTION_BOUNDS.factValueMaxChars);
    }
    delete copy.locked;
    candidate = copy;
  }
  const parsed = BibleEventSchema.safeParse(candidate);
  return parsed.success ? { ok: true, event: parsed.data } : { ok: false };
}
