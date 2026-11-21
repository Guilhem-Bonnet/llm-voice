/**
 * Passive webview-backed audio sink (ADR-001, D4).
 *
 * Implements the v1 `LegacyAudioSink` (`src/playback/AudioSink.ts`): the
 * `<audio>` element plays one source at a time. `PlayerViewProvider` wraps it
 * in a `SequencedAudioSink` to offer the `AudioSink` v2 contract (preloading,
 * `started`, `underrun`) to `PlaybackController`, which then drives the real
 * Player webview exactly like it drives `FakeAudioSink` in tests (S3.5 wiring,
 * ADR-012 §3: the webview engine is the explicit fallback). It only speaks the wire protocol defined in
 * `src/core/playback.ts`; it owns no queue, no state machine, and no cache —
 * that lives in the Extension Host per ADR-001.
 *
 * `AudioSinkChunk.src` is the absolute cache file path (`AudioSink.ts`, v2);
 * the webview needs a `webview.asWebviewUri(...)` URI instead. Since only the
 * attached `vscode.Webview` can compute that conversion, and
 * `PlaybackController`/`AudioQueue` stay free of any `vscode` import
 * (ADR-005), this sink treats `chunk.src` as the absolute filesystem path
 * returned by the `AudioCacheStore` (`DiskAudioCache.put()`) and performs the
 * `asWebviewUri` conversion itself, right before posting the `load` message.
 * That keeps the conversion encapsulated in the one class that already
 * touches `vscode.Webview`, without leaking it into the pure playback layer.
 *
 * Beyond the `LegacyAudioSink` surface (`timeupdate`/`ended`/`error`), this sink
 * also exposes `onUserAction` for the mini-player's transport buttons
 * (`userAction` in `WebviewToExtensionMessage`), which `AudioSink`
 * deliberately does not model since it is a webview-only concern.
 */

import { access } from "node:fs/promises";
import * as vscode from "vscode";
import type {
  ExtensionToWebviewMessage,
  PlayerDocumentView,
  PlayerStateView,
  PlayerUserAction,
  WebviewToExtensionMessage
} from "../core/playback.js";
import type {
  AudioSinkChunk,
  LegacyAudioSink,
  LegacyAudioSinkEvent,
  LegacyAudioSinkEventMap
} from "./AudioSink.js";
import { Emitter, type Unsubscribe } from "./emitter.js";

/** Bridges `AudioSink` calls to `postMessage` against a single webview. */
export class WebviewAudioSink implements LegacyAudioSink {
  private webview: vscode.Webview | undefined;
  private webviewReady = false;

  private readonly timeupdateEmitter = new Emitter<LegacyAudioSinkEventMap["timeupdate"]>();
  private readonly endedEmitter = new Emitter<LegacyAudioSinkEventMap["ended"]>();
  private readonly errorEmitter = new Emitter<LegacyAudioSinkEventMap["error"]>();
  private readonly userActionEmitter = new Emitter<PlayerUserAction>();
  private readonly readyEmitter = new Emitter<void>();

  /** Binds this sink to a live webview and starts forwarding its messages. */
  attach(webview: vscode.Webview): vscode.Disposable {
    this.webview = webview;
    this.webviewReady = false;
    return webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
      this.dispatch(message);
    });
  }

  /**
   * Releases the webview reference; queued `on()` listeners stay registered.
   * Given a `webview`, only if it is still the one this sink routes to: the
   * two player views share one sink, and a stale one disposing must not null
   * out the live one (PR #64, GAO-diagnostic-s-001). Without an argument,
   * detaches unconditionally.
   */
  detach(webview?: vscode.Webview): void {
    if (webview !== undefined && webview !== this.webview) {
      return;
    }
    this.webview = undefined;
    this.webviewReady = false;
  }

  /**
   * A chunk that cannot be handed to the webview is this chunk failing, not
   * `load()` failing: it surfaces as an `error` event, as with
   * `NativeAudioSink`, so the controller's failure policy runs and names the
   * cause (PR #64, GAO-diagnostic-s-001). It used to `return` in silence with
   * no view attached, and the highlight then ran over no sound at all.
   */
  async load(chunk: AudioSinkChunk): Promise<void> {
    if (this.webview === undefined) {
      this.emitLoadError(chunk, "aucune vue du lecteur n'est ouverte (« Lecture en cours »)");
      return;
    }
    // A cache file gone before playback reached it (eviction racing the
    // queue) is reported by `<audio>` as an opaque « code 4 »: say it here.
    try {
      await access(chunk.src);
    } catch {
      this.emitLoadError(chunk, `fichier audio absent du cache (${chunk.src}) — évincé ou jamais écrit`);
      return;
    }
    // Re-read after the await: the URI and the message must target the same
    // webview, even if another view resolved meanwhile.
    const target = this.webview;
    if (target === undefined) {
      this.emitLoadError(chunk, "la vue du lecteur s'est fermée pendant le chargement");
      return;
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

  private emitLoadError(chunk: AudioSinkChunk, reason: string): void {
    this.errorEmitter.emit({ chunkId: chunk.chunkId, message: `WebviewAudioSink : ${reason}` });
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

  /** The open document, for the panel's "Document ouvert" block. Starts nothing. */
  pushDocument(document: PlayerDocumentView | null): void {
    this.post({ type: "document", document });
  }

  on<E extends LegacyAudioSinkEvent>(
    event: E,
    handler: (payload: LegacyAudioSinkEventMap[E]) => void
  ): Unsubscribe {
    type Handler<K extends LegacyAudioSinkEvent> = (payload: LegacyAudioSinkEventMap[K]) => void;
    switch (event) {
      case "timeupdate":
        return this.timeupdateEmitter.on(handler as Handler<"timeupdate">);
      case "ended":
        return this.endedEmitter.on(handler as Handler<"ended">);
      case "error":
        return this.errorEmitter.on(handler as Handler<"error">);
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
