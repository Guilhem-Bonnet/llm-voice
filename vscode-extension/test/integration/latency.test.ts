/**
 * S6.2 (CdC §63 "la lecture doit commencer dès que le premier chunk est
 * disponible") — run under the `fake-tts` `.vscode-test.mjs` profile
 * (`LLM_VOICE_TEST_FAKE_TTS=1`, see `test/integration/pipeline.test.ts`'s file
 * header): exercises the real `Pipeline`/`Segmenter`/`AudioQueue` wiring, with
 * `FakeTtsProvider` standing in for the network TTS engine so `AudioChunk
 * .durationMs` is a deterministic, word-count-derived proxy for "how much
 * audio this chunk is" — exactly what CdC §63 cares about shrinking for the
 * first chunk.
 *
 * `sink.loads` accumulates across the *whole* `fake-tts` extension host run
 * (every other integration test file shares the same singleton
 * `FakeAudioSink`, `pipeline.test.ts`'s file header) — every assertion here
 * therefore reads from `sink.loads.length` *at the moment this test's own
 * `start()` resolves its first load*, never from a fixed index, so it is
 * immune to how many sessions earlier suites already ran.
 */
import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as vscode from "vscode";
import type { ExtensionTestApi } from "../../src/extension.js";
import type { FakeAudioSink } from "../fakes/FakeAudioSink.js";

async function waitFor(predicate: () => boolean, timeoutMs = 5000, intervalMs = 25): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("waitFor: condition not met before timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function activateExtension(): Promise<ExtensionTestApi> {
  const extension = vscode.extensions.getExtension("guilhem-bonnet.llm-voice");
  assert.ok(extension, "extension should be discoverable by id");
  const api = (await extension?.activate()) as ExtensionTestApi;
  assert.ok(api.audioSink, "LLM_VOICE_TEST_FAKE_TTS=1 should inject a FakeAudioSink");
  assert.ok(api.ttsProvider, "LLM_VOICE_TEST_FAKE_TTS=1 should inject a FakeTtsProvider");
  return api;
}

function fixtureUri(...segments: string[]): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "test workspace should have a folder open");
  return vscode.Uri.file(path.join(folder.uri.fsPath, ...segments));
}

suite("LLM Voice latency (S6.2, CdC §63)", () => {
  test("the first chunk of a document is shorter than the one that follows it", async () => {
    const api = await activateExtension();
    const sink = api.audioSink as FakeAudioSink;
    const fileUri = fixtureUri("markdown", "latency-first-chunk.md");
    await vscode.workspace.openTextDocument(fileUri);

    // Baseline: index of the *next* load this session will produce, whatever
    // earlier suites already accumulated into the shared `sink.loads`.
    const baseline = sink.loads.length;
    await api.pipeline.start({ scope: "document", uri: fileUri.toString(), languageId: "markdown" });

    await waitFor(() => sink.loads.length >= baseline + 1);
    const firstChunkId = sink.currentChunkId;
    assert.ok(firstChunkId, "the fake sink should have a chunk loaded");
    const firstDurationMs = sink.loads[baseline]?.durationMs;
    assert.ok(firstDurationMs !== undefined, "the first load() should carry a durationMs (FakeTtsProvider always sets one)");

    // Drives the queue to the next chunk exactly like AC-02/03 in pipeline.test.ts.
    sink.emitEnded(firstChunkId as string);
    await waitFor(() => sink.loads.length >= baseline + 2);
    const secondDurationMs = sink.loads[baseline + 1]?.durationMs;
    assert.ok(secondDurationMs !== undefined);

    assert.ok(
      (firstDurationMs as number) < (secondDurationMs as number),
      `first chunk (${firstDurationMs}ms) should be shorter than the second (${secondDurationMs}ms) — ` +
        "llmVoice.audio.firstChunkSentences (default 1) should have capped it below " +
        "the profile's maxSentences (default 3)"
    );

    const testPipeline = api.pipeline as unknown as { getTotalChunks(): number };
    // The fixture has 4 sentences in one paragraph: 1 (first chunk) + 3
    // (second chunk, maxSentences=3) = 2 chunks total.
    assert.equal(testPipeline.getTotalChunks(), 2);
  });

  test("LLM Voice: Show Performance Report does not throw once a session has played", async () => {
    const api = await activateExtension();
    const fileUri = fixtureUri("markdown", "latency-first-chunk.md");
    await vscode.workspace.openTextDocument(fileUri);
    await api.pipeline.start({ scope: "document", uri: fileUri.toString(), languageId: "markdown" });

    const testPipeline = api.pipeline as unknown as { getPlaybackState(): string };
    await waitFor(() => testPipeline.getPlaybackState() === "playing");

    // `performanceReport()`'s final step is an informational `showQuickPick`
    // that only resolves on user input (same pattern as `providerStatus()`,
    // `test/integration/profiles.test.ts`): close it right after it opens so
    // the awaited call settles instead of hanging the test.
    const opened = Promise.resolve(vscode.commands.executeCommand("llmVoice.performanceReport"));
    await new Promise((resolve) => setTimeout(resolve, 300));
    await vscode.commands.executeCommand("workbench.action.closeQuickOpen");
    await assert.doesNotReject(opened);

    const perfPipeline = api.pipeline as unknown as {
      getPerformanceSnapshotForTest(): { ttfaMs?: number; chunkCount: number };
    };
    const snapshot = perfPipeline.getPerformanceSnapshotForTest();
    assert.ok(snapshot.ttfaMs !== undefined && snapshot.ttfaMs >= 0, "TTFA should have been recorded");
    assert.ok(snapshot.chunkCount >= 1);
  });
});
