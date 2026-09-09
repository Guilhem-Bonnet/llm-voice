/**
 * `AudioQueue`: the global synthesis queue behind the player.
 *
 * CdC §65 fixes `maxConcurrentTtsJobs = 1` per instance (VRAM, audio ordering,
 * stability) and CdC §32 fixes `prefetchChunks = 2`: the queue only ever works
 * on the chunk being played and the two after it. Every job carries its own
 * `AbortController` so a user `Stop` cancels the prefetch that is no longer
 * needed (CdC §62), and every job is cache-first (CdC §37) so the same sentence
 * is never synthesised twice.
 *
 * The queue owns chunk status (`pending → generating → ready | error`); the
 * controller owns `playing` / `played`, which are player facts, not queue facts.
 *
 * A failed synthesis is retried with exponential backoff (`retryBackoffMs`,
 * default `[100, 400]` plus jitter) rather than immediately, as ADR-005 noted
 * was reported to phase 4. A chunk under backoff stays `generating` — never a
 * new `retrying` status, which would ripple through every `AudioChunkStatus`
 * consumer for no behavioural gain — so `waitFor` and the player see nothing
 * different, only a delay before the next attempt.
 *
 * The key of every chunk that is `ready` or currently in the prefetch window
 * `[cursor, cursor + prefetchChunks]` is pinned in the cache (`cache.pin`,
 * ADR-004's reported-to-phase-4 gap): it cannot be evicted while it might
 * still be played. Chunks that fall out of the window are unpinned.
 */

import type { AudioChunk } from "../core/playback.js";
import type { TtsProvider, TtsRequest } from "../core/tts.js";
import { computeCacheKey, type AudioCacheStore } from "./AudioCache.js";

/**
 * Backoff delay before retry `attempt` (1-based): `backoffMs[attempt - 1]`,
 * clamped to the last configured step, plus up to `jitterMs` of random delay.
 * Pure and exported so tests can assert the exact schedule without faking
 * `Math.random`'s distribution.
 */
export function computeBackoffDelay(
  attempt: number,
  backoffMs: readonly number[],
  jitterMs = 0,
  random: () => number = Math.random
): number {
  if (backoffMs.length === 0) {
    return 0;
  }
  const step = backoffMs[Math.min(Math.max(attempt, 1) - 1, backoffMs.length - 1)] ?? 0;
  const jitter = jitterMs > 0 ? Math.floor(random() * jitterMs) : 0;
  return step + jitter;
}

/** Synthesis binding shared by every chunk of one session. */
export interface AudioQueueBinding {
  /** Provider id hashed into the cache key; defaults to `tts.id`. */
  providerId?: string;
  model?: string;
  voice?: string;
  language?: string;
  speed?: number;
  format?: TtsRequest["format"];
  parameters?: Readonly<Record<string, unknown>>;
}

/** Tunables of the queue; the defaults are the ones CdC §32 and §65 recommend. */
export interface AudioQueueOptions {
  /** CdC §65: one TTS job at a time per window. */
  maxConcurrentTtsJobs?: number;
  /** CdC §32: how many chunks are synthesised *ahead* of the cursor. */
  prefetchChunks?: number;
  /** Retries after the first failure before the chunk is marked `error`. */
  maxRetries?: number;
  /** Backoff delay (ms) before retry N: `retryBackoffMs[N-1]`, clamped to the last step. */
  retryBackoffMs?: readonly number[];
  /** Extra random delay in `[0, retryJitterMs)` added to every backoff step. Set `0` in tests. */
  retryJitterMs?: number;
  /** Injectable RNG for deterministic jitter assertions; defaults to `Math.random`. */
  random?: () => number;
  /**
   * Per-request timeout (`llmVoice.tts.timeoutMs`, default 60000, S5.3):
   * combined with the job's own `AbortSignal` (Stop, cursor move) into a
   * single signal passed to `TtsProvider.synthesize`. A timeout aborts that
   * *derived* signal only — the job's own signal, and therefore
   * `AudioQueue.cancelAll()`'s guarantee that a genuinely cancelled chunk
   * reverts to `pending` instead of `error`, is untouched: a timeout is a
   * failure like any other and goes through the normal retry/backoff path.
   * `undefined` (the default) never wraps the signal, matching every
   * existing test that does not pass this option.
   */
  timeoutMs?: number;
  /**
   * S6.2 instrumentation hook: fired once per chunk, right when it turns
   * `ready` (both the cache-hit and the freshly-synthesised path), and once
   * more if it ends in `error`. Carries no `spokenText`/audio (CdC §81) —
   * only timings and counts, safe to forward straight to `Logger.debug`.
   * Never thrown from: a throwing listener is swallowed, since a broken
   * instrumentation hook must not break synthesis.
   */
  onChunkTiming?: (event: ChunkTimingEvent) => void;
}

