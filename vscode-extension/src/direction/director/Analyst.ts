/**
 * Analyst (ADR-015 §2, role 1): one language-model pass per document that
 * yields the analysis (genre, intent, audience, base tone, narrator persona,
 * reading profile) and the initial cast (character sheets). What it learns is
 * written into the bible with origin `analyst`, **in the document scope only**
 * (ADR-015 §4, "Portées, droit d'écriture et précédence"): the parameter is a
 * `DocumentScope`, and the store refuses any model event elsewhere anyway.
 *
 * - Once per document: a document whose bible already carries an analysis is
 *   not analysed again (`status: "cached"`), and two concurrent calls for the
 *   same document share one model call.
 * - A text longer than the input budget is analysed chapter by chapter; each
 *   chapter sees the effective bible, which is the memory between chapters.
 * - Never rejects: any failure becomes `status: "degraded"` with a reason and
 *   nothing written (the neutral analysis: narrator alone, profile tone).
 * - No genre branch: the genre is data the model returns and the bible stores.
 */

import { z } from "zod";

import {
  NARRATOR_SPEAKER_ID,
  ROLE_ID_PATTERN,
  truncateCodePoints,
  type BibleAnalysis
} from "../../core/direction.js";
import { ANALYSIS_FIELDS, type ModelOrigin } from "../bible/events.js";
import type { BibleStore } from "../bible/BibleStore.js";
import type { DocumentScope, PersistentScopeRef } from "../bible/scopes.js";
import type { SourceBlock } from "../controller/index.js";
import {
  DirectionLlmError,
  callWithDeadline,
  classifyLlmFailure,
  type DirectionDegradedReason,
  type DirectionLlm,
  type LlmBlock
} from "./llm.js";

/** Characters of text per model call before a document is cut into chapters. Not measured (the real `num_ctx` is unverified, ADR-015 §8). */
export const DEFAULT_ANALYSIS_INPUT_CHARS = 16_000;
/** Chapters analysed per document; the rest is left to the director's facts. */
export const DEFAULT_ANALYSIS_MAX_CHUNKS = 8;
export const DEFAULT_ANALYSIS_TIMEOUT_MS = 30_000;

const AnalysisFieldsSchema = z.object({
  genre: z.string().optional(),
  intent: z.string().optional(),
  audience: z.string().optional(),
  baseTone: z.string().optional(),
  narratorPersona: z.string().optional(),
  readingProfileId: z.string().optional()
});

/** Lenient, like the director's raw schema: unknown keys are dropped, values are bounded by the bible afterwards. */
export const RawAnalysisSchema = z.object({
  analysis: AnalysisFieldsSchema.optional(),
  characters: z
    .array(
      z.object({
        id: z.string().optional(),
        names: z.array(z.string()).optional(),
        traits: z.record(z.string(), z.string()).optional(),
        voiceDescriptor: z.string().optional()
      })
    )
    .optional()
});

export type RawAnalysis = z.infer<typeof RawAnalysisSchema>;

export interface AnalystOptions {
  readonly llm: DirectionLlm;
  readonly store: BibleStore;
  readonly timeoutMs?: number;
  readonly maxInputChars?: number;
  readonly maxChunks?: number;
}

export interface AnalysisInput {
  readonly document: DocumentScope;
  readonly series?: PersistentScopeRef;
  readonly source: readonly SourceBlock[];
  readonly signal?: AbortSignal;
}

export interface WriteTally {
  /** Events the bible accepted (`applied` or `candidate`). */
  readonly written: number;
  /** Events already in the bible (no-op) or refused. */
  readonly ignored: number;
}

export interface AnalysisOutcome {
  /** `cached`: the document already had its analysis, no model call. */
  readonly status: "analyzed" | "cached" | "degraded";
  readonly degradedReason?: DirectionDegradedReason;
  /** Model calls made (0 when cached). */
  readonly calls: number;
  readonly chunks: number;
  readonly characters: number;
  readonly tally: WriteTally;
  readonly analysis?: BibleAnalysis;
}

const NO_TALLY: WriteTally = { written: 0, ignored: 0 };

