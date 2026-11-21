/**
 * Repris de la PR #64 (GAO-diagnostic-s-001) : `WebviewAudioSink.load()` ne
 * se tait plus. Sans vue attachée, ou si le fichier du cache a disparu, le
 * morceau échoue par un événement `error` (comme `NativeAudioSink`) ; et une
 * ancienne vue qui se ferme ne coupe plus le pont de la vue vivante.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  Uri: { file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }) }
}));

import type * as vscode from "vscode";
import { WEBVIEW_ATTACH_WAIT_MS, WebviewAudioSink } from "../../../src/playback/WebviewAudioSink.js";

function fakeWebview(): vscode.Webview & { posted: unknown[] } {
  const posted: unknown[] = [];
  return {
    posted,
    asWebviewUri: (uri: { toString(): string }) => ({ toString: () => `https://webview/${uri.toString()}` }),
    postMessage: async (message: unknown) => {
      posted.push(message);
      return true;
    },
    onDidReceiveMessage: () => ({ dispose: () => undefined })
  } as unknown as vscode.Webview & { posted: unknown[] };
}

function existingFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "webview-sink-"));
  const file = join(dir, "chunk.wav");
  writeFileSync(file, "RIFF");
  return file;
}

describe("WebviewAudioSink.load — failures are named, never silent (PR #64)", () => {
  it("emits an error when no player view resolves in time", async () => {
    vi.useFakeTimers();
    try {
      const sink = new WebviewAudioSink();
      const errors: { chunkId: string; message: string }[] = [];
      sink.on("error", (payload) => errors.push(payload));
      const loading = sink.load({ chunkId: "c1", src: existingFile() });
      await vi.advanceTimersByTimeAsync(WEBVIEW_ATTACH_WAIT_MS);
      await loading;
      expect(errors).toHaveLength(1);
      expect(errors[0]?.chunkId).toBe("c1");
      expect(errors[0]?.message).toContain("aucune vue du lecteur");
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for a player view that resolves after the first load(), then loads into it", async () => {
    const sink = new WebviewAudioSink();
    const errors: unknown[] = [];
    sink.on("error", (payload) => errors.push(payload));
    const loading = sink.load({ chunkId: "c0", src: existingFile() });
    const webview = fakeWebview();
    sink.attach(webview);
    await loading;
    expect(errors).toHaveLength(0);
    expect(webview.posted).toContainEqual(expect.objectContaining({ type: "load", chunkId: "c0" }));
  });

  it("emits an error, and posts nothing, when the cache file is gone", async () => {
    const sink = new WebviewAudioSink();
    const webview = fakeWebview();
    sink.attach(webview);
    const errors: { chunkId: string; message: string }[] = [];
    sink.on("error", (payload) => errors.push(payload));
    const missing = join(tmpdir(), "llm-voice-absent", "nope.wav");
    await sink.load({ chunkId: "c2", src: missing });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("fichier audio absent du cache");
    expect(errors[0]?.message).toContain(missing);
    expect(webview.posted).toHaveLength(0);
  });

  it("posts the load message for an existing file", async () => {
    const sink = new WebviewAudioSink();
    const webview = fakeWebview();
    sink.attach(webview);
    const errors: unknown[] = [];
    sink.on("error", (payload) => errors.push(payload));
    await sink.load({ chunkId: "c3", src: existingFile(), durationMs: 1200 });
    expect(errors).toHaveLength(0);
    expect(webview.posted).toEqual([
      expect.objectContaining({ type: "load", chunkId: "c3", autoplay: true, durationMs: 1200 })
    ]);
  });
});

describe("WebviewAudioSink.detach — a stale view cannot steal the live bridge (PR #64)", () => {
  it("ignores the detach of a webview it no longer routes to", async () => {
    const sink = new WebviewAudioSink();
    const stale = fakeWebview();
    const live = fakeWebview();
    sink.attach(stale);
    sink.attach(live);
    sink.detach(stale);
    await sink.load({ chunkId: "c4", src: existingFile() });
    expect(live.posted).toHaveLength(1);
    expect(stale.posted).toHaveLength(0);
  });

  it("lets the live webview detach itself", async () => {
    const sink = new WebviewAudioSink();
    const live = fakeWebview();
    sink.attach(live);
    sink.detach(live);
    const errors: unknown[] = [];
    sink.on("error", (payload) => errors.push(payload));
    vi.useFakeTimers();
    try {
      const loading = sink.load({ chunkId: "c5", src: existingFile() });
      await vi.advanceTimersByTimeAsync(WEBVIEW_ATTACH_WAIT_MS);
      await loading;
    } finally {
      vi.useRealTimers();
    }
    expect(errors).toHaveLength(1);
    expect(live.posted).toHaveLength(0);
  });
});
