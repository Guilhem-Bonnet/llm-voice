/**
 * `NativeAudioSink`: `AudioSink` v2 (ADR-012 §3) driven by `llm-voice-core`
 * (Rust, `crates/llm-voice-core`) over the local Core v1 protocol
 * (`contracts/core-v1/`, ADR-012 §4). Commands go out over HTTP
 * (`POST /v1/{enqueue,play,pause,resume,stop,seek}`); the Core's own state
 * changes come back over one `GET /v1/ws` WebSocket, exactly the split
 * `contracts/core-v1/README.md` documents.
 *
 * Like `WebviewAudioSink`, this file may import from outside `src/playback`
 * (its Core connection is supplied by `CoreProcess.ts`), but it never
 * imports `vscode`: connection details (`baseUrl`/`wsUrl`/`token`) are
 * injected through `NativeAudioSinkDeps.connect`, so this class stays unit
 * testable against a plain HTTP+WS fake (`test/fakes/FakeCoreServer.ts`),
 * the same way `SequencedAudioSink` stays testable against `FakeAudioSink`.
 *
 * ## Format
 *
 * Every `TtsProvider` in this codebase produces `wav` (`ChatterboxProvider`,
 * `OpenAICompatibleTtsProvider`, `SystemTtsProvider`); the Core's `enqueue`
 * additionally accepts `pcm16le`, but nothing upstream ever produces it and
 * `AudioSinkChunk` carries no `sampleRate`/`channels` to describe it. A chunk
 * whose `format` is anything other than `wav`/`undefined` cannot be handed to
 * the Core today (no transcoding here) and fails fast with `error`, exactly
 * like a chunk the engine cannot decode (`AudioSink.enqueue`'s contract: "An
 * enqueued chunk that fails is dropped from the queue; it never produces
 * `started`").
 *
 * ## Preloading and the Core's queue (ADR-012 §3, the `enqueue()` contract)
 *
 * The Core has no "insert at front of an already-open device stream" or
 * "dequeue" verb: once a segment is POSTed via `enqueue`, it is folded into
 * the open `cpal` stream and can only be replaced by `stop`ping the whole
 * queue (`crates/llm-voice-core/src/engine.rs`'s `Command::Stop` clears every
 * segment, not just the one playing). `AudioSinkChunk`s accepted by this
 * sink's own `enqueue()` are therefore **not** POSTed to the Core right
 * away: they sit in `pending` (plain array, this class's own queue — same
 * idea as `FakeAudioSink`/`SequencedAudioSink`'s `pending`) until the
 * *current* chunk's `segment_started` event confirms the Core is already
 * playing it, at which point the head of `pending` is POSTed
 * (`trySendAhead()`). That keeps `clearQueue()` meaningful (it only ever
 * drops chunks this class hasn't sent yet) at the cost of one documented gap:
 * a chunk already handed to the Core by `trySendAhead()` (tracked in
 * `sentAheadChunkId`) cannot be un-enqueued by a later `clearQueue()` — there
 * is no protocol verb for it (flagged in this task's evidence-pack for a
 * follow-up card). In practice `PlaybackController.preloadAfter` enqueues at
 * most one chunk ahead, so this window is exactly one `AudioSinkChunk` wide.
 *
 * ## Event mapping (Core v1 → `AudioSinkEventMap`)
 *
 * | Core v1 (`contracts/core-v1/ws/*.schema.json`) | `AudioSink` v2 |
 * |---|---|
 * | `segment_started { segmentId, positionMs }` | `started { chunkId: segmentId }` |
 * | `segment_ended { segmentId, positionMs }` (drain-aware, CL-004) | `ended { chunkId: segmentId }` |
 * | `position { segmentId, positionMs }` | `timeupdate { chunkId: segmentId, positionMs }` |
 * | `underrun { segmentId?, positionMs }` | `underrun { chunkId: segmentId ?? current, positionMs }` |
 * | `error { segmentId?, code, message }` | `error { chunkId: segmentId ?? current, message }` |
 * | `state`, top-level `ended` | not translated (the per-segment events above already cover every `AudioSink` v2 transition; `ended` fires for the last segment at the exact same drained tick as `segment_ended`, see `engine.rs::tick`) |
 *
 * `play()`/`pause()` map to `/v1/play` (or `/v1/resume` when the previous
 * command was `pause()`) and `/v1/pause` — the Core's README distinguishes
 * the two ("`resume` reprend ... à la position gelée" vs "`play` démarre ou
 * reprend ... sur la position courante"); `AudioSink` v2 only exposes one
 * `play()`, so this class remembers its own `paused` intent to pick the
 * right verb, the same "intent" bookkeeping `SequencedAudioSink`/
 * `FakeAudioSink` already do.
 *
 * ## Transport
 *
 * Uses the **global** `fetch`/`WebSocket` (stable in Node ≥ 22, this
 * project's floor: `package.json#engines.node`, `scripts/esbuild.mjs`'s
 * `target: "node22"`, already how `EgressGuard`/`AssetDownloader` call
 * `fetch` elsewhere in this codebase) rather than the `ws` package: no new
 * runtime dependency, nothing extra for esbuild to bundle. Verified against
 * a hand-rolled RFC 6455 server in `test/fakes/FakeCoreServer.ts` (Node's
 * `http` module has no server-side WebSocket helper, unlike the built-in
 * client) — see this task's evidence-pack for the throwaway script that
 * proved the global client talks to a minimal server-side handshake+text-frame
 * writer before this file was written. If the real VS Code extension host's
 * bundled Node ever turns out to lack a global `WebSocket` (Electron's Node
 * can lag the `engines.node` floor declared here), swapping in the `ws`
 * package (MIT) behind the same `createWebSocket` hook is a one-line change
 * — flagged as a risk to verify before `llmVoice.audio.engine`'s default
 * ever flips to `"native"`.
 */

