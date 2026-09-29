/**
 * Partition controller (ADR-015 §2, role 5): pure code that stands between the
 * director's raw output and the translator. It validates the schema, brings
 * numeric values inside the safety bounds, checks that every source block is
 * covered, that the spoken text stays faithful (numbers, versions, files,
 * commands, identifiers, negations kept; no digit absent from the source), and
 * that every speaker belongs to the bible. What can be fixed by asking the
 * director again is returned as a list of source segments to send back, each
 * with a reason. After `maxResends` re-prompts the window falls back to the
 * neutral partition (ADR-015 §9): the reading is never blocked.
 *
 * No `vscode`, no network, no clock, no randomness. `run` calls an injected
 * `direct` function; the controller itself never reaches an LLM.
 *
 * Logging: `trace` and `bounds` carry counts only. `Violation.detail` quotes
 * the source (it feeds the re-prompt) and must never be logged.
 */

import {
  CUE_ID_PATTERN,
  DOCUMENT_KEY_PATTERN,
  DirectionContractError,
  PartitionSchema,
  RawDirectionOutputSchema,
  boundPartition,
  checkBible,
  checkPartition,
  codePointLength,
  neutralCue,
  DIRECTION_SCHEMA_VERSION,
  type Bible,
  type BoundsReport,
  type Partition
} from "../../core/direction.js";
import type { SourceSegmentType } from "../../core/source.js";
import {
  findInventedNumbers,
  findLexicalDifferences,
  findLostContent,
  type FidelityFinding
} from "./fidelity.js";

/** ADR-015 §7: "renvois du contrôleur ≤ 2 par fenêtre, puis consignes neutres". */
export const DEFAULT_MAX_RESENDS = 2;
/** ADR-015 §7: `spokenText` at most twice the length of its input segment (proposed, not measured). */
export const DEFAULT_MAX_LENGTH_RATIO = 2;
/**
 * Characters added to the length allowance. Not in the ADR: spelling out
 * "0.3.1" or "22 050 Hz" multiplies the length of a very short segment by
 * more than two, and the allowance is an anti-invention bound, not a style rule.
 */
export const DEFAULT_LENGTH_SLACK_CHARS = 40;

/** A segment to direct: `SourceSegment` satisfies it, a fixture can be smaller. */
export interface SourceBlock {
  readonly id: string;
  readonly rawText: string;
  /** Normalised text handed to the narrator or the engine; wins over `rawText` when present. */
  readonly spokenText?: string;
  readonly type?: SourceSegmentType;
}

/** What the controller knows of the bible for one window. */
export interface ControllerBibleState {
  /** Effective bible (ADR-015 §4). */
  readonly bible: Bible;
  /** Engine the voices are looked up for (`assignments` is keyed by provider id). */
  readonly providerId?: string;
  /** Voice each speaker actually used so far in this reading, by speaker id. */
  readonly voicesInUse?: Readonly<Record<string, string>>;
}

export type ViolationCode =
  | "schema-invalid"
  | "voice-override"
  | "duplicate-cue-id"
  | "unknown-speaker"
  | "unknown-source-id"
  | "uncovered-source"
  | "blank-text"
  | "text-too-long"
  | "number-lost"
  | "number-invented"
  | "identifier-lost"
  | "negation-lost"
  | "lexical-drop"
  | "lexical-add";

export interface Violation {
  readonly code: ViolationCode;
  /** Source segments the director must redo (never empty: falls back to the whole window). */
  readonly sourceIds: readonly string[];
  readonly cueId?: string;
  /** May quote the source: for the re-prompt only, never logged. */
  readonly detail: string;
}

/** One source segment to send back to the director, with why. */
export interface Resend {
  readonly sourceId: string;
  readonly reasons: ReadonlyArray<{ readonly code: ViolationCode; readonly detail: string }>;
}

/** A bible problem the director cannot fix by re-prompting: reported, never blocking. */
export interface BibleIssue {
  readonly code: "duplicate-role-id" | "narrator-voice-reused" | "voice-changed";
  /** Role ids and provider ids only, no content of the text. */
  readonly path: string;
  readonly message: string;
}

