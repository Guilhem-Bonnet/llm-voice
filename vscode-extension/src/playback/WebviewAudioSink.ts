/**
 * Passive webview-backed audio sink (ADR-001, D4).
 *
 * Implements `AudioSink` (`src/playback/AudioSink.ts`) so `PlaybackController`
 * can drive the real Player webview exactly like it drives `FakeAudioSink` in
 * tests (S3.5 wiring). It only speaks the wire protocol defined in
 * `src/core/playback.ts`; it owns no queue, no state machine, and no cache —
 * that lives in the Extension Host per ADR-001.
 *
 * `AudioSinkChunk.src` is documented as "the location the sink can read;
 * `webview.asWebviewUri(...)` in production" (`AudioSink.ts`). Since only the
 * attached `vscode.Webview` can compute that conversion, and
 * `PlaybackController`/`AudioQueue` stay free of any `vscode` import
 * (ADR-005), this sink treats `chunk.src` as the absolute filesystem path
 * returned by the `AudioCacheStore` (`DiskAudioCache.put()`) and performs the
 * `asWebviewUri` conversion itself, right before posting the `load` message.
 * That keeps the conversion encapsulated in the one class that already
 * touches `vscode.Webview`, without leaking it into the pure playback layer.
 *
 * Beyond the `AudioSink` surface (`timeupdate`/`ended`/`error`), this sink
 * also exposes `onUserAction` for the mini-player's transport buttons
 * (`userAction` in `WebviewToExtensionMessage`), which `AudioSink`
 * deliberately does not model since it is a webview-only concern.
 */

import { access } from "node:fs/promises";
import * as vscode from "vscode";
import type {
  ExtensionToWebviewMessage,
  PlayerStateView,
  PlayerUserAction,
  WebviewToExtensionMessage
} from "../core/playback.js";
import type {
  AudioSink,
  AudioSinkChunk,
  AudioSinkEvent,
  AudioSinkEventMap,
  AudioSinkListener
} from "./AudioSink.js";
import { Emitter, type Unsubscribe } from "./emitter.js";
import type { Logger } from "../infrastructure/logger.js";

/** Bridges `AudioSink` calls to `postMessage` against a single webview. */
export class WebviewAudioSink implements AudioSink {
  private webview: vscode.Webview | undefined;
  private webviewReady = false;

  /**
   * GAO-diagnostic-s-001: optional, diagnostic-only. When set, every
   * webview-reported `error` also gets a `debug` record (see
   * `WebviewToExtensionMessage`'s `error.debug`) written at `debug` level —
   * the URI actually assigned to `audio.src` and the status/content-type/
   * body-preview of a `fetch()` on that same URI from inside the webview.
   */
  constructor(private readonly logger?: Logger) {}

  private readonly timeupdateEmitter = new Emitter<AudioSinkEventMap["timeupdate"]>();
  private readonly endedEmitter = new Emitter<AudioSinkEventMap["ended"]>();
  private readonly errorEmitter = new Emitter<AudioSinkEventMap["error"]>();
  private readonly userActionEmitter = new Emitter<PlayerUserAction>();
  private readonly readyEmitter = new Emitter<void>();