import type { AudioFormat } from "../core/tts.js";
import type {
  AudioSink,
  AudioSinkChunk,
  AudioSinkEvent,
  AudioSinkEventMap,
  AudioSinkListener
} from "./AudioSink.js";
import { Emitter, type Unsubscribe } from "./emitter.js";

/** `protocolVersion` this class speaks (`contracts/core-v1/common.schema.json`). */
export const CORE_PROTOCOL_VERSION = "1.0";

/** What `NativeAudioSinkDeps.connect` resolves: enough to reach a live Core. */
export interface NativeCoreConnection {
  /** `http://127.0.0.1:<port>` (no trailing slash). */
  baseUrl: string;
  /** `ws://127.0.0.1:<port>/v1/ws` (no query string: the token is appended here). */
  wsUrl: string;
  token: string;
}

/** Minimal logger this class needs; `Logger` (`infrastructure/logger.ts`) satisfies it. */
export interface NativeAudioSinkLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface NativeAudioSinkDeps {
  /**
   * Resolves a live Core connection, spawning or attaching to one if needed
   * (`CoreProcess.ensureRunning`). Called again after a WebSocket drop, so it
   * must be safe to call repeatedly and must return fresh connection details
   * after a Core restart.
   */
  connect: () => Promise<NativeCoreConnection>;
  /** Test seam; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Test seam; defaults to `(url) => new WebSocket(url)`. */
  createWebSocket?: (url: string) => WebSocket;
  log?: NativeAudioSinkLogger;
}

type Intent = "idle" | "paused" | "playing";

/** `contracts/core-v1/http/ack.response.schema.json`. */
interface AckResponse {
  protocolVersion: string;
  ok: boolean;
  error?: { code: string; message: string };
}

/** The seven `contracts/core-v1/ws/*.event.schema.json` shapes, tagged by `type`. */
type CoreWsEvent =
  | { type: "state"; state: string; positionMs: number }
  | { type: "position"; segmentId: string; positionMs: number }
  | { type: "segment_started"; segmentId: string; positionMs: number }
  | { type: "segment_ended"; segmentId: string; positionMs: number }
  | { type: "underrun"; positionMs: number; segmentId?: string }
  | { type: "ended"; positionMs: number; totalDurationMs: number }
  | { type: "error"; code: string; message: string; segmentId?: string };

/** Bounded reconnect attempts after an unexpected WebSocket close. */
/**
 * `contracts/core-v1` restricts `segmentId` to `^[A-Za-z0-9_-]+$`, while the
 * pipeline's chunk ids look like `session-4:0` (field report, 2026-09-29:
 * every enqueue refused with `invalid_request`). Reversible encoding: every
 * character outside `[A-Za-z0-9-]` — `_` included, so decoding is
 * unambiguous — becomes `_<hex code point>_` (`:` → `_3a_`).
 */