/** Counts only: safe to log. */
export interface VerdictTrace {
  readonly cues: number;
  readonly violations: Readonly<Partial<Record<ViolationCode, number>>>;
  readonly resendSegments: number;
  readonly boundsAdjusted: number;
}

interface VerdictBase {
  readonly bounds: BoundsReport;
  readonly bibleIssues: readonly BibleIssue[];
  readonly trace: VerdictTrace;
}

export interface AcceptedVerdict extends VerdictBase {
  readonly accepted: true;
  /** Validated and bounded. */
  readonly partition: Partition;
  readonly violations: readonly [];
  readonly resend: readonly [];
}

export interface RejectedVerdict extends VerdictBase {
  readonly accepted: false;
  readonly violations: readonly Violation[];
  readonly resend: readonly Resend[];
}

export type ControllerVerdict = AcceptedVerdict | RejectedVerdict;

export interface ControllerOptions {
  /** Re-prompts allowed per window before the neutral fallback (default 2). */
  readonly maxResends?: number;
  readonly maxLengthRatio?: number;
  readonly lengthSlackChars?: number;
  /**
   * `faithful` profile (ADR-015 §6): lexical equivalence with the source,
   * modulo the spoken form of numbers, symbols and units.
   */
  readonly faithful?: boolean;
}

export interface ControllerInput {
  /** 64 lowercase hex characters (`partition.schema.json`). */
  readonly documentKey: string;
  /** Segments to direct in this window, in reading order. */
  readonly source: readonly SourceBlock[];
  /** Raw director output, as parsed from the LLM's JSON. */
  readonly raw: unknown;
  readonly bible: ControllerBibleState;
}

export interface DirectRequest {
  /** 0 for the first call, then 1..maxResends. */
  readonly attempt: number;
  /** What the previous answer got wrong; empty on the first call. */
  readonly resend: readonly Resend[];
}

/** The director, injected: returns the parsed raw output. Rejecting means "failed". */
export type DirectFn = (request: DirectRequest, signal?: AbortSignal) => Promise<unknown>;

export type NeutralReason = "resend-budget-exhausted" | "director-failed" | "aborted";

export interface AcceptedOutcome {
  readonly kind: "accepted";
  readonly partition: Partition;
  /** Director calls made (0 when the window had nothing to direct). */
  readonly attempts: number;
  readonly resends: number;
  readonly bounds: BoundsReport;
  readonly bibleIssues: readonly BibleIssue[];
}

export interface NeutralOutcome {
  readonly kind: "neutral";
  /** One neutral cue per source segment (ADR-015 §9). */
  readonly partition: Partition;
  readonly reason: NeutralReason;
  readonly attempts: number;
  readonly resends: number;
  /** Codes of the last rejected answer, empty when the director failed. */
  readonly lastViolationCodes: readonly ViolationCode[];
}

export type ControllerOutcome = AcceptedOutcome | NeutralOutcome;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textOf(block: SourceBlock): string {
  return block.spokenText ?? block.rawText;
}

/** Indirection so an abort that flips during an `await` is not narrowed away. */
function wasAborted(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && signal.aborted;
}

function isBlank(block: SourceBlock): boolean {
  return textOf(block).trim().length === 0;
}

/** Keys with which the director would pick an engine or a voice: forbidden (ADR-015 §5.1). */
const ENGINE_KEY = /voice|exaggeration|cfg|speed|temperature|model|engine/i;

function cuesWithEngineKeys(raw: unknown): Set<number> {
  const flagged = new Set<number>();
  if (typeof raw !== "object" || raw === null) {
    return flagged;
  }
  const cues = (raw as { cues?: unknown }).cues;
  if (!Array.isArray(cues)) {
    return flagged;
  }
  cues.forEach((cue: unknown, index) => {
    if (typeof cue === "object" && cue !== null && Object.keys(cue).some((key) => ENGINE_KEY.test(key))) {
      flagged.add(index);
    }
  });
  return flagged;
}

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
 * The neutral partition of a window (ADR-015 §9): one neutral cue per
 * non-blank source segment, narrator voice, the segment's own text. It is what
 * the pipeline would read without direction, and it always passes `check`.
 */
