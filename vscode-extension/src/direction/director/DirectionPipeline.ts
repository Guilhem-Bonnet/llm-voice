/**
 * Direction pipeline (ADR-015 §8): keeps the director N segments ahead of the
 * reading, caches each directed window, and never makes the reading wait.
 *
 * The consumer (the playback pipeline, a later card) asks `cuesFor(segmentId)`
 * just before it synthesises a segment and gets either the directed cues or
 * the neutral cue (ADR-015 §9), within a bounded wait:
 *
 * - **Windows** of `K` consecutive readable segments, directed one at a time
 *   (one model call in flight: Ollama and the TTS engine share the GPU), in
 *   reading order, `N` segments ahead of the last one asked for.
 * - **Cache** by window (`PartitionCache`): re-reading a document, or reading
 *   a partition prepared earlier, makes no model call. Neutral fallbacks are
 *   never cached.
 * - **Wait budgets**: `firstSoundBudgetMs` for the first request of a session
 *   (analysis then first window, in series), `steadyBudgetMs` afterwards
 *   (ADR-015 §7, 1.5 s proposed, not measured). Past the budget the segment is
 *   read neutrally (`late`) while the window keeps computing in the
 *   background; a window already found late is not waited for again.
 * - **Game mode** (`gpu-yield` flag, checked before every model call): no
 *   model call at all; cached partitions are still played, otherwise the
 *   reading is neutral (`gpu-yield`); nothing waits for the flag to be
 *   lifted, and the next window not yet asked for is directed again once it is.
 * - **Breaker**: a refusal by `EgressGuard` suspends direction for the rest of
 *   the session at once; `maxConsecutiveFailures` neutral windows in a row for
 *   a model reason do the same. A suspended session is neutral and instant.
 *
 * No `vscode`, no `fetch`, no player: nothing here can start a reading
 * (invariant P0 n°1). Trace events carry counts and codes only, never text.
 */

import type { Bible, BibleAnalysis, Cue, Partition } from "../../core/direction.js";
import type { BibleStore } from "../bible/BibleStore.js";
import type { DocumentScope, PersistentScopeRef } from "../bible/scopes.js";
import { neutralPartitionForSource, type SourceBlock } from "../controller/index.js";
import type { Analyst } from "./Analyst.js";
import { createGpuYieldProbe, type GpuYieldProbe } from "./gpuYield.js";
import { classifyLlmFailure, type DirectionDegradedReason, type DirectionLlm } from "./llm.js";
import { PartitionCache, cacheBibleStamp, windowCacheKey } from "./PartitionCache.js";
import type { StageDirector } from "./StageDirector.js";

/** ADR-015 §8: K, W, L, N proposed, not measured (bench of card 6 fixes them). */
export const DEFAULT_WINDOW_SIZE = 4;
export const DEFAULT_CONTEXT_BEFORE = 6;
export const DEFAULT_CONTEXT_AFTER = 4;
export const DEFAULT_LOOKAHEAD = 8;
/** ADR-015 §7: 1.5 s in steady state, proposed, not measured. */
export const DEFAULT_STEADY_BUDGET_MS = 1500;
/** Not in the ADR (it says "plusieurs secondes, non mesuré"): chosen here, to be set by the measurements of card 5b/6. */
export const DEFAULT_FIRST_SOUND_BUDGET_MS = 10_000;
export const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3;
/**
 * Start-up (measured, `direction-eval/latency-diagnosis.md`): the model needs ~14 s
 * for the analysis and a first window of two segments, far more than the time
 * to first sound. The first `DEFAULT_LEAD_SEGMENTS` segments are read
 * neutrally at once, the first directed window is short, and the following
 * ones have the normal size.
 */
export const DEFAULT_LEAD_SEGMENTS = 2;
/**
 * Start-up wait (ms) before a segment of a window still pending is read
 * neutrally: enough for a partition already in the cache to come back from
 * disk (a re-read is directed from its first window), imperceptible otherwise.
 * A first measure with a zero wait read a fully cached document neutrally.
 */
export const DEFAULT_STARTUP_GRACE_MS = 150;
export const DEFAULT_FIRST_WINDOW_SIZE = 2;