export function encodeSegmentId(chunkId: string): string {
  let out = "";
  for (const char of chunkId) {
    out += /[A-Za-z0-9-]/.test(char) ? char : `_${(char.codePointAt(0) ?? 0).toString(16)}_`;
  }
  return out;
}

/** Inverse of `encodeSegmentId`. */
export function decodeSegmentId(segmentId: string): string {
  return segmentId.replace(/_([0-9a-f]+)_/g, (_match, hex: string) => String.fromCodePoint(parseInt(hex, 16)));
}

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 200;

function defaultCreateWebSocket(url: string): WebSocket {
  return new WebSocket(url);
}

export class NativeAudioSink implements AudioSink {
  readonly gapless = true;

  private readonly emitters: { [E in AudioSinkEvent]: Emitter<AudioSinkEventMap[E]> } = {
    timeupdate: new Emitter(),
    started: new Emitter(),
    ended: new Emitter(),
    underrun: new Emitter(),
    error: new Emitter()
  };

  private readonly fetchImpl: typeof fetch;
  private readonly createWebSocket: (url: string) => WebSocket;
  private readonly log: NativeAudioSinkLogger | undefined;

  private connection: NativeCoreConnection | undefined;
  private connecting: Promise<NativeCoreConnection> | undefined;
  private ws: WebSocket | undefined;
  private disposed = false;
  private reconnectAttempts = 0;

  /** Chunk the Core is currently (or about to start) playing. */
  private current: { chunkId: string; started: boolean } | undefined;
  /** Chunks accepted by `enqueue()` but not yet POSTed to the Core. */
  private readonly pending: AudioSinkChunk[] = [];
  /** The one chunk already POSTed ahead of `current` (see class doc). */
  private sentAheadChunkId: string | undefined;
  private intent: Intent = "idle";
  private starved = false;
  private lastPositionMs = 0;

  constructor(private readonly deps: NativeAudioSinkDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.createWebSocket = deps.createWebSocket ?? defaultCreateWebSocket;
    this.log = deps.log;
  }

  async load(chunk: AudioSinkChunk): Promise<void> {
    this.pending.length = 0;
    this.sentAheadChunkId = undefined;
    this.starved = false;
    // Not `"paused"`: the Core's queue is fresh (`Command::Stop` then a brand
    // new `Player`, `llm-voice-audio`'s `TrackQueue::new` state `Stopped`).
    // `TrackQueue::resume()` only transitions out of `Paused` — calling
    // `/v1/resume` here would be a no-op. `play()` picks the right verb from
    // `intent` below: `"idle"` → `/v1/play`, `"paused"` (a real prior
    // `pause()`) → `/v1/resume`.
    this.intent = "idle";
    this.lastPositionMs = 0;
    if (!this.isPlayableFormat(chunk.format)) {
      this.current = undefined;
      this.emitError(chunk.chunkId, `NativeAudioSink: format non pris en charge (${String(chunk.format)})`);
      return;
    }
    this.current = { chunkId: chunk.chunkId, started: false };
    // A refusal by the Core (ack `ok: false`, HTTP >= 400) or a network
    // failure is this chunk failing, not `load()` failing: it surfaces as an
    // `error` event so the controller's failure policy (CdC §52) runs. A
    // rejection here used to leave the controller parked in `preparing`
    // (GAO-bogue-un-seg-001).
    try {
      await this.post("stop", {});
      await this.sendEnqueue(chunk);
    } catch (error) {
      this.emitError(chunk.chunkId, this.errorMessage(error));
    }
  }

  async enqueue(chunk: AudioSinkChunk): Promise<void> {
    if (!this.isPlayableFormat(chunk.format)) {
      this.emitError(chunk.chunkId, `NativeAudioSink: format non pris en charge (${String(chunk.format)})`);
      return;
    }
    if (this.current === undefined || this.starved) {
      const previous = { current: this.current, starved: this.starved };
      this.starved = false;
      this.current = { chunkId: chunk.chunkId, started: false };
      // The Core auto-resumes a starved queue as soon as a segment lands
      // (`engine.rs::enqueue`'s `starved` branch calls `player.play()`
      // itself); nothing else to do here for that case. When there was no
      // player at all yet (`this.current` was `undefined`, an unusual entry
      // point since `PlaybackController` always `load()`s first), the Core
      // creates one paused, matching `load()`'s contract.
      try {
        await this.sendEnqueue(chunk);
      } catch (error) {
        // Refused: the Core never got this chunk, so the sink is still in the
        // state it was in (starved / no player) and an `error` event tells the
        // controller, like a chunk the engine cannot decode.
        this.current = previous.current;
        this.starved = previous.starved;
        this.emitError(chunk.chunkId, this.errorMessage(error));
      }
      return;
    }
    this.pending.push(chunk);
    this.trySendAhead();
  }