export function neutralPartitionForSource(
  source: readonly SourceBlock[],
  meta: { readonly documentKey: string; readonly bibleRevision: number }
): Partition {
  const readable = source.filter((block) => !isBlank(block));
  const ids = cueIdsFor(readable.map((block) => block.id));
  return {
    schemaVersion: DIRECTION_SCHEMA_VERSION,
    documentKey: meta.documentKey,
    bibleRevision: meta.bibleRevision,
    cues: readable.map((block, index) =>
      neutralCue({ cueId: ids[index] ?? `cue-${index + 1}`, sourceIds: [block.id], spokenText: textOf(block) })
    )
  };
}

function bibleIssuesOf(state: ControllerBibleState, usedSpeakers: ReadonlySet<string>): BibleIssue[] {
  const issues: BibleIssue[] = checkBible(state.bible).map((issue) => ({
    code: issue.code === "duplicate-role-id" ? "duplicate-role-id" : "narrator-voice-reused",
    path: issue.path,
    message: issue.message
  }));
  const { providerId, voicesInUse } = state;
  if (providerId !== undefined && voicesInUse !== undefined) {
    for (const role of [state.bible.narrator, ...state.bible.characters]) {
      const before = voicesInUse[role.id];
      if (before === undefined || !usedSpeakers.has(role.id)) {
        continue;
      }
      if (role.voice.assignments?.[providerId]?.voiceRef !== before) {
        issues.push({
          code: "voice-changed",
          path: `roles.${role.id}.voice.assignments.${providerId}`,
          message: "the voice assigned to this speaker is not the one already used in this reading"
        });
      }
    }
  }
  return issues;
}

function summarise(violations: readonly Violation[], resend: readonly Resend[], cues: number, bounds: BoundsReport): VerdictTrace {
  const counts: Partial<Record<ViolationCode, number>> = {};
  for (const violation of violations) {
    counts[violation.code] = (counts[violation.code] ?? 0) + 1;
  }
  return { cues, violations: counts, resendSegments: resend.length, boundsAdjusted: bounds.total };
}

const NO_BOUNDS: BoundsReport = { total: 0, byField: {} };

// ---------------------------------------------------------------------------
// The controller
// ---------------------------------------------------------------------------

export class PartitionController {
  private readonly maxResends: number;
  private readonly maxLengthRatio: number;
  private readonly lengthSlackChars: number;
  private readonly faithful: boolean;

  constructor(options: ControllerOptions = {}) {
    const maxResends = options.maxResends ?? DEFAULT_MAX_RESENDS;
    if (!Number.isInteger(maxResends) || maxResends < 0) {
      throw new DirectionContractError("maxResends must be a non-negative integer");
    }
    this.maxResends = maxResends;
    this.maxLengthRatio = options.maxLengthRatio ?? DEFAULT_MAX_LENGTH_RATIO;
    this.lengthSlackChars = options.lengthSlackChars ?? DEFAULT_LENGTH_SLACK_CHARS;
    this.faithful = options.faithful === true;
  }