export type DirectionTraceEvent =
  | { readonly type: "analysis"; readonly status: "analyzed" | "cached" | "degraded"; readonly degradedReason?: DirectionDegradedReason; readonly calls: number; readonly written: number }
  | {
      readonly type: "window";
      readonly window: number;
      readonly segments: number;
      readonly source: "llm" | "cache" | "neutral";
      readonly degradedReason?: DirectionDegradedReason;
      readonly llmCalls: number;
      readonly resends: number;
      readonly boundsAdjusted: number;
      readonly facts: number;
    }
  | { readonly type: "late"; readonly window: number }
  | { readonly type: "warmup"; readonly ok: boolean; readonly degradedReason?: DirectionDegradedReason }
  | { readonly type: "suspended"; readonly reason: DirectionDegradedReason };

export interface DirectionPipelineOptions {
  readonly analyst: Analyst;
  readonly director: StageDirector;
  readonly store: BibleStore;
  readonly cache: PartitionCache;
  /** `model` and `promptVersion` are the cache key; `warmup` (optional) preloads the model when a reading is opened. */
  readonly llm: Pick<DirectionLlm, "model" | "promptVersion" | "warmup">;
  /** Preload the model when a reading is opened (default true; needs `llm.warmup`). Skipped in game mode. */
  readonly warmup?: boolean;
  /**
   * Segments at the start of the document read neutrally without any wait and
   * never directed, while the analysis and the first window are computed
   * (default 2, from the measured time to the first directed window; 0 gives the historical layout: windows from the first
   * segment, the first request waits up to `firstSoundBudgetMs`).
   */
  readonly leadSegments?: number;
  /** Size of the first directed window (default 2); the next ones have `windowSize`. */
  readonly firstWindowSize?: number;
  /** See `DEFAULT_STARTUP_GRACE_MS`. */
  readonly startupGraceMs?: number;
  /** Defaults to the real `$XDG_RUNTIME_DIR/gpu-yield/active` probe. */
  readonly gpuYield?: GpuYieldProbe;
  readonly windowSize?: number;
  readonly contextBefore?: number;
  readonly contextAfter?: number;
  readonly lookahead?: number;
  readonly firstSoundBudgetMs?: number;
  readonly steadyBudgetMs?: number;
  readonly maxConsecutiveFailures?: number;
  readonly trace?: (event: DirectionTraceEvent) => void;
}

export interface OpenParams {
  readonly document: DocumentScope;
  readonly series?: PersistentScopeRef;
  /** Segments in reading order; blank ones are skipped (no cue). */
  readonly source: readonly SourceBlock[];
  readonly profileId: string;
  /** `faithful` profile: lexical equivalence required (ADR-015 §6). */
  readonly faithful?: boolean;
  /** Engine the voices are looked up for (`assignments` are keyed by provider id). */
  readonly providerId?: string;
}

export type CueSource = "llm" | "cache" | "neutral";

/** What to read for one source segment. `cues` is empty when a cue that covers several segments was already handed out. */
export interface SegmentDirection {
  readonly segmentId: string;
  readonly cues: readonly Cue[];
  /** True when the cues come from a directed partition (model or cache). */
  readonly directed: boolean;
  readonly source: CueSource;
  readonly degradedReason?: DirectionDegradedReason;
}

export interface SessionStats {
  readonly windowsFromModel: number;
  readonly windowsFromCache: number;
  readonly windowsNeutral: number;
  readonly neutralByReason: Readonly<Partial<Record<DirectionDegradedReason, number>>>;
  readonly llmCalls: number;
  readonly lateSegments: number;
  readonly suspended?: DirectionDegradedReason;
}

interface WindowResult {
  readonly partition: Partition;
  readonly source: CueSource;
  readonly degradedReason?: DirectionDegradedReason;
  /** Not memoised: game mode ends, the window is directed when it is asked for again. */
  readonly transient: boolean;
}

type Waited<T> = { readonly value: T } | { readonly late: true } | { readonly cancelled: true };

function waitFor<T>(promise: Promise<T>, budgetMs: number, signal: AbortSignal | undefined): Promise<Waited<T>> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const done = (value: Waited<T>): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      if (onAbort !== undefined) {
        signal?.removeEventListener("abort", onAbort);
      }
      resolve(value);
    };
    if (signal?.aborted === true) {
      done({ cancelled: true });
      return;
    }
    onAbort = () => done({ cancelled: true });
    signal?.addEventListener("abort", onAbort, { once: true });
    void promise.then((value) => done({ value }));
    if (budgetMs > 0) {
      timer = setTimeout(() => done({ late: true }), budgetMs);
    } else {
      void Promise.resolve().then(() => done({ late: true }));
    }
  });
}

