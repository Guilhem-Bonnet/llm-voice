/**
 * GAO-diagnostic-s-001: reproduces "Audio error code 4" against a real,
 * valid WAV in a real webview (real VS Code resource server, real Chromium
 * `<audio>` decoder) instead of guessing why. Captures `player.js`'s own
 * `error` report — the exact `audio.src` URI plus the status/content-type/
 * body-preview of a `fetch()` on that same URI from inside the webview.
 */

import * as assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";

import type { ExtensionTestApi } from "../../src/extension.js";
import { buildPlayerHtml, getNonce } from "../../src/views/player/playerHtml.js";
import type { WebviewToExtensionMessage } from "../../src/core/playback.js";
import { WebviewAudioSink } from "../../src/playback/WebviewAudioSink.js";
import type { AudioSinkChunk } from "../../src/playback/AudioSink.js";

/** A minimal, valid PCM WAV — RIFF/WAVE, 16-bit mono 22050 Hz, matching the field report. */
function buildWav(sampleCount: number): Uint8Array {
  const sampleRate = 22050;
  const bytesPerSample = 2;
  const dataSize = sampleCount * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  // Silence — a simple sine wave is not necessary to reproduce a decode error.
  for (let i = 0; i < sampleCount; i += 1) {
    buffer.writeInt16LE(0, 44 + i * bytesPerSample);
  }
  return new Uint8Array(buffer);
}

async function activateExtension(): Promise<ExtensionTestApi> {
  const extension = vscode.extensions.getExtension("guilhem-bonnet.llm-voice");
  assert.ok(extension, "extension guilhem-bonnet.llm-voice not found");
  return (await extension.activate()) as ExtensionTestApi;
}

/**
 * Puts `wav` at a fresh `DiskAudioCache`-shaped path (`cache/<shard>/<key>.wav`),
 * opens a real webview loaded with `player.js`, posts the D4 `load` protocol
 * message once the webview reports `ready`, and returns whatever the player
 * reports back (`error` | `timeupdate` | `ended`) plus the exact `src` URI used.
 */
async function loadInRealWebview(
  api: ExtensionTestApi,
  wav: Uint8Array,
  registerPanel: (panel: vscode.WebviewPanel) => void
): Promise<{ src: string; messages: WebviewToExtensionMessage[]; observed: WebviewToExtensionMessage | undefined }> {
  const extensionUri = api.context.extensionUri;
  const globalStorageUri = api.context.globalStorageUri;

  // Same layout DiskAudioCache uses: cache/<2-hex-shard>/<key>.wav.
  const key = `diag${randomUUID().replace(/-/g, "").slice(0, 28)}`;
  const shard = key.slice(0, 2);
  const cacheDir = join(globalStorageUri.fsPath, "cache", shard);
  mkdirSync(cacheDir, { recursive: true });
  const filePath = join(cacheDir, `${key}.wav`);
  writeFileSync(filePath, wav);

  const panel = vscode.window.createWebviewPanel("llmVoice.diag", "diag", vscode.ViewColumn.One, {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media"), vscode.Uri.joinPath(globalStorageUri, "cache")]
  });
  registerPanel(panel);
  panel.webview.html = buildPlayerHtml({
    nonce: getNonce(),
    cspSource: panel.webview.cspSource,
    scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "player", "player.js")).toString(),
    styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "player", "player.css")).toString()
  });

  const src = panel.webview.asWebviewUri(vscode.Uri.file(filePath)).toString();

  const messages: WebviewToExtensionMessage[] = [];
  const gotMessage = new Promise<void>((resolve) => {
    panel.webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
      messages.push(message);
      if (message.type === "error" || message.type === "ended" || message.type === "timeupdate") {
        resolve();
      }
    });
  });

  // Wait for the webview's own "ready" before posting "load" (D4 protocol).
  await new Promise<void>((resolve) => {
    const sub = panel.webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
      if (message.type === "ready") {
        sub.dispose();
        resolve();
      }
    });
  });

  void panel.webview.postMessage({ type: "load", chunkId: "diag", src, autoplay: true, durationMs: 1000 });

  await Promise.race([
    gotMessage,
    new Promise<void>((_, reject) => setTimeout(() => reject(new Error("no player response within 15s")), 15000))
  ]);

  const observed = messages.find((m) => m.type === "error" || m.type === "timeupdate" || m.type === "ended");
  return { src, messages, observed };
}