  clearQueue(): void {
    // Only drops what this class hasn't handed to the Core yet — see the
    // class doc's "Preloading and the Core's queue" section for the one
    // known gap (a chunk already in `sentAheadChunkId`).
    this.pending.length = 0;
  }

  play(): void {
    if (this.current === undefined) {
      return;
    }
    const verb = this.intent === "paused" ? "resume" : "play";
    this.intent = "playing";
    if (this.starved) {
      // Matches `AudioSink` v2: "stays in play intent"; the next `enqueue()`
      // starts at once (Core-side auto-resume), no command to send now.
      return;
    }
    const chunkId = this.current.chunkId;
    void this.post(verb, {}).catch((error: unknown) => {
      this.emitError(chunkId, this.errorMessage(error));
    });
  }

  pause(): void {
    if (this.intent === "playing") {
      this.intent = "paused";
    }
    const current = this.current;
    if (current !== undefined) {
      void this.post("pause", {}).catch((error: unknown) => {
        this.emitError(current.chunkId, this.errorMessage(error));
      });
      if (current.started) {
        // Best effort, like `SequencedAudioSink`: the last position this
        // class observed via `position` events. The Core emits no `position`
        // once paused (`engine.rs::tick` only reports it while `Playing`).
        this.emitters.timeupdate.emit({ chunkId: current.chunkId, positionMs: this.lastPositionMs });
      }
    }
  }

  stop(): void {
    this.pending.length = 0;
    this.current = undefined;
    this.sentAheadChunkId = undefined;
    this.starved = false;
    this.intent = "idle";
    this.lastPositionMs = 0;
    void this.post("stop", {}).catch((error: unknown) => {
      this.log?.warn("NativeAudioSink: stop failed", { error: this.errorMessage(error) });
    });
  }

  seek(positionMs: number): void {
    this.lastPositionMs = positionMs;
    const chunkId = this.current?.chunkId;
    void this.post("seek", { positionMs }).catch((error: unknown) => {
      if (chunkId !== undefined) {
        this.emitError(chunkId, this.errorMessage(error));
      }
    });
  }

  on<E extends AudioSinkEvent>(event: E, handler: AudioSinkListener<E>): Unsubscribe {
    return (this.emitters[event] as Emitter<AudioSinkEventMap[E]>).on(handler);
  }

  /** Closes the WebSocket; does not stop the Core (see `CoreProcess.dispose`). */
  dispose(): void {
    this.disposed = true;
    this.ws?.close();
    this.ws = undefined;
  }

  // --------------------------------------------------------------- internals

  private isPlayableFormat(format: AudioFormat | undefined): boolean {
    return format === undefined || format === "wav";
  }

  private trySendAhead(): void {
    if (this.sentAheadChunkId !== undefined) {
      return;
    }
    if (this.current === undefined || !this.current.started) {
      return;
    }
    const next = this.pending.shift();
    if (next === undefined) {
      return;
    }
    if (!this.isPlayableFormat(next.format)) {
      this.emitError(next.chunkId, `NativeAudioSink: format non pris en charge (${String(next.format)})`);
      this.trySendAhead();
      return;
    }
    this.sentAheadChunkId = next.chunkId;
    void this.sendEnqueue(next).catch((error: unknown) => {
      const failed = this.sentAheadChunkId;
      this.sentAheadChunkId = undefined;
      if (failed !== undefined) {
        this.emitError(failed, this.errorMessage(error));
      }
      this.trySendAhead();
    });
  }

  private async sendEnqueue(chunk: AudioSinkChunk): Promise<void> {
    await this.post("enqueue", {
      segmentId: encodeSegmentId(chunk.chunkId),
      path: chunk.src,
      format: "wav"
    });
  }

