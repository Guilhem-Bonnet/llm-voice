/**
 * Stage director (ADR-015 §2, role 3): directs one sliding window. It hands
 * the model the window (K segments to direct) with its context (W segments
 * before, L segments after, the analysis and the effective bible), and passes
 * every answer through the `PartitionController`: violations are sent back
 * (at most `maxResends` times), then the window falls back to the neutral
 * partition (ADR-015 §9).
 *
 * - Never rejects, never blocks: a model that fails, hangs (`timeoutMs`), is
 *   cancelled, or is refused by `gate` (game mode, ADR-015 §8) yields the
 *   neutral partition with the reason.
 * - The facts a model proposes for the bible (`facts` next to `cues`) are
 *   applied only when the window was accepted, only as `director` events on
 *   the **document** scope, and only the kinds below. `setAnalysis` is left to
 *   the analyst (once per document): a director rewriting the analysis mid-way
 *   would change what earlier windows were directed against.
 * - No genre branch, no prosody rule: everything style-related is the model's.
 */

import { z } from "zod";

import type { BibleAnalysis, BoundsReport, Cue, Partition } from "../../core/direction.js";
import type { BibleStore } from "../bible/BibleStore.js";
import type { DocumentScope } from "../bible/scopes.js";
import {
  PartitionController,
  type BibleIssue,
  type ControllerBibleState,
  type ControllerOptions,
  type ControllerOutcome,
  type SourceBlock
} from "../controller/index.js";
import type { WriteTally } from "./Analyst.js";
import {
  DirectionLlmError,
  callWithDeadline,
  classifyLlmFailure,
  type DirectionDegradedReason,
  type DirectionLlm,
  type LlmBlock
} from "./llm.js";

export const DEFAULT_DIRECTOR_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_FACTS_PER_WINDOW = 20;

/** Facts a director may add to the document bible (`setAnalysis` and everything user-only are excluded). */
export const DIRECTOR_FACT_TYPES = ["addRole", "addTrait", "addState", "closeState", "setDescriptor"] as const;

const FactsEnvelope = z.object({ facts: z.array(z.unknown()).optional() });

export interface StageDirectorOptions {
  readonly llm: DirectionLlm;
  /** Where accepted facts go. Without it, facts are ignored. */
  readonly store?: BibleStore;
  readonly controller?: Omit<ControllerOptions, "faithful">;
  /** Deadline of one model call (each re-prompt gets its own). */
  readonly timeoutMs?: number;
  readonly maxFactsPerWindow?: number;
}

export interface DirectWindowInput {
  readonly documentKey: string;
  /** Scope receiving the proposed facts. */
  readonly document?: DocumentScope;
  /** The segments to direct. */
  readonly window: readonly SourceBlock[];
  readonly before: readonly SourceBlock[];
  readonly after: readonly SourceBlock[];
  readonly previousCues?: readonly Cue[];
  readonly analysis?: BibleAnalysis;
  readonly bible: ControllerBibleState;
  /** `faithful` profile: lexical equivalence required by the controller (ADR-015 §6). */
  readonly faithful?: boolean;
  /**
   * Asked before every model call, the first one and each re-prompt. A reason
   * refuses the call (`gpu-yield`, a tripped breaker…): the window is neutral.
   */
  readonly gate?: () => DirectionDegradedReason | undefined;
  readonly signal?: AbortSignal;
}

export interface DirectedWindow {
  /** True when the model's partition passed the controller; false = neutral fallback. */
  readonly directed: boolean;
  readonly partition: Partition;
  readonly degradedReason?: DirectionDegradedReason;
  /** Model calls actually issued (a gated call is not counted). */
  readonly llmCalls: number;
  readonly resends: number;
  readonly bounds?: BoundsReport;
  readonly bibleIssues: readonly BibleIssue[];
  readonly facts: WriteTally;
}

const NO_FACTS: WriteTally = { written: 0, ignored: 0 };

const textOf = (block: SourceBlock): string => block.spokenText ?? block.rawText;
const toLlm = (block: SourceBlock): LlmBlock => ({ id: block.id, text: textOf(block) });

