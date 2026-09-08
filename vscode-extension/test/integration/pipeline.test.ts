/**
 * S3.5 vertical slice, AC-01..06 — run under the `fake-tts` `.vscode-test.mjs`
 * profile (`LLM_VOICE_TEST_FAKE_TTS=1`): `extension.ts` swaps in
 * `FakeTtsProvider` + `FakeAudioSink` (see `docs/testing.md`), so these tests
 * exercise the *real* `Pipeline`/`PlaybackController`/`HighlightController`
 * wiring end to end, without a GPU or network access.
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

/**
 * `vscode.Range`/`vscode.Position` expose `line`/`character` as accessors,
 * not own enumerable data properties: a generic deep-equal (`assert.deepEqual`)
 * cannot tell two different ranges apart. Compare the primitives instead.
 */
function rangeKey(range: vscode.Range | undefined): string {
  if (range === undefined) {
    return "undefined";
  }
  return `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
}

function fixtureUri(...segments: string[]): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "test workspace should have a folder open");
  return vscode.Uri.file(path.join(folder.uri.fsPath, ...segments));
}

suite("LLM Voice pipeline (S3.5, AC-01..06)", () => {
  test("AC-01: Speak Document starts a session observable as 'playing'", async () => {
    const api = await activateExtension();
    const sink = api.audioSink as FakeAudioSink;
    const fileUri = fixtureUri("markdown", "short.md");
    const document = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(document);

    await api.pipeline.start({ scope: "document", uri: fileUri.toString(), languageId: "markdown" });

    const testPipeline = api.pipeline as unknown as { getPlaybackState(): string };
    assert.equal(testPipeline.getPlaybackState(), "playing");
    assert.ok(sink.loads.length >= 1, "the sink should have received at least one load()");
  });

  test("AC-02/AC-03: decoration is posed on the first segment, then moves on 'ended'", async () => {
    const api = await activateExtension();
    const sink = api.audioSink as FakeAudioSink;
    const fileUri = fixtureUri("markdown", "short.md");
    await vscode.workspace.openTextDocument(fileUri);

    await api.pipeline.start({ scope: "document", uri: fileUri.toString(), languageId: "markdown" });

    const firstRanges = api.highlight.getRanges(fileUri);
    assert.ok(firstRanges, "a highlight should be posed after starting playback");
    assert.equal(firstRanges?.current.length, 1);
    const firstRange = firstRanges?.current[0];

    const testPipeline = api.pipeline as unknown as { getCurrentChunkIndex(): number };
    assert.equal(testPipeline.getCurrentChunkIndex(), 0);

    const firstChunkId = sink.currentChunkId;
    assert.ok(firstChunkId, "the fake sink should have a chunk loaded");
    sink.emitEnded(firstChunkId as string);

    // `currentIndex` flips to 1 synchronously as soon as `next()` starts
    // (PlaybackController.playIndex), well before the next chunk is actually
    // synthesised (real disk cache write) and `load()`ed into the sink — wait
    // on the decoration itself moving, which is what AC-03 actually asserts.
    await waitFor(() => rangeKey(api.highlight.getRanges(fileUri)?.current[0]) !== rangeKey(firstRange));
    assert.equal(testPipeline.getCurrentChunkIndex(), 1);
    const secondRanges = api.highlight.getRanges(fileUri);
    assert.equal(secondRanges?.current.length, 1, "a highlight should still be posed on the second chunk");
  });

  test("AC-04: pause keeps the chunk index and the decoration", async () => {
    const api = await activateExtension();
    const fileUri = fixtureUri("markdown", "short.md");
    await vscode.workspace.openTextDocument(fileUri);

    await api.pipeline.start({ scope: "document", uri: fileUri.toString(), languageId: "markdown" });
    const testPipeline = api.pipeline as unknown as {
      getPlaybackState(): string;
      getCurrentChunkIndex(): number;
    };
    const indexBeforePause = testPipeline.getCurrentChunkIndex();
    const rangesBeforePause = api.highlight.getRanges(fileUri);

    await api.pipeline.pause();

    assert.equal(testPipeline.getPlaybackState(), "paused");
    assert.equal(testPipeline.getCurrentChunkIndex(), indexBeforePause);
    assert.equal(
      rangeKey(api.highlight.getRanges(fileUri)?.current[0]),
      rangeKey(rangesBeforePause?.current[0])
    );
  });

  test("AC-05: stop clears the decoration", async () => {
    const api = await activateExtension();
    const sink = api.audioSink as FakeAudioSink;
    const fileUri = fixtureUri("markdown", "short.md");
    await vscode.workspace.openTextDocument(fileUri);

    await api.pipeline.start({ scope: "document", uri: fileUri.toString(), languageId: "markdown" });
    assert.ok(api.highlight.getRanges(fileUri), "a highlight should exist while playing");

    await api.pipeline.stop();

    assert.equal(api.highlight.getRanges(fileUri), undefined);
    assert.ok(sink.commands.includes("stop"), "the sink should have received a stop() command");
    const testPipeline = api.pipeline as unknown as { getPlaybackState(): string };
    assert.equal(testPipeline.getPlaybackState(), "stopped");
  });

  test("AC-06: Speak Selection only reads the selected text", async () => {
    const api = await activateExtension();
    const fileUri = fixtureUri("markdown", "short.md");
    const document = await vscode.workspace.openTextDocument(fileUri);
    // The fixture ends with a trailing newline, which VS Code models as one
    // more (empty) line: walk back to the last *non-empty* line instead of
    // assuming `lineCount - 1` has content.
    let lastLine = document.lineCount - 1;
    while (lastLine > 0 && document.lineAt(lastLine).text.length === 0) {
      lastLine--;
    }
    const selection = {
      startLine: lastLine,
      startColumn: 0,
      endLine: lastLine,
      endColumn: document.lineAt(lastLine).text.length
    };

    await api.pipeline.start({
      scope: "selection",
      uri: fileUri.toString(),
      languageId: "markdown",
      selection
    });

    const testPipeline = api.pipeline as unknown as {
      getPlaybackState(): string;
      getTotalChunks(): number;
    };
    // The full document has 3 segments (heading + 2 paragraphs, see
    // test/fixtures/markdown/short.md); a session built from a one-line
    // selection must only ever contain the one segment inside it — proven by
    // chunk *count*, not by `FakeTtsProvider.requests`, since an earlier
    // "document" test in this same run may have already warmed the disk
    // cache for that exact sentence (a legitimate cache hit, ADR-004).
    await waitFor(() => testPipeline.getPlaybackState() === "playing");
    assert.equal(testPipeline.getTotalChunks(), 1);
  });
});