export class DirectionPipeline {
  constructor(readonly options: DirectionPipelineOptions) {}

  /**
   * Opens a reading session. Until `cuesFor` is called there is no analysis, no
   * window, no timer; the only thing done here is the model preload
   * (`llm.warmup`, never waited for, never in game mode).
   */
  open(params: OpenParams): DirectionSession {
    const session = new DirectionSession(this.options, params);
    session.warmUp();
    return session;
  }
}

export class DirectionSession {
  private readonly blocks: SourceBlock[];
  private readonly indexOf = new Map<string, number>();
  private readonly windowSize: number;
  private readonly lead: number;
  private readonly firstSize: number;
  private readonly before: number;
  private readonly after: number;
  private readonly lookahead: number;
  private readonly firstBudget: number;
  private readonly steadyBudget: number;
  private readonly startupGrace: number;
  private readonly maxFailures: number;
  private readonly gpuYield: GpuYieldProbe;

  private readonly slots = new Map<number, Promise<WindowResult>>();
  private readonly resolved = new Map<number, WindowResult>();
  private readonly late = new Set<number>();
  private readonly handedOut = new Set<string>();
  private readonly abort = new AbortController();
  private chain: Promise<unknown> = Promise.resolve();
  private analysis: Promise<void> | undefined;
  private failures = 0;
  private suspendedReason: DirectionDegradedReason | undefined;
  private asked = false;
  /** A directed window (any outcome) has settled: the start-up is over. */
  private warm = false;
  private lateSegments = 0;
  private llmCalls = 0;
  private fromModel = 0;
  private fromCache = 0;
  private neutralWindows = 0;
  private readonly neutralByReason: Partial<Record<DirectionDegradedReason, number>> = {};

  constructor(
    private readonly options: DirectionPipelineOptions,
    private readonly params: OpenParams
  ) {
    this.blocks = params.source.filter((block) => (block.spokenText ?? block.rawText).trim().length > 0);
    this.blocks.forEach((block, index) => this.indexOf.set(block.id, index));
    this.windowSize = Math.max(1, options.windowSize ?? DEFAULT_WINDOW_SIZE);
    this.firstSize = Math.max(1, options.firstWindowSize ?? DEFAULT_FIRST_WINDOW_SIZE);
    const lead = Math.max(0, Math.floor(options.leadSegments ?? DEFAULT_LEAD_SEGMENTS));
    // A document no longer than the lead would never be directed at all.
    this.lead = this.blocks.length > lead ? lead : 0;
    this.before = Math.max(0, options.contextBefore ?? DEFAULT_CONTEXT_BEFORE);
    this.after = Math.max(0, options.contextAfter ?? DEFAULT_CONTEXT_AFTER);
    this.lookahead = Math.max(0, options.lookahead ?? DEFAULT_LOOKAHEAD);
    this.firstBudget = options.firstSoundBudgetMs ?? DEFAULT_FIRST_SOUND_BUDGET_MS;
    this.steadyBudget = options.steadyBudgetMs ?? DEFAULT_STEADY_BUDGET_MS;
    this.startupGrace = Math.max(0, options.startupGraceMs ?? DEFAULT_STARTUP_GRACE_MS);
    this.maxFailures = Math.max(1, options.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES);
    this.gpuYield = options.gpuYield ?? createGpuYieldProbe();
  }

  // -- public ---------------------------------------------------------------

  /** Preloads the model (called by `open`). Never waited for, never rejects; game mode, a suspended session and an empty document skip it. */
  warmUp(): void {
    const llm = this.options.llm;
    if (this.options.warmup === false || llm.warmup === undefined || this.blocks.length === 0 || this.blockedReason() !== undefined) {
      return;
    }
    llm.warmup(this.abort.signal).then(
      () => this.options.trace?.({ type: "warmup", ok: true }),
      (error: unknown) => {
        const reason = classifyLlmFailure(error, this.abort.signal);
        if (reason === "egress-denied") {
          this.suspend(reason);
        }
        this.options.trace?.({ type: "warmup", ok: false, degradedReason: reason });
      }
    );
  }

