/**
 * S3.5, the "no local TTS server" error path — run under the
 * `real-provider-unavailable` `.vscode-test.mjs` profile, deliberately
 * *without* `LLM_VOICE_TEST_FAKE_TTS=1`: `Pipeline` uses the real
 * `OpenAICompatibleTtsProvider`, `EgressGuard` in `local` mode, and the
 * default profile's `baseUrl` (`http://127.0.0.1:8004`), which nothing
 * listens on in this sandbox — a closed loopback port, not a firewalled
 * remote host, so `EgressGuard` allows the attempt and only the TCP connect
 * fails (CdC/AC: "sans serveur TTS, Speak Document affiche l'erreur propre
 * « TTS unavailable » avec Retry, pas de crash").
 */
import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as vscode from "vscode";
import type { ExtensionTestApi } from "../../src/extension.js";

async function waitFor(predicate: () => boolean, timeoutMs = 10000, intervalMs = 50): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("waitFor: condition not met before timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

suite("LLM Voice: TTS unavailable (S3.5, real provider, closed port)", () => {
  test("Speak Document surfaces a clean error instead of crashing", async () => {
    const extension = vscode.extensions.getExtension("guilhem-bonnet.llm-voice");
    assert.ok(extension, "extension should be discoverable by id");
    const api = (await extension?.activate()) as ExtensionTestApi;
    assert.equal(api.audioSink, undefined, "this profile must not inject the fake sink");
    assert.equal(api.ttsProvider, undefined, "this profile must not inject the fake TTS provider");

    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "test workspace should have a folder open");
    const fileUri = vscode.Uri.file(path.join(folder.uri.fsPath, "markdown", "short.md"));
    await vscode.workspace.openTextDocument(fileUri);

    const testPipeline = api.pipeline as unknown as { getPlaybackState(): string };

    // Must resolve, never throw or hang: the whole point of the "stop on
    // synthesis failure" decision (`Pipeline.handleChunkError`).
    await assert.doesNotReject(
      api.pipeline.start({ scope: "document", uri: fileUri.toString(), languageId: "markdown" })
    );

    await waitFor(() => testPipeline.getPlaybackState() === "error");
    assert.equal(testPipeline.getPlaybackState(), "error");
    assert.match(api.statusBar.text, /\$\(error\)/);
  });
});
