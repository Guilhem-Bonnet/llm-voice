/**
 * `PlaybackController`: the player state machine of CdC §34, living in the
 * Extension Host (ADR-001) and free of any `vscode` import.
 *
 * It owns the session, drives the `AudioQueue` cursor, and speaks to the
 * playback surface through `AudioSink`. It emits four typed events — state,
 * current chunk (for the editor highlight), progress and errors — and nothing
 * else: the Webview, the status bar and the decorations are all consumers.
 *
 * Invariants:
 *  - never two chunks playing at once (`generation` guard around every await);
 *  - `pause` keeps index, intra-chunk position and prefetched chunks (CdC §35);
 *  - `stop` rewinds, cancels the queue, keeps the cache (CdC §36, §62);
 *  - `dispose` is idempotent and silences every event;
 *  - two ready chunks are chained without an `ended`→`load` round trip
 *    (`AudioSink` v2, ADR-012 §3): once a chunk plays, the next one is handed
 *    to the sink with `enqueue()` and the machine follows the sink's
 *    `started`; `load()` is only used for the first chunk, user jumps and a
 *    next chunk that was not ready in time.
 */

import type { AudioChunk, PlaybackState } from "../core/playback.js";
import type { NarrationSegment } from "../core/narration.js";
import type { VoiceProfile } from "../core/profile.js";
import type { SourceRange } from "../core/source.js";
import type { TtsProvider } from "../core/tts.js";
import type { AudioSink, AudioSinkChunk } from "./AudioSink.js";
import { InMemoryAudioCache, type AudioCacheStore } from "./AudioCache.js";
import { AudioQueue, type AudioQueueOptions } from "./AudioQueue.js";
import { Emitter, type Unsubscribe } from "./emitter.js";

/** Everything one `start()` call needs; the sink and the engine are injected. */
export interface PlaybackStartRequest {
  segments: readonly NarrationSegment[];
  profile: VoiceProfile;
  tts: TtsProvider;
  sink: AudioSink;
  /** Stable session id; generated when absent. */
  sessionId?: string;
  /**
   * `false` when more segments are still being narrated (CdC §63): reaching the
   * end then waits for `appendSegments()` instead of completing.
   */
  sealed?: boolean;
}

/** Emitted whenever the state machine moves (CdC §34). */
export interface PlaybackStateChange {
  previous: PlaybackState;
  state: PlaybackState;
  sessionId: string;
}

/** Emitted when a different chunk starts playing; drives the highlight. */
export interface ChunkChange {
  index: number;
  chunk: AudioChunk;
  sourceRanges: readonly SourceRange[];
}

/** Throttled progress, fed by the sink's `timeupdate` (D4). */
export interface PlaybackProgress {
  positionMs: number;
  durationMs?: number;
  index: number;
  total: number;
}

/** A chunk that could not be synthesised or could not be played. */
export interface PlaybackErrorInfo {
  index: number;
  chunk: AudioChunk;
  message: string;
  /** `synthesis` when the queue gave up, `playback` when the sink failed. */
  origin: "synthesis" | "playback";
}

/** The sink ran dry while playing (`AudioSink` v2 `underrun`). */
export interface PlaybackUnderrun {
  /** Index the machine is on when the sink reported it. */
  index: number;
  /** Chunk the sink was rendering when it starved. */
  chunkId: string;
  positionMs: number;
}

/** What to do with a failed chunk; the default is to skip it. */
export type ChunkErrorDecision = "skip" | "stop";

/** Injected policy for failed chunks, so the UI decides, not the machine. */
export type ChunkErrorHandler = (
  info: PlaybackErrorInfo
) => ChunkErrorDecision | Promise<ChunkErrorDecision>;

/** Construction-time dependencies and tunables. */
export interface PlaybackControllerOptions extends AudioQueueOptions {
  /** Defaults to an in-memory store; S3.5 injects the `globalStorageUri` one. */
  cache?: AudioCacheStore;
  onChunkError?: ChunkErrorHandler;
  /** `previous()` restarts the chunk past this offset (CdC §9 rewind rule). */
  previousThresholdMs?: number;
}

interface ActiveSession {
  id: string;
  profile: VoiceProfile;
  sink: AudioSink;
  queue: AudioQueue;
  chunks: AudioChunk[];
  sealed: boolean;
}

