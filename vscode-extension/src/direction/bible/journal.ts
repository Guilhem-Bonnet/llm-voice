/**
 * Journal file format and tolerant parsing (ADR-015 §4, "Stockage local").
 * One JSON object per line. Two kinds of line:
 *
 * - `event`: one journal entry (`EventLineSchema`);
 * - `checkpoint`: the whole projection at a point in time, written by an
 *   explicit compaction (retracted values are gone from the file afterwards).
 *
 * `parseJournal` never throws: a line that is not JSON, not schema-valid, too
 * long, of a checkpoint that does not match the scope, or an event a scope
 * refuses, is skipped and counted. The file is a store written by us but
 * living in a user-writable directory; it is treated as untrusted input.
 */

import { z } from "zod";

import {
  RFC3339_DATE_TIME_PATTERN,
  checkBible,
  BibleSchema,
  type Bible,
  type BibleScope
} from "../../core/direction.js";
import { BIBLE_LIMITS, EventLineSchema, JOURNAL_VERSION, type EventOrigin } from "./events.js";
import { applyEntry, initialState, type BibleState, type JournalEntry } from "./reducer.js";

export const MAX_LINE_CHARS = 64 * 1024;
export const MAX_JOURNAL_BYTES = 16 * 1024 * 1024;
const MAX_TOMBSTONES = 5000;

const CandidateSchema = z
  .object({
    seq: z.number().int().min(1),
    at: z.string().regex(RFC3339_DATE_TIME_PATTERN),
    by: z.enum(["analyst", "director", "casting", "user"]),
    roleId: z.string().nullable(),
    kind: z.enum(["trait", "descriptor", "assignment", "analysis"]),
    key: z.string().nullable(),
    value: z.string()
  })
  .strict();

const StateSchema = z
  .object({
    bible: BibleSchema,
    candidates: z.array(CandidateSchema).max(BIBLE_LIMITS.candidatesMax),
    tombstones: z.array(z.string().max(1024)).max(MAX_TOMBSTONES)
  })
  .strict();

const CheckpointLineSchema = z
  .object({
    v: z.literal(JOURNAL_VERSION),
    kind: z.literal("checkpoint"),
    seq: z.number().int().min(0),
    at: z.string().regex(RFC3339_DATE_TIME_PATTERN),
    state: StateSchema
  })
  .strict();

export interface ParsedJournal {
  readonly state: BibleState;
  readonly lastSeq: number;
  /** Lines that could not be read (kept in the file until an explicit, forced compaction). */
  readonly skippedLines: number;
  /** Well-formed events that the scope's rules refuse (replayed, ignored). */
  readonly ignoredEvents: number;
  readonly endsWithNewline: boolean;
}

export function serializeEventLine(entry: JournalEntry): string {
  return JSON.stringify({ v: JOURNAL_VERSION, kind: "event", seq: entry.seq, at: entry.at, origin: entry.origin, event: entry.event });
}

export function serializeCheckpointLine(state: BibleState, seq: number, at: string): string {
  return JSON.stringify({ v: JOURNAL_VERSION, kind: "checkpoint", seq, at, state });
}

export function parseJournal(text: string, scope: BibleScope, scopeKey: string): ParsedJournal {
  let state = initialState(scope, scopeKey);
  let lastSeq = 0;
  let skippedLines = 0;
  let ignoredEvents = 0;
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    if (line.length > MAX_LINE_CHARS) {
      skippedLines += 1;
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      skippedLines += 1;
      continue;
    }
    const kind = typeof json === "object" && json !== null ? (json as { kind?: unknown }).kind : undefined;
    if (kind === "checkpoint") {
      const parsed = CheckpointLineSchema.safeParse(json);
      const bible = parsed.success ? (parsed.data.state.bible as Bible) : undefined;
      if (!parsed.success || bible === undefined || bible.scope !== scope || checkBible(bible).length > 0) {
        skippedLines += 1;
        continue;
      }
      state = { bible, candidates: parsed.data.state.candidates as BibleState["candidates"], tombstones: parsed.data.state.tombstones };
      // The checkpoint carries the scopeKey of the day it was written; the caller's one is authoritative.
      state = { ...state, bible: { ...state.bible, scopeKey } };
      lastSeq = Math.max(lastSeq, parsed.data.seq);
      continue;
    }
    const parsed = EventLineSchema.safeParse(json);
    if (!parsed.success) {
      skippedLines += 1;
      continue;
    }
    const entry: JournalEntry = {
      seq: parsed.data.seq,
      at: parsed.data.at,
      origin: parsed.data.origin as EventOrigin,
      event: parsed.data.event
    };
    const result = applyEntry(state, entry);
    if (result.outcome.kind === "refused") {
      ignoredEvents += 1;
    }
    state = result.state;
    lastSeq = Math.max(lastSeq, entry.seq);
  }
  return { state, lastSeq, skippedLines, ignoredEvents, endsWithNewline: text.length === 0 || text.endsWith("\n") };
}