/** One `AudioQueue.onChunkTiming` sample (S6.2). No text, no audio — CdC §81. */
export interface ChunkTimingEvent {
  index: number;
  /** `true` when `AudioCacheStore.get` already had this chunk's audio. */
  cacheHit: boolean;
  /** `undefined` on a cache hit: no `TtsProvider.synthesize` call was made. */
  synthesisMs?: number;
  /** `false` only for the terminal `error` event. */
  ready: boolean;
  /** Total chunks currently queued (`AudioQueue.chunks.length`), for "file d'attente". */
  queueSize: number;
}

/** Everything the queue needs injected; none of it touches `vscode`. */
export interface AudioQueueDeps {
  tts: TtsProvider;
  cache: AudioCacheStore;
  binding?: AudioQueueBinding;
}

interface JobState {
  attempts: number;
  controller: AbortController | undefined;
  waiters: Array<(chunk: AudioChunk) => void>;
}

const DEFAULT_MAX_CONCURRENT = 1;
const DEFAULT_PREFETCH = 2;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BACKOFF_MS: readonly number[] = [100, 400];
const DEFAULT_RETRY_JITTER_MS = 50;

/**
 * S6.2 (CdC §32/§65): the number of chunks to synthesise ahead of the cursor
 * that keeps playback gapless *without* over-buffering, as a function of the
 * measured real-time factor (`rtf` = synthesis time / audio duration, see
 * `scripts/bench-tts.mjs`).
 *
 * Rule of thumb: `ceil(rtf) + 1`. At `rtf <= 1` (synthesis at least as fast
 * as playback) this is `2` — one chunk absorbs the jitter of a single slow
 * request, the second tolerates a second one in a row, matching CdC §32's
 * recommended `prefetchChunks = 2`. Above `rtf = 1` the queue structurally
 * cannot keep up forever (each chunk takes longer to make than it takes to
 * play), so more prefetch only buys a longer runway before the player first
 * has to wait — it does not fix the underlying deficit. `docs/performance.md`
 * documents this and the RTF measured on the reference machine, which is
 * `≈ 1` and is exactly why `llmVoice.audio.prefetchChunks`'s default (`2`,
 * unchanged by this story) already matches what this formula recommends.
 * Nothing calls this at runtime yet — the setting stays a static default —
 * but it is what that default's value is derived from, and what a future
 * "auto-tune from Test Voice" could call with a freshly measured RTF.
 */
export function recommendedPrefetchChunks(rtf: number): number {
  if (!Number.isFinite(rtf) || rtf <= 0) {
    return DEFAULT_PREFETCH;
  }
  return Math.min(10, Math.max(1, Math.ceil(rtf) + 1));
}

export class AudioQueue {
  private readonly tts: TtsProvider;
  private readonly cache: AudioCacheStore;
  private readonly binding: AudioQueueBinding;
  private readonly maxConcurrentTtsJobs: number;
  private readonly prefetchChunks: number;
  private readonly maxRetries: number;
  private readonly retryBackoffMs: readonly number[];
  private readonly retryJitterMs: number;
  private readonly random: () => number;
  private readonly timeoutMs: number | undefined;
  private readonly onChunkTiming: ((event: ChunkTimingEvent) => void) | undefined;

  private items: AudioChunk[] = [];
  private readonly jobs = new Map<number, JobState>();
  /** Cache key of every chunk that has reached `run()`, for pin/unpin bookkeeping. */
  private readonly chunkKeys = new Map<number, string>();
  private readonly retryTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private cursor = 0;
  private active = 0;
  private disposed = false;
  /** Set by `cancelAll()`: a cancelled queue must not restart itself. */
  private suspended = false;