  /**
   * One verdict on one director answer. Total on any `raw` (a string, `null`,
   * a partition with wild values): it never throws for content the director
   * produced. It throws `DirectionContractError` only for a caller mistake
   * (a malformed `documentKey`).
   */
  check(input: ControllerInput): ControllerVerdict {
    if (!DOCUMENT_KEY_PATTERN.test(input.documentKey)) {
      throw new DirectionContractError("documentKey must be 64 lowercase hexadecimal characters");
    }
    const blocks = new Map(input.source.map((block) => [block.id, block] as const));
    const required = input.source.filter((block) => !isBlank(block));
    const requiredIds = required.map((block) => block.id);
    const requiredSet = new Set(requiredIds);
    const violations: Violation[] = [];
    const add = (code: ViolationCode, ids: readonly string[], detail: string, cueId?: string): void => {
      const targets = ids.filter((id) => requiredSet.has(id));
      violations.push({
        code,
        sourceIds: targets.length > 0 ? targets : requiredIds,
        detail,
        ...(cueId !== undefined ? { cueId } : {})
      });
    };
    const reject = (bounds: BoundsReport, bibleIssues: readonly BibleIssue[], cues: number): RejectedVerdict => {
      const resend = this.buildResend(violations, requiredIds);
      return { accepted: false, violations, resend, bounds, bibleIssues, trace: summarise(violations, resend, cues, bounds) };
    };

    // 1. Schema: the raw output, then the bounded partition.
    const parsed = RawDirectionOutputSchema.safeParse(input.raw);
    if (!parsed.success) {
      const paths = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "(root)"))].slice(0, 5);
      add("schema-invalid", requiredIds, `the answer does not match the partition format (at: ${paths.join(", ")})`);
      return reject(NO_BOUNDS, bibleIssuesOf(input.bible, new Set()), 0);
    }
    const { partition, report } = boundPartition(parsed.data, {
      documentKey: input.documentKey,
      bibleRevision: input.bible.bible.revision
    });
    const validated = PartitionSchema.safeParse(partition);
    if (!validated.success) {
      add("schema-invalid", requiredIds, "the bounded partition does not match the partition schema");
      return reject(report, bibleIssuesOf(input.bible, new Set()), partition.cues.length);
    }
    const cues = partition.cues;

    // 2. Ids and speakers (rules JSON Schema cannot express), and forbidden engine keys.
    for (const issue of checkPartition(partition, input.bible.bible)) {
      const index = Number(/^cues\.(\d+)\./.exec(issue.path)?.[1]);
      const cue = cues[index];
      if (cue !== undefined) {
        add(issue.code === "duplicate-cue-id" ? "duplicate-cue-id" : "unknown-speaker", cue.sourceIds, issue.message, cue.cueId);
      }
    }
    for (const index of cuesWithEngineKeys(input.raw)) {
      const cue = cues[index];
      if (cue !== undefined) {
        add("voice-override", cue.sourceIds, "the director must not choose a voice or an engine setting", cue.cueId);
      }
    }

    // 3. Per cue: known source ids, blank text, length, digits absent from the source.
    for (const cue of cues) {
      const covered = cue.sourceIds.map((id) => blocks.get(id));
      const unknown = cue.sourceIds.filter((id) => !blocks.has(id));
      if (unknown.length > 0) {
        add("unknown-source-id", cue.sourceIds, `the cue names ${unknown.length} segment(s) that are not in this window`, cue.cueId);
      }
      if (cue.spokenText.trim().length === 0) {
        add("blank-text", cue.sourceIds, "the spoken text is blank", cue.cueId);
        continue;
      }
      const known = covered.filter((block): block is SourceBlock => block !== undefined);
      const referenceLength = known.reduce((sum, block) => sum + codePointLength(textOf(block)), 0);
      if (
        known.length > 0 &&
        codePointLength(cue.spokenText) > this.maxLengthRatio * referenceLength + this.lengthSlackChars
      ) {
        add("text-too-long", cue.sourceIds, `the spoken text is more than ${this.maxLengthRatio} times the length of its segment(s)`, cue.cueId);
      }
      if (known.length > 0) {
        const references = known.flatMap((block) => [textOf(block), block.rawText]);
        this.addFindings(add, findInventedNumbers(references, cue.spokenText), cue.sourceIds, cue.cueId);
      }
    }

    // 4. Coverage and fidelity per segment (a segment may be split in several cues).
    for (const block of required) {
      const covering = cues.filter((cue) => cue.sourceIds.includes(block.id));
      if (covering.length === 0) {
        add("uncovered-source", [block.id], "no cue covers this segment");
        continue;
      }
      if (block.type === "code") {
        continue;
      }
      const spoken = covering.map((cue) => cue.spokenText).join(" ");
      const reference = textOf(block);
      this.addFindings(add, findLostContent(reference, spoken), [block.id]);
      if (this.faithful) {
        this.addFindings(add, findLexicalDifferences(reference, spoken), [block.id]);
      }
    }

    // 5. Bible coherence that a re-prompt cannot fix is reported, not blocking.
    const bibleIssues = bibleIssuesOf(input.bible, new Set(cues.map((cue) => cue.speakerId)));
    if (violations.length > 0) {
      return reject(report, bibleIssues, cues.length);
    }
    return {
      accepted: true,
      partition,
      violations: [],
      resend: [],
      bounds: report,
      bibleIssues,
      trace: summarise([], [], cues.length, report)
    };
  }

  /**
   * The policy of ADR-015 §2 and §7: call the director, check, send the
   * offending segments back, at most `maxResends` times, then fall back to the
   * neutral partition of the window. Never rejects for a director failure and
   * never waits on anything else than `direct` itself (cancel it with `signal`).
   */
  async run(
    input: Omit<ControllerInput, "raw">,
    direct: DirectFn,
    signal?: AbortSignal
  ): Promise<ControllerOutcome> {
    const meta = { documentKey: input.documentKey, bibleRevision: input.bible.bible.revision };
    if (!DOCUMENT_KEY_PATTERN.test(input.documentKey)) {
      throw new DirectionContractError("documentKey must be 64 lowercase hexadecimal characters");
    }
    if (input.source.every(isBlank)) {
      return {
        kind: "accepted",
        partition: neutralPartitionForSource(input.source, meta),
        attempts: 0,
        resends: 0,
        bounds: NO_BOUNDS,
        bibleIssues: bibleIssuesOf(input.bible, new Set())
      };
    }
    const neutral = (reason: NeutralReason, attempts: number, last: readonly ViolationCode[]): NeutralOutcome => ({
      kind: "neutral",
      partition: neutralPartitionForSource(input.source, meta),
      reason,
      attempts,
      resends: Math.max(0, attempts - 1),
      lastViolationCodes: last
    });
    let resend: readonly Resend[] = [];
    let lastCodes: readonly ViolationCode[] = [];
    for (let attempt = 0; attempt <= this.maxResends; attempt += 1) {
      if (wasAborted(signal)) {
        return neutral("aborted", attempt, lastCodes);
      }
      let raw: unknown;
      try {
        raw = await direct({ attempt, resend }, signal);
      } catch {
        return neutral(wasAborted(signal) ? "aborted" : "director-failed", attempt + 1, lastCodes);
      }
      const verdict = this.check({ ...input, raw });
      if (verdict.accepted) {
        return {
          kind: "accepted",
          partition: verdict.partition,
          attempts: attempt + 1,
          resends: attempt,
          bounds: verdict.bounds,
          bibleIssues: verdict.bibleIssues
        };
      }
      resend = verdict.resend;
      lastCodes = [...new Set(verdict.violations.map((violation) => violation.code))];
    }
    return neutral("resend-budget-exhausted", this.maxResends + 1, lastCodes);
  }

  private addFindings(
    add: (code: ViolationCode, ids: readonly string[], detail: string, cueId?: string) => void,
    findings: readonly FidelityFinding[],
    ids: readonly string[],
    cueId?: string
  ): void {
    for (const finding of findings) {
      add(finding.kind, ids, finding.detail, cueId);
    }
  }

  private buildResend(violations: readonly Violation[], requiredIds: readonly string[]): Resend[] {
    const bySegment = new Map<string, Array<{ code: ViolationCode; detail: string }>>();
    for (const violation of violations) {
      for (const id of violation.sourceIds) {
        const reasons = bySegment.get(id) ?? [];
        if (!reasons.some((reason) => reason.code === violation.code && reason.detail === violation.detail)) {
          reasons.push({ code: violation.code, detail: violation.detail });
        }
        bySegment.set(id, reasons);
      }
    }
    return requiredIds.flatMap((id) => {
      const reasons = bySegment.get(id);
      return reasons === undefined ? [] : [{ sourceId: id, reasons }];
    });
  }
}
