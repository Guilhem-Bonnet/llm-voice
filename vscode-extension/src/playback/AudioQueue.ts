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
 */

import type { AudioChunk } from "../core/playback.js";
import type { TtsProvider, TtsRequest } from "../core/tts.js";
import { computeCacheKey, type AudioCacheStore } from "./AudioCache.js";

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

export class AudioQueue {
  private readonly tts: TtsProvider;
  private readonly cache: AudioCacheStore;
  private readonly binding: AudioQueueBinding;
  private readonly maxConcurrentTtsJobs: number;
  private readonly prefetchChunks: number;
  private readonly maxRetries: number;

  private items: AudioChunk[] = [];
  private readonly jobs = new Map<number, JobState>();
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
    for (const [index, job] of this.jobs) {
      job.controller?.abort();
      job.controller = undefined;
      const chunk = this.items[index];
      if (chunk !== undefined) {
        this.settleWaiters(index, chunk);
      }
    }
  }

  /** Idempotent teardown: cancels everything and refuses further work. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.cancelAll();
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
    try {
      const key = computeCacheKey({
        providerId: this.binding.providerId ?? this.tts.id,
        ...(this.binding.model !== undefined ? { model: this.binding.model } : {}),
        ...(this.binding.voice !== undefined ? { voice: this.binding.voice } : {}),
        ...(this.binding.parameters !== undefined
          ? { parameters: this.binding.parameters }
          : {}),
        spokenText: chunk.spokenText
      });

      const cached = await this.cache.get(key);
      if (signal.aborted) {
        this.revertToPending(chunk);
        return;
      }
      if (cached !== undefined) {
        chunk.audioUri = await this.cache.put(key, cached);
        chunk.status = "ready";
        return;
      }

      const result = await this.tts.synthesize(this.requestFor(chunk), signal);
      if (signal.aborted) {
        this.revertToPending(chunk);
        return;
      }
      chunk.audioUri = await this.cache.put(key, result.data);
      chunk.format = result.format;
      if (result.durationMs !== undefined) {
        chunk.durationMs = result.durationMs;
      }
      chunk.status = "ready";
    } catch (error) {
      if (signal.aborted) {
        this.revertToPending(chunk);
        return;
      }
      job.attempts += 1;
      if (job.attempts <= this.maxRetries) {
        chunk.status = "pending";
        return;
      }
      chunk.status = "error";
      chunk.error = messageOf(error);
    } finally {
      this.active -= 1;
      job.controller = undefined;
      if (chunk.status === "ready" || chunk.status === "error") {
        this.settleWaiters(index, chunk);
      }
      this.pump();
    }
  }

  /** A cancelled job is not a failed job: the chunk stays synthesisable. */
  private revertToPending(chunk: AudioChunk): void {
    chunk.status = "pending";
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
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