/** The chunk handed to the sink with `enqueue()`, ahead of its turn. */
interface PreloadedChunk {
  index: number;
  chunkId: string;
  /** The chunk before it already reported `ended`: `started` is due. */
  predecessorEnded: boolean;
}

const DEFAULT_PREVIOUS_THRESHOLD_MS = 2000;

export class PlaybackController {
  private readonly stateChanged = new Emitter<PlaybackStateChange>();
  private readonly chunkChanged = new Emitter<ChunkChange>();
  private readonly progressed = new Emitter<PlaybackProgress>();
  private readonly errored = new Emitter<PlaybackErrorInfo>();
  private readonly underran = new Emitter<PlaybackUnderrun>();

  private readonly cache: AudioCacheStore;
  private readonly queueOptions: AudioQueueOptions;
  private readonly onChunkError: ChunkErrorHandler;
  private readonly previousThresholdMs: number;

  private session: ActiveSession | undefined;
  private sinkSubscriptions: Unsubscribe[] = [];
  private state: PlaybackState = "idle";
  private currentIndex = 0;
  private positionMs = 0;
  /** Bumped by every transition that invalidates an in-flight `playIndex`. */
  private generation = 0;
  /** Index the machine is waiting for while narration is still running. */
  private awaitingIndex: number | undefined;
  /** Next chunk already enqueued in the sink (v2 preloading). */
  private preloaded: PreloadedChunk | undefined;
  /** Index a preload is waiting for (synthesis still running). */
  private preloadingIndex: number | undefined;
  private sessionCounter = 0;
  private disposed = false;

  constructor(options: PlaybackControllerOptions = {}) {
    this.cache = options.cache ?? new InMemoryAudioCache();
    this.queueOptions = {
      ...(options.maxConcurrentTtsJobs !== undefined
        ? { maxConcurrentTtsJobs: options.maxConcurrentTtsJobs }
        : {}),
      ...(options.prefetchChunks !== undefined
        ? { prefetchChunks: options.prefetchChunks }
        : {}),
      ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
      ...(options.retryBackoffMs !== undefined ? { retryBackoffMs: options.retryBackoffMs } : {}),
      ...(options.retryJitterMs !== undefined ? { retryJitterMs: options.retryJitterMs } : {}),
      ...(options.random !== undefined ? { random: options.random } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.onChunkTiming !== undefined ? { onChunkTiming: options.onChunkTiming } : {})
    };
    this.onChunkError = options.onChunkError ?? (() => "skip");
    this.previousThresholdMs =
      options.previousThresholdMs ?? DEFAULT_PREVIOUS_THRESHOLD_MS;
  }

  // ---------------------------------------------------------------- events

  onStateChange(listener: (change: PlaybackStateChange) => void): Unsubscribe {
    return this.stateChanged.on(listener);
  }

  onChunkChange(listener: (change: ChunkChange) => void): Unsubscribe {
    return this.chunkChanged.on(listener);
  }

  onProgress(listener: (progress: PlaybackProgress) => void): Unsubscribe {
    return this.progressed.on(listener);
  }

  onError(listener: (info: PlaybackErrorInfo) => void): Unsubscribe {
    return this.errored.on(listener);
  }

  /** The sink starved while playing (next chunk not ready, slow data). */
  onUnderrun(listener: (underrun: PlaybackUnderrun) => void): Unsubscribe {
    return this.underran.on(listener);
  }

  // ------------------------------------------------------------ inspection

  /** Current state of the machine (CdC §34). */
  getState(): PlaybackState {
    return this.state;
  }

  /** Zero-based index of the chunk being played, or the one that will be. */
  getCurrentIndex(): number {
    return this.currentIndex;
  }

  /** Intra-chunk resume position, kept across `pause` (CdC §35). */
  getPositionMs(): number {
    return this.positionMs;
  }

  /** Chunks of the running session, with their queue status. */
  getChunks(): readonly AudioChunk[] {
    return this.session?.chunks ?? [];
  }

  // --------------------------------------------------------------- control

