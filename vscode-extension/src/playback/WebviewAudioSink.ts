/**
 * Passive webview-backed audio sink (ADR-001, D4).
 *
 * This class only speaks the wire protocol defined in `src/core/playback.ts`
 * to the Player webview (`PlayerViewProvider`); it owns no queue, no state
 * machine, and no cache — that lives in the Extension Host per ADR-001.
 *
 * TODO(S3.5): align `AudioSinkLike` with the real `src/playback/AudioSink.ts`
 * once the synthesis/queue pipeline (S3.1-S3.3) lands, and wire this sink
 * behind it instead of behind `NotWiredPipeline`.
 */

import * as vscode from "vscode";
import type {
  ExtensionToWebviewMessage,
  PlayerStateView,
  WebviewToExtensionMessage
} from "../core/playback.js";

/** Parameters for a `load` command sent to the webview. */
export interface LoadOptions {
  chunkId: string;
  /** A `webview.asWebviewUri` result pointing inside the audio cache. */
  src: vscode.Uri;
  durationMs?: number;
  autoplay: boolean;
}

export type WebviewAudioSinkEvent = WebviewToExtensionMessage["type"];

export type WebviewAudioSinkListener<T extends WebviewAudioSinkEvent> = (
  message: Extract<WebviewToExtensionMessage, { type: T }>
) => void;

/**
 * Minimal contract a caller needs from an audio sink. Deliberately small and
 * local so the future `AudioSink` (S3.5) can be swapped in without touching
 * `PlayerViewProvider` or the commands layer.
 */
export interface AudioSinkLike {
  load(options: LoadOptions): void;
  play(): void;
  pause(): void;
  stop(): void;
  seek(positionMs: number): void;
  on<T extends WebviewAudioSinkEvent>(
    event: T,
    listener: WebviewAudioSinkListener<T>
  ): vscode.Disposable;
}

/** Bridges `AudioSinkLike` calls to `postMessage` against a single webview. */
export class WebviewAudioSink implements AudioSinkLike {
  private webview: vscode.Webview | undefined;
  private readonly listeners = new Map<
    WebviewAudioSinkEvent,
    Set<(message: WebviewToExtensionMessage) => void>
  >();

  /** Binds this sink to a live webview and starts forwarding its messages. */
  attach(webview: vscode.Webview): vscode.Disposable {
    this.webview = webview;
    return webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
      this.dispatch(message);
    });
  }

  /** Releases the webview reference; queued `on()` listeners stay registered. */
  detach(): void {
    this.webview = undefined;
  }

  on<T extends WebviewAudioSinkEvent>(
    event: T,
    listener: WebviewAudioSinkListener<T>
  ): vscode.Disposable {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    const wrapped = listener as (message: WebviewToExtensionMessage) => void;
    set.add(wrapped);
    return new vscode.Disposable(() => {
      this.listeners.get(event)?.delete(wrapped);
    });
  }

  load(options: LoadOptions): void {
    const message: ExtensionToWebviewMessage = {
      type: "load",
      chunkId: options.chunkId,
      src: options.src.toString(),
      autoplay: options.autoplay,
      ...(options.durationMs !== undefined ? { durationMs: options.durationMs } : {})
    };
    this.post(message);
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

  private dispatch(message: WebviewToExtensionMessage): void {
    const handlers = this.listeners.get(message.type);
    if (!handlers) {
      return;
    }
    for (const handler of handlers) {
      handler(message);
    }
  }

  private post(message: ExtensionToWebviewMessage): void {
    void this.webview?.postMessage(message);
  }
}