suite("GAO-diagnostic-s-001 — observed cause of Audio error code 4", () => {
  let panel: vscode.WebviewPanel | undefined;

  teardown(() => {
    panel?.dispose();
    panel = undefined;
  });

  test("loading a real cached WAV via asWebviewUri in a real webview", async function () {
    this.timeout(20000);
    const api = await activateExtension();
    const wav = buildWav(22050); // 1 s of real, decodable PCM audio
    const { src, observed } = await loadInRealWebview(api, wav, (p) => {
      panel = p;
    });
    // eslint-disable-next-line no-console
    console.log("GAO-diagnostic-s-001 RAW OBSERVATION (synthetic WAV):", JSON.stringify({ src, observed }, null, 2));

    assert.ok(observed, "expected an error, timeupdate or ended message from the player");
  });

  /**
   * GAO-diagnostic-s-001, decisive experiment: same harness, but loading a
   * byte-for-byte copy of the field-reported WAV (the one that triggered
   * "Audio error code 4" on the reporter's machine — verified structurally
   * sound: correct RIFF/fmt /data layout, 89 204 bytes of PCM available).
   * Opt-in via `GAO_REAL_WAV_PATH` (never hardcode a path under a
   * developer's home directory) — skipped otherwise, including in CI.
   * The copy is written read-only in *this* profile's own cache dir; the
   * original file is never opened for writing.
   */
  test("loading a read-only copy of the real field-reported WAV in a real webview", async function () {
    const realWavPath = process.env.GAO_REAL_WAV_PATH;
    if (!realWavPath) {
      this.skip();
      return;
    }
    this.timeout(20000);
    const api = await activateExtension();

    const stagedPath = join(api.context.globalStorageUri.fsPath, "diag-real-source.wav");
    copyFileSync(realWavPath, stagedPath);
    chmodSync(stagedPath, 0o444);
    const wav = new Uint8Array(await vscode.workspace.fs.readFile(vscode.Uri.file(stagedPath)));

    const { src, observed } = await loadInRealWebview(api, wav, (p) => {
      panel = p;
    });
    // eslint-disable-next-line no-console
    console.log("GAO-diagnostic-s-001 RAW OBSERVATION (real field WAV):", JSON.stringify({ src, observed }, null, 2));

    assert.ok(observed, "expected an error, timeupdate or ended message from the player");
    assert.notEqual(
      observed?.type,
      "error",
      `real field-reported WAV failed to play: ${JSON.stringify(observed)}`
    );
  });

  /**
   * GAO-diagnostic-s-001, root cause: the real field WAV plays cleanly once
   * it is actually on disk (test above) — so the field failure is a chunk
   * whose `audioUri` still names a file that vanished (eviction race) or was
   * never written by the time `load()` ran. `WebviewAudioSink.load()` now
   * checks the file exists right before posting `load`, and fails loudly and
   * specifically instead of letting the webview report an opaque code 4.
   */
  test("WebviewAudioSink.load() rejects explicitly when the cache file is missing", async function () {
    this.timeout(20000);
    const api = await activateExtension();
    const extensionUri = api.context.extensionUri;
    const globalStorageUri = api.context.globalStorageUri;

    panel = vscode.window.createWebviewPanel("llmVoice.diag", "diag", vscode.ViewColumn.One, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media"), vscode.Uri.joinPath(globalStorageUri, "cache")]
    });
    panel.webview.html = buildPlayerHtml({
      nonce: getNonce(),
      cspSource: panel.webview.cspSource,
      scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "player", "player.js")).toString(),
      styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "player", "player.css")).toString()
    });

    const sink = new WebviewAudioSink();
    sink.attach(panel.webview);

    // Never written — same layout DiskAudioCache uses, but no file at all,
    // reproducing "audioUri names a cache entry that isn't on disk yet".
    const missingKey = `diagmissing${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const missingPath = join(globalStorageUri.fsPath, "cache", missingKey.slice(0, 2), `${missingKey}.wav`);

    const missingChunk: AudioSinkChunk = { chunkId: "diag-missing", src: missingPath };
    await assert.rejects(sink.load(missingChunk), /cache file missing/);
  });
});