  /**
   * Binds this sink to a live webview and starts forwarding its messages.
   *
   * GAO-diagnostic-s-001: the Panel mini-player (`llmVoice.player`) and the
   * dedicated view (`llmVoice.playerView`) can both be resolved at once —
   * two independent `vscode.Webview` instances, each with its own
   * `asWebviewUri()` origin. `attach()` keeps "last resolved wins" as the
   * active target (an explicit, narrow, still-documented limitation: only
   * one of the two ever receives `load`/`play`/... while both are open) —
   * what it no longer does is let the *stale* one silently corrupt state
   * later; see `detach()`.
   */
  attach(webview: vscode.Webview): vscode.Disposable {
    this.webview = webview;
    this.webviewReady = false;
    return webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
      this.dispatch(message);
    });
  }

  /**
   * Releases the webview reference — but only if `webview` is still the one
   * this sink is actually routing to. GAO-diagnostic-s-001: before this
   * guard, `PlayerViewProvider`'s two `resolveWebviewView` registrations
   * both called `detach()` unconditionally from their own `onDidDispose`.
   * A *stale* view (already superseded when the other one resolved) closing
   * — panel auto-hide, container GC, anything — would then null out the
   * reference to the still-alive, still-visible view's webview mid-session,
   * so the next `load()` either threw "no player view attached" or forced
   * `PlayerViewProvider.reveal()` to re-resolve a *different* webview
   * instance than the one on screen, forging `asWebviewUri()` for one origin
   * while the user was looking at another — Chromium reports that mismatch
   * as opaque `MEDIA_ERR_SRC_NOT_SUPPORTED` (error code 4). No `webview`
   * argument still detaches unconditionally (test-only convenience, see
   * `test/integration-security/audio-diagnostic.test.ts`).
   */
  detach(webview?: vscode.Webview): void {
    if (webview !== undefined && webview !== this.webview) {
      return;
    }
    this.webview = undefined;
    this.webviewReady = false;
  }

  async load(chunk: AudioSinkChunk): Promise<void> {
    if (this.webview === undefined) {
      // fix(playback): used to `return` in silence (GAO-diagnostic-s-001) —
      // `PlaybackController` would then mark the chunk `playing` and emit
      // `chunkChanged` for a highlight nothing backs, with zero audio and
      // zero error. No webview attached is exactly the state a document
      // opened before the "Lecture en cours" view ever resolved is in: a
      // real, nameable failure, not a no-op.
      throw new Error(
        `WebviewAudioSink: no player view attached for chunk ${chunk.chunkId} — the "Lecture en cours" view could not be reached`
      );
    }
    // GAO-diagnostic-s-001: a byte-for-byte copy of a real field-reported WAV
    // plays cleanly through this exact webview pipeline (see
    // `test/integration-security/audio-diagnostic.test.ts`), which rules out
    // the file's own contents. What that experiment does not rule out is a
    // `chunk.src` that names a file no longer on disk at the moment `load()`
    // actually runs — e.g. `DiskAudioCache`'s best-effort eviction
    // (`evictIfOverBudget`, fired-and-forgotten after every `put()`) racing a
    // chunk still queued between synthesis and playback. Chromium's
    // `<audio>` reports exactly that as `MEDIA_ERR_SRC_NOT_SUPPORTED` (code
    // 4) with no further detail, which is indistinguishable, from the
    // player's side, from a genuinely malformed file. Fail loudly and
    // specifically here instead of letting the webview guess.
    try {
      await access(chunk.src);
    } catch {
      throw new Error(
        `WebviewAudioSink: cache file missing for chunk ${chunk.chunkId} at ${chunk.src} — ` +
          "evicted or never written before playback reached it"
      );
    }
    // GAO-diagnostic-s-001, fix (3): re-read `this.webview` *after* the
    // `await` above and forge/post through that exact same reference — a
    // second webview resolving while this `load()` was awaiting `access()`
    // must never leave the `asWebviewUri()` origin and the `postMessage()`
    // target pointing at two different webviews.
    const target = this.webview;
    if (target === undefined) {
      throw new Error(
        `WebviewAudioSink: no player view attached for chunk ${chunk.chunkId} — ` +
          "the view was detached while the cache file was being checked"
      );
    }
    const src = target.asWebviewUri(vscode.Uri.file(chunk.src)).toString();
    const message: ExtensionToWebviewMessage = {
      type: "load",
      chunkId: chunk.chunkId,
      src,
      autoplay: true,
      ...(chunk.durationMs !== undefined ? { durationMs: chunk.durationMs } : {})
    };
    void target.postMessage(message);
  }

  play(): void {
    this.post({ type: "play" });
  }

  pause(): void {
    this.post({ type: "pause" });
  }

  stop(): void {
    this.post({ type: "stop" });
  }

  seek(positionMs: number): void {
    this.post({ type: "seek", positionMs });
  }

  setRate(value: number): void {
    this.post({ type: "setRate", value });
  }

  setVolume(value: number): void {
    this.post({ type: "setVolume", value });
  }

  /** Pushes a mini-player snapshot (title, profile, index/total, state). */
  pushState(state: PlayerStateView): void {
    this.post({ type: "state", state });
  }

  on<E extends AudioSinkEvent>(event: E, handler: AudioSinkListener<E>): Unsubscribe {
    switch (event) {
      case "timeupdate":
        return this.timeupdateEmitter.on(handler as AudioSinkListener<"timeupdate">);
      case "ended":
        return this.endedEmitter.on(handler as AudioSinkListener<"ended">);
      case "error":
        return this.errorEmitter.on(handler as AudioSinkListener<"error">);
      default: {
        const exhaustive: never = event;
        throw new Error(`WebviewAudioSink: unsupported event ${String(exhaustive)}`);
      }
    }
  }

  /** Mini-player transport buttons (play/pause/stop/next/prev/selectProfile). */
  onUserAction(handler: (action: PlayerUserAction) => void): Unsubscribe {
    return this.userActionEmitter.on(handler);
  }

  /** Fires once the webview script has attached its message listener. */
  onReady(handler: () => void): Unsubscribe {
    return this.readyEmitter.on(handler);
  }

  get isReady(): boolean {
    return this.webviewReady;
  }

  private dispatch(message: WebviewToExtensionMessage): void {
    switch (message.type) {
      case "ready":
        this.webviewReady = true;
        this.readyEmitter.emit(undefined);
        break;
      case "timeupdate":
        this.timeupdateEmitter.emit({ chunkId: message.chunkId, positionMs: message.positionMs });
        break;
      case "ended":
        this.endedEmitter.emit({ chunkId: message.chunkId });
        break;
      case "error":
        if (message.debug !== undefined) {
          this.logger?.debug(`WebviewAudioSink: playback error for chunk ${message.chunkId}`, message.debug);
        }
        this.errorEmitter.emit({ chunkId: message.chunkId, message: message.message });
        break;
      case "userAction":
        this.userActionEmitter.emit(message.action);
        break;
      default: {
        const exhaustive: never = message;
        void exhaustive;
      }
    }
  }

  private post(message: ExtensionToWebviewMessage): void {
    void this.webview?.postMessage(message);
  }
}