  /**
   * The cues to read for `segmentId`, at most one wait budget from now. Never
   * rejects. Asking also moves the anticipation: the windows up to `lookahead`
   * segments after this one are directed in the background.
   */
  async cuesFor(segmentId: string, signal?: AbortSignal): Promise<SegmentDirection> {
    const index = this.indexOf.get(segmentId);
    const block = index === undefined ? undefined : this.blocks[index];
    if (index === undefined || block === undefined) {
      return { segmentId, cues: [], directed: false, source: "neutral" };
    }
    if (this.abort.signal.aborted) {
      return this.neutralFor(block, "cancelled");
    }
    const window = this.windowOf(index);
    this.anticipate(index);
    if (window < 0) {
      // Lead segment: read neutrally at once, while the first window is computed.
      this.asked = true;
      return this.neutralFor(block, "late");
    }
    const slot = this.slots.get(window);
    let result = this.resolved.get(window);
    if (result === undefined && slot !== undefined) {
      // Start-up: nothing waits for the first window, the reading goes on neutrally and the directed cues take over as soon as they exist.
      const startingUp = this.lead > 0 && !this.warm;
      const budget = this.late.has(window) ? 0 : startingUp ? this.startupGrace : this.asked ? this.steadyBudget : this.firstBudget;
      this.asked = true;
      const waited = await waitFor(slot, budget, signal);
      if ("value" in waited) {
        result = waited.value;
      } else {
        const reason: DirectionDegradedReason = "late" in waited ? "late" : "cancelled";
        if (reason === "late") {
          this.late.add(window);
          this.lateSegments += 1;
          this.options.trace?.({ type: "late", window });
        }
        return this.neutralFor(block, reason);
      }
    }
    this.asked = true;
    return result === undefined ? this.neutralFor(block, "late") : this.select(block, index, result);
  }

  /** Resolves when every window scheduled so far has been computed (or given up). For tests and "Préparer la lecture". */
  async idle(): Promise<void> {
    let seen: Promise<unknown>;
    do {
      seen = this.chain;
      await seen;
    } while (seen !== this.chain);
  }

  /** Cancels what is in flight and stops scheduling. Idempotent. */
  dispose(): void {
    this.abort.abort();
  }

  stats(): SessionStats {
    return {
      windowsFromModel: this.fromModel,
      windowsFromCache: this.fromCache,
      windowsNeutral: this.neutralWindows,
      neutralByReason: { ...this.neutralByReason },
      llmCalls: this.llmCalls,
      lateSegments: this.lateSegments,
      ...(this.suspendedReason !== undefined ? { suspended: this.suspendedReason } : {})
    };
  }

  // -- windows --------------------------------------------------------------

  /** Window of a segment; -1 for a lead segment (read neutrally, in no window). */
  private windowOf(index: number): number {
    if (index < this.lead) {
      return -1;
    }
    const rel = index - this.lead;
    return rel < this.firstSize ? 0 : 1 + Math.floor((rel - this.firstSize) / this.windowSize);
  }

  private range(window: number): { start: number; end: number } {
    const start = window === 0 ? this.lead : this.lead + this.firstSize + (window - 1) * this.windowSize;
    return { start, end: Math.min(this.blocks.length, start + (window === 0 ? this.firstSize : this.windowSize)) };
  }

  /** Schedules the window of `index` and those up to `lookahead` segments further (only its own window in game mode). */
  private anticipate(index: number): void {
    if (this.abort.signal.aborted || this.blocks.length === 0) {
      return;
    }
    const last = Math.min(this.blocks.length - 1, index + (this.gpuYield() ? 0 : this.lookahead));
    // A lead segment has no window of its own: asking for it starts the first directed window.
    const first = Math.max(0, this.windowOf(index));
    for (let window = first; window <= Math.max(first, this.windowOf(last)); window += 1) {
      this.ensure(window);
    }
  }

  private ensure(window: number): void {
    if (this.slots.has(window)) {
      return;
    }
    const run = this.chain.then(() => this.compute(window));
    this.chain = run;
    const slot = run.then((result) => {
      this.warm = true;
      if (result.transient) {
        if (this.slots.get(window) === slot) {
          this.slots.delete(window);
        }
      } else {
        this.resolved.set(window, result);
      }
      return result;
    });
    this.slots.set(window, slot);
    // `chain` must not reject; `compute` never does, and `slot` is only awaited by `cuesFor` through `waitFor`.
    slot.catch(() => undefined);
  }