function degradedReasonOf(outcome: Extract<ControllerOutcome, { kind: "neutral" }>, failure: DirectionDegradedReason | undefined): DirectionDegradedReason {
  switch (outcome.reason) {
    case "resend-budget-exhausted":
      return "resend-budget-exhausted";
    case "aborted":
      return "cancelled";
    case "director-failed":
      return failure ?? "provider-unavailable";
  }
}

export class StageDirector {
  private readonly llm: DirectionLlm;
  private readonly store: BibleStore | undefined;
  private readonly controllerOptions: Omit<ControllerOptions, "faithful">;
  private readonly timeoutMs: number;
  private readonly maxFacts: number;

  constructor(options: StageDirectorOptions) {
    this.llm = options.llm;
    this.store = options.store;
    this.controllerOptions = options.controller ?? {};
    this.timeoutMs = options.timeoutMs ?? DEFAULT_DIRECTOR_TIMEOUT_MS;
    this.maxFacts = options.maxFactsPerWindow ?? DEFAULT_MAX_FACTS_PER_WINDOW;
  }

  async directWindow(input: DirectWindowInput): Promise<DirectedWindow> {
    const controller = new PartitionController({ ...this.controllerOptions, faithful: input.faithful === true });
    let llmCalls = 0;
    let failure: DirectionDegradedReason | undefined;
    let lastRaw: unknown;

    const outcome = await controller.run(
      { documentKey: input.documentKey, source: input.window, bible: input.bible },
      async (request, signal) => {
        const refusal = input.gate?.();
        if (refusal !== undefined) {
          failure = refusal;
          throw new DirectionLlmError(refusal);
        }
        llmCalls += 1;
        try {
          lastRaw = await callWithDeadline(
            (inner) =>
              this.llm.direct(
                {
                  documentKey: input.documentKey,
                  attempt: request.attempt,
                  resend: request.resend,
                  ...(input.analysis !== undefined ? { analysis: input.analysis } : {}),
                  bible: input.bible.bible,
                  window: input.window.map(toLlm),
                  previous: input.before.map(toLlm),
                  previousCues: input.previousCues ?? [],
                  following: input.after.map(toLlm)
                },
                inner
              ),
            this.timeoutMs,
            signal
          );
          return lastRaw;
        } catch (error) {
          failure = classifyLlmFailure(error, signal);
          throw error;
        }
      },
      input.signal
    );

    if (outcome.kind === "neutral") {
      return {
        directed: false,
        partition: outcome.partition,
        degradedReason: degradedReasonOf(outcome, failure),
        llmCalls,
        resends: outcome.resends,
        bibleIssues: [],
        facts: NO_FACTS
      };
    }
    return {
      directed: true,
      partition: outcome.partition,
      llmCalls,
      resends: outcome.resends,
      bounds: outcome.bounds,
      bibleIssues: outcome.bibleIssues,
      facts: await this.applyFacts(input.document, lastRaw)
    };
  }

  /** Applies the facts of an accepted answer as `director` events; each is validated and bounded by the store. */
  private async applyFacts(document: DocumentScope | undefined, raw: unknown): Promise<WriteTally> {
    if (this.store === undefined || document === undefined) {
      return NO_FACTS;
    }
    const envelope = FactsEnvelope.safeParse(raw);
    if (!envelope.success) {
      return NO_FACTS;
    }
    let written = 0;
    let ignored = 0;
    for (const fact of (envelope.data.facts ?? []).slice(0, this.maxFacts)) {
      const type = typeof fact === "object" && fact !== null ? (fact as { type?: unknown }).type : undefined;
      if (typeof type !== "string" || !(DIRECTOR_FACT_TYPES as readonly string[]).includes(type)) {
        ignored += 1;
        continue;
      }
      const result = await this.store.appendModelEvent(document, "director", fact);
      if (result.status === "applied" || result.status === "candidate") {
        written += 1;
      } else {
        ignored += 1;
      }
    }
    const dropped = Math.max(0, (envelope.data.facts?.length ?? 0) - this.maxFacts);
    return { written, ignored: ignored + dropped };
  }
}