function slugOf(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** `Anna Karénine` -> `anna-karenine`; `undefined` when nothing usable is left or the id is the narrator's. */
export function toRoleId(raw: string): string | undefined {
  const slug = slugOf(raw);
  return slug.length > 0 && ROLE_ID_PATTERN.test(slug) && slug !== NARRATOR_SPEAKER_ID ? slug : undefined;
}

function textOf(block: SourceBlock): string {
  return block.spokenText ?? block.rawText;
}

/** Cuts the readable blocks into consecutive chapters of at most `maxChars` (a longer block is alone and truncated). */
export function chunkBlocks(blocks: readonly LlmBlock[], maxChars: number, maxChunks: number): LlmBlock[][] {
  const chunks: LlmBlock[][] = [];
  let current: LlmBlock[] = [];
  let size = 0;
  for (const block of blocks) {
    const text = truncateCodePoints(block.text, maxChars);
    const length = Array.from(text).length;
    if (current.length > 0 && size + length > maxChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push({ id: block.id, text });
    size += length;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks.slice(0, maxChunks);
}

const hasAnalysis = (analysis: BibleAnalysis | undefined): boolean =>
  analysis !== undefined && Object.values(analysis).some((value) => typeof value === "string" && value.length > 0);

export class Analyst {
  private readonly llm: DirectionLlm;
  private readonly store: BibleStore;
  private readonly timeoutMs: number;
  private readonly maxInputChars: number;
  private readonly maxChunks: number;
  private readonly inFlight = new Map<string, Promise<AnalysisOutcome>>();

  constructor(options: AnalystOptions) {
    this.llm = options.llm;
    this.store = options.store;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_ANALYSIS_TIMEOUT_MS;
    this.maxInputChars = options.maxInputChars ?? DEFAULT_ANALYSIS_INPUT_CHARS;
    this.maxChunks = options.maxChunks ?? DEFAULT_ANALYSIS_MAX_CHUNKS;
  }

  /** Analyses the document unless it already has an analysis. Never rejects. */
  analyze(input: AnalysisInput): Promise<AnalysisOutcome> {
    const key = input.document.documentKey;
    const running = this.inFlight.get(key);
    if (running !== undefined) {
      return running;
    }
    const promise = this.run(input)
      .catch((error: unknown): AnalysisOutcome => this.degraded(classifyLlmFailure(error, input.signal), 0, 0, NO_TALLY))
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, promise);
    return promise;
  }

  private async run(input: AnalysisInput): Promise<AnalysisOutcome> {
    const existing = (await this.store.effective(input.document, input.series)).analysis;
    if (hasAnalysis(existing)) {
      return { status: "cached", calls: 0, chunks: 0, characters: 0, tally: NO_TALLY, ...(existing !== undefined ? { analysis: existing } : {}) };
    }
    const blocks = input.source
      .filter((block) => textOf(block).trim().length > 0)
      .map((block) => ({ id: block.id, text: textOf(block) }));
    const chunks = chunkBlocks(blocks, this.maxInputChars, this.maxChunks);
    if (chunks.length === 0) {
      // Nothing to read, nothing to analyse.
      return { status: "analyzed", calls: 0, chunks: 0, characters: 0, tally: NO_TALLY };
    }

    let calls = 0;
    let characters = 0;
    let written = 0;
    let ignored = 0;
    let firstFailure: DirectionDegradedReason | undefined;
    for (const [chunkIndex, chunk] of chunks.entries()) {
      const bible = await this.store.effective(input.document, input.series);
      calls += 1;
      let parsed: RawAnalysis;
      try {
        const raw = await callWithDeadline(
          (signal) =>
            this.llm.analyze(
              { documentKey: input.document.documentKey, chunkIndex, chunkCount: chunks.length, blocks: chunk, bible },
              signal
            ),
          this.timeoutMs,
          input.signal
        );
        const result = RawAnalysisSchema.safeParse(raw);
        if (!result.success) {
          throw new DirectionLlmError("invalid-structured-output");
        }
        parsed = result.data;
      } catch (error) {
        firstFailure ??= classifyLlmFailure(error, input.signal);
        if (firstFailure === "cancelled" || firstFailure === "egress-denied") {
          break;
        }
        continue;
      }
      const tally = await this.write(input.document, parsed, chunkIndex === 0);
      written += tally.tally.written;
      ignored += tally.tally.ignored;
      characters += tally.characters;
    }

    const after = (await this.store.effective(input.document, input.series)).analysis;
    if (written === 0 && firstFailure !== undefined) {
      return this.degraded(firstFailure, calls, chunks.length, { written, ignored });
    }
    return {
      status: "analyzed",
      calls,
      chunks: chunks.length,
      characters,
      tally: { written, ignored },
      ...(after !== undefined ? { analysis: after } : {})
    };
  }

  private degraded(reason: DirectionDegradedReason, calls: number, chunks: number, tally: WriteTally): AnalysisOutcome {
    return { status: "degraded", degradedReason: reason, calls, chunks, characters: 0, tally };
  }

  /** Turns one parsed answer into `analyst` events on the document bible; the store bounds and validates each one. */
  private async write(
    document: DocumentScope,
    parsed: RawAnalysis,
    withAnalysis: boolean
  ): Promise<{ tally: WriteTally; characters: number }> {
    const events: unknown[] = [];
    if (withAnalysis) {
      for (const field of ANALYSIS_FIELDS) {
        const value = parsed.analysis?.[field]?.trim();
        if (value !== undefined && value.length > 0) {
          events.push({ type: "setAnalysis", field, value });
        }
      }
    }
    let characters = 0;
    const seen = new Set<string>();
    for (const sheet of parsed.characters ?? []) {
      const names = (sheet.names ?? []).map((name) => name.trim()).filter((name) => name.length > 0);
      if (sheet.id !== undefined && slugOf(sheet.id) === NARRATOR_SPEAKER_ID) {
        // The narrator is a role of its own (`analysis.narratorPersona`), never a character sheet.
        continue;
      }
      const roleId = toRoleId(sheet.id ?? "") ?? toRoleId(names[0] ?? "");
      if (roleId === undefined || seen.has(roleId)) {
        continue;
      }
      seen.add(roleId);
      characters += 1;
      events.push({ type: "addRole", roleId, names });
      for (const [key, value] of Object.entries(sheet.traits ?? {})) {
        if (key.trim().length > 0 && value.trim().length > 0) {
          events.push({ type: "addTrait", roleId, key: key.trim(), value: value.trim() });
        }
      }
      const descriptor = sheet.voiceDescriptor?.trim();
      if (descriptor !== undefined && descriptor.length > 0) {
        events.push({ type: "setDescriptor", roleId, value: descriptor });
      }
    }
    let written = 0;
    let ignored = 0;
    for (const event of events) {
      const result = await this.store.appendModelEvent(document, "analyst" satisfies ModelOrigin, event);
      if (result.status === "applied" || result.status === "candidate") {
        written += 1;
      } else {
        ignored += 1;
      }
    }
    return { tally: { written, ignored }, characters };
  }
}