  /** Prepares a session and starts playing as soon as chunk 0 is ready. */
  async start(request: PlaybackStartRequest): Promise<void> {
    this.assertUsable();
    this.teardownSession();

    const sessionId = request.sessionId ?? `session-${++this.sessionCounter}`;
    const chunks = chunksFrom(sessionId, request.segments, 0);
    const queue = new AudioQueue(
      {
        tts: request.tts,
        cache: this.cache,
        binding: bindingFrom(request.profile)
      },
      this.queueOptions
    );
    queue.reset(chunks);

    this.session = {
      id: sessionId,
      profile: request.profile,
      sink: request.sink,
      queue,
      chunks: [...queue.chunks],
      sealed: request.sealed ?? true
    };
    this.subscribeSink(request.sink);
    this.currentIndex = 0;
    this.positionMs = 0;
    this.setState("preparing");

    if (chunks.length === 0) {
      this.setState(this.session.sealed ? "completed" : "preparing");
      if (!this.session.sealed) {
        this.awaitingIndex = 0;
      }
      return;
    }
    await this.playIndex(0);
  }

  /** Suspends audio, keeping index, position, highlight and prefetch (CdC §35). */
  pause(): void {
    if (this.disposed || this.session === undefined || this.state !== "playing") {
      return;
    }
    this.session.sink.pause();
    this.setState("paused");
  }

  /** Resumes exactly where `pause()` left off. */
  resume(): void {
    if (this.disposed || this.session === undefined || this.state !== "paused") {
      return;
    }
    this.session.sink.play();
    this.setState("playing");
  }

  /** Rewinds to zero and cancels unnecessary synthesis; keeps the cache (CdC §36). */
  stop(): void {
    if (this.disposed || this.session === undefined) {
      return;
    }
    this.generation += 1;
    this.awaitingIndex = undefined;
    this.forgetPreload();
    this.session.queue.cancelAll();
    this.session.sink.stop();
    this.currentIndex = 0;
    this.positionMs = 0;
    this.setState("stopped");
  }

  /** Moves to the next chunk, or completes when the last one is done. */
  async next(): Promise<void> {
    if (this.disposed || this.session === undefined) {
      return;
    }
    const target = this.currentIndex + 1;
    if (target >= this.session.chunks.length) {
      if (this.session.sealed) {
        this.complete();
        return;
      }
      // Narration is still producing segments (CdC §63): buffer instead.
      this.generation += 1;
      this.awaitingIndex = target;
      this.forgetPreload();
      this.session.sink.stop();
      this.setState("preparing");
      return;
    }
    await this.playIndex(target);
  }

  /**
   * Within the first `previousThresholdMs` of a chunk, goes back one chunk;
   * later, restarts the current chunk — the usual media-player rewind.
   */
  async previous(): Promise<void> {
    if (this.disposed || this.session === undefined) {
      return;
    }
    const goBack =
      this.positionMs < this.previousThresholdMs && this.currentIndex > 0;
    await this.playIndex(goBack ? this.currentIndex - 1 : this.currentIndex);
  }

  /**
   * CdC §52 "Retry relance le même chunk sans recréer la session": re-attempts
   * synthesis of the chunk currently in `error` (`AudioQueue.retry`, its own
   * fresh `maxRetries` budget), without tearing down the session — unlike a
   * fresh `Pipeline.start()`, every already-`ready` chunk, the cache and the
   * queue are left exactly as they were. A no-op if the current chunk is not
   * `error` (stale click after `next()`/`Skip` already moved the cursor, or
   * the session ended).
   */
  retryCurrentChunk(): void {
    if (this.disposed || this.session === undefined) {
      return;
    }
    const chunk = this.currentChunk();
    if (chunk === undefined || chunk.status !== "error") {
      return;
    }
    this.session.queue.retry(this.currentIndex);
    void this.playIndex(this.currentIndex);
  }

  /**
   * Appends segments narrated after playback started (CdC §63), and unblocks a
   * machine parked in `preparing` waiting for them.
   */
  appendSegments(segments: readonly NarrationSegment[]): void {
    const session = this.session;
    if (this.disposed || session === undefined || segments.length === 0) {
      return;
    }
    const added = chunksFrom(session.id, segments, session.chunks.length);
    session.queue.append(added);
    session.chunks = [...session.queue.chunks];
    const waiting = this.awaitingIndex;
    if (waiting !== undefined && waiting < session.chunks.length) {
      this.awaitingIndex = undefined;
      void this.playIndex(waiting);
      return;
    }
    if (this.state === "playing" || this.state === "paused") {
      // The chunk playing was the last one known: its successor now exists.
      void this.preloadAfter(this.currentIndex, this.generation);
    }
  }

  /** Declares narration finished: reaching the end now completes the session. */
  sealSegments(): void {
    const session = this.session;
    if (this.disposed || session === undefined) {
      return;
    }
    session.sealed = true;
    if (this.awaitingIndex !== undefined) {
      this.awaitingIndex = undefined;
      this.complete();
    }
  }

