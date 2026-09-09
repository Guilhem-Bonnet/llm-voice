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
 *  - `dispose` is idempotent and silences every event.
 */

import type { AudioChunk, PlaybackState } from "../core/playback.js";
import type { NarrationSegment } from "../core/narration.js";
import type { VoiceProfile } from "../core/profile.js";
import type { SourceRange } from "../core/source.js";
import type { TtsProvider } from "../core/tts.js";
import type { AudioSink } from "./AudioSink.js";
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

const DEFAULT_PREVIOUS_THRESHOLD_MS = 2000;

export class PlaybackController {
  private readonly stateChanged = new Emitter<PlaybackStateChange>();
  private readonly chunkChanged = new Emitter<ChunkChange>();
  private readonly progressed = new Emitter<PlaybackProgress>();
  private readonly errored = new Emitter<PlaybackErrorInfo>();

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
      sink.on("ended", (payload) => {
        void this.handleEnded(payload.chunkId);
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
    await this.next();
  }

  private async handleSinkError(chunkId: string, message: string): Promise<void> {
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

    await session.sink.load({
      chunkId: chunk.id,
      src: chunk.audioUri,
      ...(chunk.durationMs !== undefined ? { durationMs: chunk.durationMs } : {}),
      ...(chunk.format !== undefined ? { format: chunk.format } : {})
    });
    if (this.isStale(generation)) {
      return;
    }

    chunk.status = "playing";
    session.sink.play();
    this.setState("playing");
    this.chunkChanged.emit({ index, chunk, sourceRanges: chunk.sourceRanges });
    // Re-arm the prefetch window now that the cursor really moved.
    session.queue.setCursor(index);
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
