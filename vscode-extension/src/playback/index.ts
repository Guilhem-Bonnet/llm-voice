/**
 * Public surface of the playback layer.
 *
 * Like `src/core`, nothing here imports `vscode`: the Webview player and the
 * cache storage are injected through `AudioSink` and `AudioCacheStore`, which
 * is what makes the whole state machine unit testable (ADR-001, ADR-005).
 */

export * from "./emitter.js";
export * from "./AudioSink.js";
export * from "./AudioCache.js";
export * from "./DiskAudioCache.js";
export * from "./AudioQueue.js";
export * from "./PlaybackController.js";
export * from "./SessionFactory.js";