  /** Idempotent teardown: cancels the queue, stops the sink, drops listeners. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.teardownSession();
    this.stateChanged.clear();
    this.chunkChanged.clear();
    this.progressed.clear();
    this.errored.clear();
    this.underran.clear();
  }

  // --------------------------------------------------------------- internals

  private assertUsable(): void {
    if (this.disposed) {
      throw new Error("PlaybackController has been disposed");
    }
  }

  private teardownSession(): void {
    for (const unsubscribe of this.sinkSubscriptions) {
      unsubscribe();
    }
    this.sinkSubscriptions = [];
    this.generation += 1;
    this.awaitingIndex = undefined;
    this.forgetPreload();
    if (this.session !== undefined) {
      this.session.queue.dispose();
      this.session.sink.stop();
      this.session = undefined;
    }
  }

  private subscribeSink(sink: AudioSink): void {
    this.sinkSubscriptions.push(
      sink.on("timeupdate", (payload) => {
        this.handleTimeUpdate(payload.chunkId, payload.positionMs);
      }),
      sink.on("started", (payload) => {
        this.handleStarted(payload.chunkId);
      }),
      sink.on("ended", (payload) => {
        void this.handleEnded(payload.chunkId);
      }),
      sink.on("underrun", (payload) => {
        this.handleUnderrun(payload.chunkId, payload.positionMs);
      }),
      sink.on("error", (payload) => {
        void this.handleSinkError(payload.chunkId, payload.message);
      })
    );
  }

  private handleTimeUpdate(chunkId: string, positionMs: number): void {
    const chunk = this.currentChunk();
    if (this.disposed || chunk === undefined || chunk.id !== chunkId) {
      return;
    }
    this.positionMs = positionMs;
    this.progressed.emit({
      positionMs,
      ...(chunk.durationMs !== undefined ? { durationMs: chunk.durationMs } : {}),
      index: this.currentIndex,
      total: this.session?.chunks.length ?? 0
    });
  }

  private async handleEnded(chunkId: string): Promise<void> {
    const chunk = this.currentChunk();
    if (
      this.disposed ||
      chunk === undefined ||
      chunk.id !== chunkId ||
      this.state !== "playing"
    ) {
      return;
    }
    chunk.status = "played";
    const preloaded = this.preloaded;
    if (preloaded !== undefined && preloaded.index === this.currentIndex + 1) {
      // The sink already holds the next chunk and chains it on its own: no
      // `load()` here, the hand-over is reported by `started`.
      preloaded.predecessorEnded = true;
      return;
    }
    await this.next();
  }

  /**
   * The sink moved on to the chunk preloaded with `enqueue()`: follow it,
   * exactly as `playIndex` would have after a `load()`, then preload the next.
   * `started` for any other chunk (the one `playIndex` loaded) is ignored.
   */
  private handleStarted(chunkId: string): void {
    const session = this.session;
    const preloaded = this.preloaded;
    if (
      this.disposed ||
      session === undefined ||
      preloaded === undefined ||
      preloaded.chunkId !== chunkId
    ) {
      return;
    }
    const previous = this.currentChunk();
    if (previous !== undefined && previous.status === "playing") {
      previous.status = "played";
    }
    this.forgetPreload();
    const generation = ++this.generation;
    this.awaitingIndex = undefined;
    this.currentIndex = preloaded.index;
    this.positionMs = 0;
    session.chunks = [...session.queue.chunks];
    const chunk = session.chunks[preloaded.index];
    if (chunk === undefined) {
      return;
    }
    chunk.status = "playing";
    this.chunkChanged.emit({
      index: preloaded.index,
      chunk,
      sourceRanges: chunk.sourceRanges
    });
    session.queue.setCursor(preloaded.index);
    void this.preloadAfter(preloaded.index, generation);
  }

  private handleUnderrun(chunkId: string, positionMs: number): void {
    if (this.disposed || this.session === undefined) {
      return;
    }
    this.underran.emit({ index: this.currentIndex, chunkId, positionMs });
  }

  private async handleSinkError(chunkId: string, message: string): Promise<void> {
    const preloaded = this.preloaded;
    if (preloaded !== undefined && preloaded.chunkId === chunkId) {
      await this.handlePreloadFailure(preloaded, message);
      return;
    }
    const chunk = this.currentChunk();
    if (this.disposed || chunk === undefined || chunk.id !== chunkId) {
      return;
    }
    chunk.status = "error";
    chunk.error = message;
    await this.handleChunkFailure(this.currentIndex, chunk, message, "playback");
  }

