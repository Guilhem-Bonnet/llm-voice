/**
 * GAO-diagnostic-s-001: reproduces "Audio error code 4" against a real,
 * valid WAV in a real webview (real VS Code resource server, real Chromium
 * `<audio>` decoder) instead of guessing why. Captures `player.js`'s own
 * `error` report — the exact `audio.src` URI plus the status/content-type/
 * body-preview of a `fetch()` on that same URI from inside the webview.
 */

import * as assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";

import type { ExtensionTestApi } from "../../src/extension.js";
import { buildPlayerHtml, getNonce } from "../../src/views/player/playerHtml.js";
import type { WebviewToExtensionMessage } from "../../src/core/playback.js";

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

suite("GAO-diagnostic-s-001 — observed cause of Audio error code 4", () => {
  let panel: vscode.WebviewPanel | undefined;

  teardown(() => {
    panel?.dispose();
    panel = undefined;
  });

  test("loading a real cached WAV via asWebviewUri in a real webview", async function () {
    this.timeout(20000);
    const api = await activateExtension();
    const extensionUri = api.context.extensionUri;
    const globalStorageUri = api.context.globalStorageUri;

    // Same layout DiskAudioCache uses: cache/<2-hex-shard>/<key>.wav.
    const key = `diag${randomUUID().replace(/-/g, "").slice(0, 28)}`;
    const shard = key.slice(0, 2);
    const cacheDir = join(globalStorageUri.fsPath, "cache", shard);
    mkdirSync(cacheDir, { recursive: true });
    const filePath = join(cacheDir, `${key}.wav`);
    const wav = buildWav(22050); // 1 s of real, decodable PCM audio
    writeFileSync(filePath, wav);

    panel = vscode.window.createWebviewPanel("llmVoice.diag", "diag", vscode.ViewColumn.One, {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(extensionUri, "media"),
        vscode.Uri.joinPath(globalStorageUri, "cache")
      ]
    });
    panel.webview.html = buildPlayerHtml({
      nonce: getNonce(),
      cspSource: panel.webview.cspSource,
      scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "player", "player.js")).toString(),
      styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "player", "player.css")).toString()
    });

    const src = panel.webview.asWebviewUri(vscode.Uri.file(filePath)).toString();

    const messages: WebviewToExtensionMessage[] = [];
    const gotMessage = new Promise<void>((resolve) => {
      panel!.webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
        messages.push(message);
        if (message.type === "error" || message.type === "ended" || message.type === "timeupdate") {
          resolve();
        }
      });
    });

    // Wait for the webview's own "ready" before posting "load" (D4 protocol).
    await new Promise<void>((resolve) => {
      const sub = panel!.webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
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
    // eslint-disable-next-line no-console
    console.log("GAO-diagnostic-s-001 RAW OBSERVATION:", JSON.stringify({ src, observed }, null, 2));

    assert.ok(observed, "expected an error, timeupdate or ended message from the player");
  });
});