  private emitError(chunkId: string, message: string): void {
    this.emitters.error.emit({ chunkId, message });
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private async post(path: string, body: Record<string, unknown>): Promise<void> {
    const connection = await this.ensureConnected();
    const response = await this.fetchImpl(`${connection.baseUrl}/v1/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        protocolVersion: CORE_PROTOCOL_VERSION,
        token: connection.token,
        ...body
      })
    });
    const json = (await response.json()) as AckResponse;
    if (!json.ok) {
      const error = json.error;
      throw new Error(
        error === undefined
          ? `Core: ${path} rejected (HTTP ${response.status})`
          : `Core: ${path} refused (${error.code}): ${error.message}`
      );
    }
  }

  private async ensureConnected(): Promise<NativeCoreConnection> {
    if (this.connection !== undefined) {
      return this.connection;
    }
    this.connecting ??= this.doConnect();
    return this.connecting;
  }

  private async doConnect(): Promise<NativeCoreConnection> {
    try {
      const connection = await this.deps.connect();
      await this.openSocket(connection);
      this.connection = connection;
      this.reconnectAttempts = 0;
      return connection;
    } finally {
      this.connecting = undefined;
    }
  }

  private openSocket(connection: NativeCoreConnection): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${connection.wsUrl}?token=${encodeURIComponent(connection.token)}`;
      const socket = this.createWebSocket(url);
      let settled = false;
      socket.addEventListener("open", () => {
        settled = true;
        this.ws = socket;
        resolve();
      });
      socket.addEventListener("message", (event: MessageEvent) => {
        this.handleWsMessage(String(event.data));
      });
      socket.addEventListener("close", () => {
        this.ws = undefined;
        if (!settled) {
          reject(new Error("Core: WebSocket closed before it opened"));
          return;
        }
        this.handleUnexpectedClose();
      });
      socket.addEventListener("error", () => {
        if (!settled) {
          reject(new Error("Core: WebSocket failed to connect"));
        }
      });
    });
  }

  private handleUnexpectedClose(): void {
    if (this.disposed) {
      return;
    }
    this.connection = undefined;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      const chunkId = this.current?.chunkId;
      if (chunkId !== undefined) {
        this.emitError(chunkId, "Core: WebSocket unreachable after several attempts");
      }
      return;
    }
    this.reconnectAttempts += 1;
    setTimeout(() => {
      if (!this.disposed) {
        void this.ensureConnected().catch((error: unknown) => {
          this.log?.warn("NativeAudioSink: reconnect failed", { error: this.errorMessage(error) });
        });
      }
    }, RECONNECT_DELAY_MS);
  }

  private handleWsMessage(raw: string): void {
    let event: CoreWsEvent;
    try {
      event = JSON.parse(raw) as CoreWsEvent;
    } catch {
      this.log?.warn("NativeAudioSink: malformed WebSocket message", { raw });
      return;
    }
    if ("segmentId" in event && typeof event.segmentId === "string") {
      event = { ...event, segmentId: decodeSegmentId(event.segmentId) } as CoreWsEvent;
    }
    switch (event.type) {
      case "segment_started":
        this.handleSegmentStarted(event.segmentId);
        break;
      case "segment_ended":
        this.emitters.ended.emit({ chunkId: event.segmentId });
        break;
      case "position":
        this.lastPositionMs = event.positionMs;
        this.emitters.timeupdate.emit({ chunkId: event.segmentId, positionMs: event.positionMs });
        break;
      case "underrun":
        this.starved = true;
        this.emitters.underrun.emit({
          chunkId: event.segmentId ?? this.current?.chunkId ?? "",
          positionMs: event.positionMs
        });
        break;
      case "error":
        this.emitError(event.segmentId ?? this.current?.chunkId ?? "", event.message);
        break;
      case "state":
      case "ended":
        // Not translated: every `AudioSink` v2 transition is already covered
        // by `segment_started`/`segment_ended`/`underrun` above (class doc).
        break;
      default: {
        const exhaustive: never = event;
        void exhaustive;
      }
    }
  }

  private handleSegmentStarted(segmentId: string): void {
    this.emitters.started.emit({ chunkId: segmentId });
    if (this.current?.chunkId === segmentId) {
      this.current.started = true;
      this.trySendAhead();
      return;
    }
    if (this.sentAheadChunkId === segmentId) {
      this.current = { chunkId: segmentId, started: true };
      this.sentAheadChunkId = undefined;
      this.trySendAhead();
    }
  }
}