  private blockedReason(): DirectionDegradedReason | undefined {
    if (this.abort.signal.aborted) {
      return "cancelled";
    }
    return this.gpuYield() ? "gpu-yield" : this.suspendedReason;
  }

  private note(reason: DirectionDegradedReason | undefined): void {
    if (reason === undefined) {
      this.failures = 0;
      return;
    }
    if (reason === "egress-denied") {
      this.suspend(reason);
    } else if (reason !== "gpu-yield" && reason !== "cancelled" && reason !== "late") {
      this.failures += 1;
      if (this.failures >= this.maxFailures) {
        this.suspend(reason);
      }
    }
  }

  private suspend(reason: DirectionDegradedReason): void {
    if (this.suspendedReason === undefined) {
      this.suspendedReason = reason;
      this.options.trace?.({ type: "suspended", reason });
    }
  }

  private neutralResult(window: number, reason: DirectionDegradedReason, partition?: Partition): WindowResult {
    const { start, end } = this.range(window);
    return {
      partition: partition ?? neutralPartitionForSource(this.blocks.slice(start, end), this.meta(0)),
      source: "neutral",
      degradedReason: reason,
      transient: reason === "gpu-yield"
    };
  }

  private meta(bibleRevision: number): { documentKey: string; bibleRevision: number } {
    return { documentKey: this.params.document.documentKey, bibleRevision };
  }

  private async effective(): Promise<Bible> {
    return this.options.store.effective(this.params.document, this.params.series);
  }

  private keyFor(window: number, bible: Bible): { key: string; block: { window: SourceBlock[]; before: SourceBlock[]; after: SourceBlock[] } } {
    const { start, end } = this.range(window);
    const parts = {
      window: this.blocks.slice(start, end),
      before: this.blocks.slice(Math.max(0, start - this.before), start),
      after: this.blocks.slice(end, end + this.after)
    };
    const key = windowCacheKey({
      documentKey: this.params.document.documentKey,
      ...parts,
      bibleStamp: cacheBibleStamp(bible),
      model: this.options.llm.model,
      promptVersion: this.options.llm.promptVersion,
      profileId: this.params.profileId,
      faithful: this.params.faithful === true
    });
    return { key, block: parts };
  }

  /** Cues of the already-directed windows that touch the `before` context. */
  private previousCues(start: number): Cue[] {
    const from = Math.max(0, start - this.before);
    const ids = new Set(this.blocks.slice(from, start).map((block) => block.id));
    const cues: Cue[] = [];
    for (let window = this.windowOf(from); window < this.windowOf(start); window += 1) {
      const result = this.resolved.get(window);
      if (result !== undefined && result.source !== "neutral") {
        cues.push(...result.partition.cues.filter((cue) => cue.sourceIds.some((id) => ids.has(id))));
      }
    }
    return cues;
  }

  /** Never rejects. */
  private async compute(window: number): Promise<WindowResult> {
    try {
      return await this.computeUnsafe(window);
    } catch {
      return this.neutralResult(window, this.abort.signal.aborted ? "cancelled" : "provider-unavailable");
    }
  }

  private async computeUnsafe(window: number): Promise<WindowResult> {
    const persist = this.params.document.persist;
    const { start, end } = this.range(window);
    const readable = this.blocks.slice(start, end);
    const bible0 = await this.effective();
    const first = this.keyFor(window, bible0);
    const hit = await this.options.cache.get(
      first.key,
      { documentKey: this.params.document.documentKey, window: readable, bible: bible0 },
      persist
    );
    if (hit !== undefined) {
      this.fromCache += 1;
      this.emitWindow(window, readable.length, "cache", undefined, 0, 0, 0, 0);
      return { partition: hit, source: "cache", transient: false };
    }

    const blocked = this.blockedReason();
    if (blocked !== undefined) {
      return this.settleNeutral(window, readable.length, blocked, undefined);
    }
    await this.ensureAnalysis();
    const stillBlocked = this.blockedReason();
    if (stillBlocked !== undefined) {
      return this.settleNeutral(window, readable.length, stillBlocked, undefined);
    }

    const bible = await this.effective();
    const analysis: BibleAnalysis | undefined = bible.analysis;
    const context = this.keyFor(window, bible);
    const directed = await this.options.director.directWindow({
      documentKey: this.params.document.documentKey,
      document: this.params.document,
      window: readable,
      before: context.block.before,
      after: context.block.after,
      previousCues: this.previousCues(start),
      ...(analysis !== undefined ? { analysis } : {}),
      bible: { bible, ...(this.params.providerId !== undefined ? { providerId: this.params.providerId } : {}) },
      faithful: this.params.faithful === true,
      gate: () => this.blockedReason(),
      signal: this.abort.signal
    });
    this.llmCalls += directed.llmCalls;
    if (directed.directed) {
      this.note(undefined);
      this.fromModel += 1;
      await this.options.cache.put(context.key, directed.partition, persist);
      this.emitWindow(window, readable.length, "llm", undefined, directed.llmCalls, directed.resends, directed.bounds?.total ?? 0, directed.facts.written);
      return { partition: directed.partition, source: "llm", transient: false };
    }
    const reason = directed.degradedReason ?? "provider-unavailable";
    this.note(reason);
    return this.settleNeutral(window, readable.length, reason, directed.partition, directed.llmCalls, directed.resends);
  }