  /**
   * The single path that turns a ready chunk into audio. Every `await` is
   * followed by a generation check, which is what guarantees that a `stop()`,
   * a `next()` or a new `start()` can never leave two chunks playing.
   */
  private async playIndex(index: number): Promise<void> {
    const session = this.session;
    if (this.disposed || session === undefined) {
      return;
    }
    const generation = ++this.generation;
    this.awaitingIndex = undefined;
    if (this.preloaded !== undefined) {
      // A jump: whatever the sink holds after the current chunk is now wrong.
      session.sink.clearQueue();
    }
    this.forgetPreload();
    this.currentIndex = index;
    this.positionMs = 0;
    session.queue.setCursor(index);

    // A chunk already `ready` (cache hit, or synthesised ahead of time) never
    // shows a transient state: it goes straight from whatever the machine was
    // in to `playing` below, with no visible `preparing`/`buffering` blip.
    const preloaded = session.queue.chunks[index]?.status === "ready";
    if (!preloaded) {
      if (this.state === "playing") {
        // The chunk that just ended was playing and the next one is not
        // ready yet: `buffering`, not `preparing` (that state is reserved
        // for a session's very first chunk) and not a silent `playing`
        // (nothing is actually audible).
        this.setState("buffering");
      } else if (this.state !== "preparing" && this.state !== "buffering") {
        this.setState("preparing");
      }
    }

    const chunk = await session.queue.waitFor(index);
    if (this.isStale(generation)) {
      return;
    }
    session.chunks = [...session.queue.chunks];

    if (chunk.status === "error") {
      await this.handleChunkFailure(
        index,
        chunk,
        chunk.error ?? "synthesis failed",
        "synthesis"
      );
      return;
    }
    if (chunk.audioUri === undefined) {
      // Cancelled while generating: another transition already took over.
      return;
    }

    await session.sink.load(sinkChunkFrom(chunk, chunk.audioUri));
    if (this.isStale(generation)) {
      return;
    }

    chunk.status = "playing";
    session.sink.play();
    this.setState("playing");
    this.chunkChanged.emit({ index, chunk, sourceRanges: chunk.sourceRanges });
    // Re-arm the prefetch window now that the cursor really moved.
    session.queue.setCursor(index);
    void this.preloadAfter(index, generation);
  }