  constructor(deps: AudioQueueDeps, options: AudioQueueOptions = {}) {
    this.tts = deps.tts;
    this.cache = deps.cache;
    this.binding = deps.binding ?? {};
    this.maxConcurrentTtsJobs = Math.max(
      1,
      options.maxConcurrentTtsJobs ?? DEFAULT_MAX_CONCURRENT
    );
    this.prefetchChunks = Math.max(0, options.prefetchChunks ?? DEFAULT_PREFETCH);
    this.maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES);
    this.retryBackoffMs = options.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS;
    this.retryJitterMs = Math.max(0, options.retryJitterMs ?? DEFAULT_RETRY_JITTER_MS);
    this.random = options.random ?? Math.random;
    this.timeoutMs = options.timeoutMs;
    this.onChunkTiming = options.onChunkTiming;
  }

  /** Chunks currently queued, in playback order. */
  get chunks(): readonly AudioChunk[] {
    return this.items;
  }

  /** Number of TTS jobs in flight; never above `maxConcurrentTtsJobs`. */
  get inFlight(): number {
    return this.active;
  }

  /** Replaces the queue content and rewinds the cursor. */
  reset(chunks: readonly AudioChunk[]): void {
    this.cancelAll();
    this.unpinAll();
    this.items = chunks.map((chunk) => ({ ...chunk }));
    this.jobs.clear();
    this.cursor = 0;
    this.suspended = false;
  }

  /** Appends chunks produced later, as progressive narration completes. */
  append(chunks: readonly AudioChunk[]): void {
    if (this.disposed || chunks.length === 0) {
      return;
    }
    this.items.push(...chunks.map((chunk) => ({ ...chunk })));
    this.pump();
  }

  /**
   * Moves the prefetch window. Only `[cursor, cursor + prefetchChunks]` is ever
   * synthesised, so a 45-minute document costs three jobs at a time (CdC §32).
   */
  setCursor(index: number): void {
    this.cursor = Math.max(0, index);
    this.suspended = false;
    this.reconcilePins();
    this.pump();
  }

  /**
   * Resolves once `index` is `ready` or `error`. Never rejects: a cancelled job
   * resolves with the chunk still `pending`, which the caller reads as "the
   * session moved on".
   */
  waitFor(index: number): Promise<AudioChunk> {
    const chunk = this.items[index];
    if (chunk === undefined) {
      return Promise.reject(new RangeError(`No chunk at index ${index}`));
    }
    if (chunk.status !== "pending" && chunk.status !== "generating") {
      // `ready`, `error`, and the player-owned `playing` / `played` are all
      // terminal for the queue: the audio either exists or never will.
      return Promise.resolve(chunk);
    }
    this.suspended = false;
    this.pump();
    return new Promise<AudioChunk>((resolve) => {
      this.jobFor(index).waiters.push(resolve);
    });
  }

  /**
   * Aborts every job in flight and every job still pending (CdC §62). Chunks
   * already `ready` keep their audio, and the cache is untouched (CdC §36).
   */
  cancelAll(): void {
    this.suspended = true;
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();
    for (const [index, job] of this.jobs) {
      job.controller?.abort();
      job.controller = undefined;
      const chunk = this.items[index];
      if (chunk !== undefined) {
        this.settleWaiters(index, chunk);
      }
    }
  }

  /**
   * Re-arms a chunk that ended in `error` for a fresh synthesis attempt,
   * with its own `maxRetries` budget again (CdC §52's "Retry relance le
   * même chunk sans recréer la session") — unlike `reset()`, every other
   * chunk (and its cache/pin state) is left exactly as it was. A no-op for
   * any status other than `error`: a stale click after the cursor already
   * moved past this chunk must not resurrect it.
   */
  retry(index: number): void {
    const chunk = this.items[index];
    if (chunk === undefined || chunk.status !== "error") {
      return;
    }
    chunk.status = "pending";
    delete chunk.error;
    this.jobs.delete(index);
    this.suspended = false;
    this.pump();
  }

  /** Idempotent teardown: cancels everything and refuses further work. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.cancelAll();
    this.unpinAll();
    this.jobs.clear();
  }

  private jobFor(index: number): JobState {
    let job = this.jobs.get(index);
    if (job === undefined) {
      job = { attempts: 0, controller: undefined, waiters: [] };
      this.jobs.set(index, job);
    }
    return job;
  }

  private settleWaiters(index: number, chunk: AudioChunk): void {
    const job = this.jobs.get(index);
    if (job === undefined || job.waiters.length === 0) {
      return;
    }
    const waiters = job.waiters.splice(0, job.waiters.length);
    for (const resolve of waiters) {
      resolve(chunk);
    }
  }

  /** Starts as many jobs as the concurrency budget and the window allow. */
  private pump(): void {
    if (this.disposed || this.suspended) {
      return;
    }
    while (this.active < this.maxConcurrentTtsJobs) {
      const index = this.nextPendingIndex();
      if (index === undefined) {
        return;
      }
      this.start(index);
    }
  }

  /**
   * Pins the key of every chunk still inside `[cursor, cursor + prefetchChunks]`
   * — "the chunk in playback and the ones prefetched" — and unpins whatever
   * key fell out of the window (played chunks, or ones the cursor skipped
   * past via `previous()`/`next()`). Both `pin`/`unpin` are optional on
   * `AudioCacheStore`, so a store that predates ADR-004's pinning gap fix is
   * a silent no-op here.
   */
  private reconcilePins(): void {
    const last = Math.min(this.items.length - 1, this.cursor + this.prefetchChunks);
    for (const [index, key] of this.chunkKeys) {
      if (index < this.cursor || index > last) {
        this.cache.unpin?.(key);
        this.chunkKeys.delete(index);
      }
    }
  }

  private unpinAll(): void {
    for (const key of this.chunkKeys.values()) {
      this.cache.unpin?.(key);
    }
    this.chunkKeys.clear();
  }

  private nextPendingIndex(): number | undefined {
    const last = Math.min(
      this.items.length - 1,
      this.cursor + this.prefetchChunks
    );
    for (let index = this.cursor; index <= last; index++) {
      if (this.items[index]?.status === "pending") {
        return index;
      }
    }
    return undefined;
  }

  private start(index: number): void {
    const chunk = this.items[index];
    if (chunk === undefined) {
      return;
    }
    const job = this.jobFor(index);
    const controller = new AbortController();
    job.controller = controller;
    chunk.status = "generating";
    this.active += 1;
    void this.run(index, chunk, job, controller.signal);
  }

  private async run(
    index: number,
    chunk: AudioChunk,
    job: JobState,
    signal: AbortSignal
  ): Promise<void> {
    const providerId = this.binding.providerId ?? this.tts.id;
    try {
      const key = computeCacheKey({
        providerId,
        ...(this.binding.model !== undefined ? { model: this.binding.model } : {}),
        ...(this.binding.voice !== undefined ? { voice: this.binding.voice } : {}),
        ...(this.binding.parameters !== undefined
          ? { parameters: this.binding.parameters }
          : {}),
        spokenText: chunk.spokenText
      });
      // Pin now: this index is by construction inside the prefetch window
      // (`nextPendingIndex` only ever selects from it), so its audio must
      // survive eviction until `reconcilePins()` sees the cursor move past it.
      this.chunkKeys.set(index, key);
      this.cache.pin?.(key);

      const cached = await this.cache.get(key);
      if (signal.aborted) {
        this.revertToPending(chunk);
        return;
      }
      if (cached !== undefined) {
        chunk.audioUri = await this.cache.put(key, cached, { providerId });
        // S6.2: without this, a cache hit reached the sink with
        // `durationMs`/`format` both `undefined` — CdC §37's "no second
        // synthesis" held, but the sink lost the audio's real length on
        // every hit (`AudioCacheStore.getMeta`'s doc comment).
        const meta = await this.cache.getMeta?.(key);
        if (meta?.format !== undefined) {
          chunk.format = meta.format;
        }
        if (meta?.durationMs !== undefined) {
          chunk.durationMs = meta.durationMs;
        }
        chunk.status = "ready";
        this.emitTiming(index, { cacheHit: true, ready: true });
        return;
      }

      const deadline = this.withTimeout(signal);
      let result;
      const synthesisStartedAt = Date.now();
      try {
        result = await this.tts.synthesize(this.requestFor(chunk), deadline.signal);
      } finally {
        deadline.cleanup();
      }
      const synthesisMs = Date.now() - synthesisStartedAt;
      if (signal.aborted) {
        this.revertToPending(chunk);
        return;
      }
      chunk.audioUri = await this.cache.put(key, result.data, {
        format: result.format,
        providerId,
        ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {})
      });
      chunk.format = result.format;
      if (result.durationMs !== undefined) {
        chunk.durationMs = result.durationMs;
      }
      chunk.status = "ready";
      this.emitTiming(index, { cacheHit: false, synthesisMs, ready: true });
    } catch (error) {
      if (signal.aborted) {
        this.revertToPending(chunk);
        return;
      }
      job.attempts += 1;
      if (job.attempts <= this.maxRetries) {
        this.scheduleRetry(index, chunk, job);
        return;
      }
      chunk.status = "error";
      chunk.error = messageOf(error);
      this.emitTiming(index, { cacheHit: false, ready: false });
    } finally {
      this.active -= 1;
      job.controller = undefined;
      if (chunk.status === "ready" || chunk.status === "error") {
        this.settleWaiters(index, chunk);
      }
      this.pump();
    }
  }

  /**
   * Combines a job's own `signal` (Stop, cursor move — `cancelAll()`) with
   * `this.timeoutMs` into one derived `AbortSignal` for `synthesize()`
   * (CdC §52/résilience, S5.3). `undefined` → no timeout, the job's own
   * signal is reused as-is (every pre-S5.3 test relies on this). A fired
   * timeout only aborts the *derived* signal, not the job's own `signal`:
   * `run()`'s post-await `signal.aborted` check — which decides "cancelled,
   * revert to pending" vs "failed, retry" — is therefore unaffected by a
   * timeout, which always falls through to the normal retry/backoff path.
   */
  private withTimeout(signal: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
    if (this.timeoutMs === undefined) {
      return { signal, cleanup: () => {} };
    }
    const controller = new AbortController();
    if (signal.aborted) {
      controller.abort();
    }
    const onAbort = (): void => controller.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    if (typeof (timer as unknown as { unref?: () => void }).unref === "function") {
      (timer as unknown as { unref: () => void }).unref();
    }
    return {
      signal: controller.signal,
      cleanup: (): void => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      }
    };
  }

  /** A cancelled job is not a failed job: the chunk stays synthesisable. */
  private revertToPending(chunk: AudioChunk): void {
    chunk.status = "pending";
  }

  /**
   * Delays retry `job.attempts` by `computeBackoffDelay(...)`. The chunk stays
   * `generating` for the whole wait (never a new status), which is exactly
   * what keeps `nextPendingIndex()` from restarting it early and `waitFor()`
   * from resolving prematurely.
   */
  private scheduleRetry(index: number, chunk: AudioChunk, job: JobState): void {
    const delay = computeBackoffDelay(job.attempts, this.retryBackoffMs, this.retryJitterMs, this.random);
    if (delay <= 0) {
      chunk.status = "pending";
      return;
    }
    const timer = setTimeout(() => {
      this.retryTimers.delete(index);
      if (this.disposed || this.suspended) {
        return;
      }
      chunk.status = "pending";
      this.pump();
    }, delay);
    this.retryTimers.set(index, timer);
  }

  private requestFor(chunk: AudioChunk): TtsRequest {
    return {
      text: chunk.spokenText,
      ...(this.binding.language !== undefined
        ? { language: this.binding.language }
        : {}),
      ...(this.binding.voice !== undefined ? { voice: this.binding.voice } : {}),
      ...(this.binding.model !== undefined ? { model: this.binding.model } : {}),
      ...(this.binding.speed !== undefined ? { speed: this.binding.speed } : {}),
      ...(this.binding.format !== undefined ? { format: this.binding.format } : {}),
      ...(this.binding.parameters !== undefined
        ? { parameters: this.binding.parameters }
        : {})
    };
  }

  /** Forwards one `ChunkTimingEvent` to `onChunkTiming` (S6.2); never throws. */
  private emitTiming(
    index: number,
    partial: Pick<ChunkTimingEvent, "cacheHit" | "ready"> & Partial<Pick<ChunkTimingEvent, "synthesisMs">>
  ): void {
    if (this.onChunkTiming === undefined) {
      return;
    }
    try {
      this.onChunkTiming({ index, queueSize: this.items.length, ...partial });
    } catch {
      // Instrumentation must never break synthesis (S6.2).
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