  private settleNeutral(
    window: number,
    segments: number,
    reason: DirectionDegradedReason,
    partition: Partition | undefined,
    llmCalls = 0,
    resends = 0
  ): WindowResult {
    this.neutralWindows += 1;
    this.neutralByReason[reason] = (this.neutralByReason[reason] ?? 0) + 1;
    this.emitWindow(window, segments, "neutral", reason, llmCalls, resends, 0, 0);
    return this.neutralResult(window, reason, partition);
  }

  private emitWindow(
    window: number,
    segments: number,
    source: CueSource,
    degradedReason: DirectionDegradedReason | undefined,
    llmCalls: number,
    resends: number,
    boundsAdjusted: number,
    facts: number
  ): void {
    this.options.trace?.({
      type: "window",
      window,
      segments,
      source,
      ...(degradedReason !== undefined ? { degradedReason } : {}),
      llmCalls,
      resends,
      boundsAdjusted,
      facts
    });
  }

  /** The analysis runs once per session, before the first model-directed window; game mode and a suspended session skip it. */
  private ensureAnalysis(): Promise<void> {
    this.analysis ??= (async () => {
      const outcome = await this.options.analyst.analyze({
        document: this.params.document,
        ...(this.params.series !== undefined ? { series: this.params.series } : {}),
        source: this.blocks,
        signal: this.abort.signal
      });
      this.llmCalls += outcome.calls;
      this.options.trace?.({
        type: "analysis",
        status: outcome.status,
        ...(outcome.degradedReason !== undefined ? { degradedReason: outcome.degradedReason } : {}),
        calls: outcome.calls,
        written: outcome.tally.written
      });
      this.note(outcome.status === "degraded" ? outcome.degradedReason : undefined);
    })();
    return this.analysis;
  }

  // -- what a segment gets ----------------------------------------------------

  private neutralFor(block: SourceBlock, reason: DirectionDegradedReason): SegmentDirection {
    const cues = neutralPartitionForSource([block], this.meta(0)).cues;
    return { segmentId: block.id, cues, directed: false, source: "neutral", degradedReason: reason };
  }

  private anchorOf(cue: Cue): number {
    const indexes = cue.sourceIds.map((id) => this.indexOf.get(id)).filter((value): value is number => value !== undefined);
    return indexes.length === 0 ? -1 : Math.min(...indexes);
  }

  /**
   * A cue is handed out with the first segment it covers. A segment covered
   * only by a cue whose first segment was read neutrally (late) is read
   * neutrally too; a segment whose covering cue was already handed out gets
   * nothing more.
   */
  private select(block: SourceBlock, index: number, result: WindowResult): SegmentDirection {
    const covering = result.partition.cues.filter((cue) => cue.sourceIds.includes(block.id));
    const anchored = covering.filter((cue) => this.anchorOf(cue) === index);
    const base = { segmentId: block.id, source: result.source, ...(result.degradedReason !== undefined ? { degradedReason: result.degradedReason } : {}) };
    if (anchored.length > 0) {
      anchored.forEach((cue) => this.handedOut.add(cue.cueId));
      return { ...base, cues: anchored, directed: result.source !== "neutral" };
    }
    if (covering.length > 0 && covering.every((cue) => this.handedOut.has(cue.cueId))) {
      return { ...base, cues: [], directed: result.source !== "neutral" };
    }
    return { ...this.neutralFor(block, result.degradedReason ?? "late") };
  }
}