  /**
   * `AudioSink` v2 preloading: as soon as chunk `index` plays, waits for chunk
   * `index + 1` and hands it to the sink with `enqueue()`, so the sink chains
   * the two without the `ended`→`load` round trip that made a gap in v1.
   *
   * Bound to `generation`: any transition (jump, stop, hand-over) makes it a
   * no-op. A successor that fails synthesis, is cancelled, or is not ready
   * before `ended` is left to the regular `next()` → `playIndex` path.
   */
  private async preloadAfter(index: number, generation: number): Promise<void> {
    const session = this.session;
    const nextIndex = index + 1;
    if (
      this.isStale(generation) ||
      session === undefined ||
      this.currentIndex !== index ||
      nextIndex >= session.queue.chunks.length ||
      this.preloaded !== undefined ||
      this.preloadingIndex === nextIndex
    ) {
      return;
    }
    this.preloadingIndex = nextIndex;
    const chunk = await session.queue.waitFor(nextIndex);
    if (this.isStale(generation) || this.currentIndex !== index) {
      return;
    }
    this.preloadingIndex = undefined;
    const current = this.currentChunk();
    if (
      chunk.status === "error" ||
      chunk.audioUri === undefined ||
      (this.state !== "playing" && this.state !== "paused") ||
      current === undefined ||
      current.status !== "playing"
    ) {
      // Error, cancellation, or the current chunk already ended (the machine
      // is on its way to `playIndex`): nothing to preload.
      return;
    }
    session.chunks = [...session.queue.chunks];
    const preloaded: PreloadedChunk = {
      index: nextIndex,
      chunkId: chunk.id,
      predecessorEnded: false
    };
    // Recorded before the await: an `ended` racing the enqueue must already
    // know the sink holds the successor.
    this.preloaded = preloaded;
    try {
      await session.sink.enqueue(sinkChunkFrom(chunk, chunk.audioUri));
    } catch (error) {
      if (!this.isStale(generation) && this.preloaded === preloaded) {
        await this.handlePreloadFailure(
          preloaded,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }

  /**
   * The enqueued chunk was refused. Before its predecessor ended, it is simply
   * forgotten: `ended` then takes the regular `load()` path, which retries it.
   * After, nothing will ever start: it becomes the current chunk and goes
   * through the usual failure policy.
   */
  private async handlePreloadFailure(
    preloaded: PreloadedChunk,
    message: string
  ): Promise<void> {
    const session = this.session;
    this.forgetPreload();
    if (this.disposed || session === undefined || !preloaded.predecessorEnded) {
      return;
    }
    this.generation += 1;
    this.currentIndex = preloaded.index;
    this.positionMs = 0;
    const chunk = session.chunks[preloaded.index];
    if (chunk === undefined) {
      return;
    }
    chunk.status = "error";
    chunk.error = message;
    await this.handleChunkFailure(preloaded.index, chunk, message, "playback");
  }

  private forgetPreload(): void {
    this.preloaded = undefined;
    this.preloadingIndex = undefined;
  }

  private isStale(generation: number): boolean {
    return this.disposed || this.session === undefined || generation !== this.generation;
  }

  private async handleChunkFailure(
    index: number,
    chunk: AudioChunk,
    message: string,
    origin: PlaybackErrorInfo["origin"]
  ): Promise<void> {
    const info: PlaybackErrorInfo = { index, chunk, message, origin };
    this.errored.emit(info);
    const decision = await this.onChunkError(info);
    if (this.disposed || this.session === undefined) {
      return;
    }
    if (decision === "stop") {
      this.generation += 1;
      this.forgetPreload();
      this.session.queue.cancelAll();
      this.session.sink.stop();
      this.setState("error");
      return;
    }
    this.currentIndex = index;
    await this.next();
  }

  private complete(): void {
    if (this.session === undefined) {
      return;
    }
    this.generation += 1;
    this.forgetPreload();
    this.session.queue.cancelAll();
    this.session.sink.stop();
    this.setState("completed");
  }

  private currentChunk(): AudioChunk | undefined {
    return this.session?.chunks[this.currentIndex];
  }

  private setState(state: PlaybackState): void {
    if (this.state === state || this.disposed) {
      return;
    }
    const previous = this.state;
    this.state = state;
    this.stateChanged.emit({
      previous,
      state,
      sessionId: this.session?.id ?? ""
    });
  }
}

/** What the sink needs to play a ready chunk (`load` and `enqueue`). */
function sinkChunkFrom(chunk: AudioChunk, src: string): AudioSinkChunk {
  return {
    chunkId: chunk.id,
    src,
    ...(chunk.durationMs !== undefined ? { durationMs: chunk.durationMs } : {}),
    ...(chunk.format !== undefined ? { format: chunk.format } : {})
  };
}

/** Maps narration segments to queue chunks 1:1; chunking happened upstream. */
function chunksFrom(
  sessionId: string,
  segments: readonly NarrationSegment[],
  offset: number
): AudioChunk[] {
  return segments.map((segment, position) => ({
    id: `${sessionId}:${offset + position}`,
    sessionId,
    spokenText: segment.spokenText,
    sourceRanges: segment.sourceRanges,
    status: "pending" as const
  }));
}

/**
 * Extracts the synthesis binding a profile declares (ADR-005).
 *
 * `tts.providerId` is optional on the profile (fix(review): resolved against
 * `llmVoice.tts.provider` by `Pipeline.ttsFor`, `resolveTtsConfig`) — when the
 * profile omits it, `AudioQueueBinding.providerId` is left unset too, and
 * `AudioQueue` falls back to `tts.id` for the cache key, which is already the
 * *resolved* provider id (`Pipeline.ttsFor` builds the `TtsProvider.id` from
 * `resolveTtsConfig`'s output), never the unresolved, possibly-absent one.
 */
function bindingFrom(profile: VoiceProfile) {
  return {
    language: profile.language,
    ...(profile.tts.providerId !== undefined ? { providerId: profile.tts.providerId } : {}),
    ...(profile.tts.model !== undefined ? { model: profile.tts.model } : {}),
    ...(profile.tts.voice !== undefined ? { voice: profile.tts.voice } : {}),
    ...(profile.tts.parameters !== undefined
      ? { parameters: profile.tts.parameters }
      : {})
  };
}
