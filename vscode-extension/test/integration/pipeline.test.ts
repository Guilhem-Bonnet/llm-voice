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
import { MockOllamaServer } from "../fakes/mockOllamaServer.js";

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

  test("a stop while the reading is still being prepared cancels it: nothing plays afterwards", async () => {
    const api = await activateExtension();
    const sink = api.audioSink as FakeAudioSink;
    const fileUri = fixtureUri("markdown", "short.md");
    await vscode.workspace.openTextDocument(fileUri);
    await api.pipeline.stop();
    const loadsBefore = sink.loads.length;

    const starting = api.pipeline.start({ scope: "document", uri: fileUri.toString(), languageId: "markdown" });
    await api.pipeline.stop();
    await starting;
    await new Promise((resolve) => setTimeout(resolve, 200));

    const testPipeline = api.pipeline as unknown as { getPlaybackState(): string };
    assert.notEqual(testPipeline.getPlaybackState(), "playing");
    assert.equal(sink.loads.length, loadsBefore, "a cancelled start must never reach the sink");
  });

  test("a second reading supersedes one still being prepared: only the second plays", async () => {
    const api = await activateExtension();
    const sink = api.audioSink as FakeAudioSink;
    const fileUri = fixtureUri("markdown", "short.md");
    await vscode.workspace.openTextDocument(fileUri);
    await api.pipeline.stop();
    const sessionsBefore = api.ttsProvider ? sink.loads.length : 0;

    const first = api.pipeline.start({ scope: "document", uri: fileUri.toString(), languageId: "markdown" });
    const second = api.pipeline.start({ scope: "document", uri: fileUri.toString(), languageId: "markdown" });
    await Promise.all([first, second]);

    const testPipeline = api.pipeline as unknown as { getPlaybackState(): string; getCurrentChunkIndex(): number };
    assert.equal(testPipeline.getPlaybackState(), "playing");
    assert.equal(testPipeline.getCurrentChunkIndex(), 0);
    assert.equal(sink.loads.length, sessionsBefore + 1, "the superseded start must not load its own first chunk");
    await api.pipeline.stop();
  });

  test("a narrated reading of a whole document goes past its first group, to the last section", async () => {
    const api = await activateExtension();
    const sink = api.audioSink as FakeAudioSink;
    const pipeline = api.pipeline as unknown as {
      getPlaybackState(): string;
      importProfileFromJson(json: string): Promise<{ id: string }>;
      selectProfileById(id: string): Promise<void>;
      deleteProfileById(id: string): Promise<void>;
    };
    const ollama = new MockOllamaServer();
    const baseUrl = await ollama.listen();
    const imported = await pipeline.importProfileFromJson(
      JSON.stringify({
        id: `narrated-whole-${Date.now()}`,
        label: "narrated whole document",
        mode: "narrated",
        language: "fr-FR",
        tts: { providerId: "fake-tts", baseUrl: "http://127.0.0.1:9" },
        narrator: { providerId: "ollama", baseUrl, model: "qwen2.5:7b" },
        chunking: { unit: "sentence", maxSentences: 1, prefetchChunks: 0 },
        playback: { rate: 1, volume: 1 }
      })
    );
    await pipeline.selectProfileById(imported.id);
    try {
      const fileUri = fixtureUri("markdown", "three-sections.md");
      await vscode.workspace.openTextDocument(fileUri);
      await api.pipeline.start({ scope: "document", uri: fileUri.toString(), languageId: "markdown" });

      const played = new Set<string>();
      const deadline = Date.now() + 15000;
      while (pipeline.getPlaybackState() !== "completed" && Date.now() < deadline) {
        const chunk = sink.currentChunkId;
        if (chunk !== undefined && !played.has(chunk)) {
          played.add(chunk);
          sink.emitEnded(chunk);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const spoken = ollama.requests.map((request) => request.body).join(" ");
      assert.match(spoken, /troisième section/, "the narrator must reach the last section");
      assert.ok(played.size > 4, `only ${played.size} passages were played, the first group alone`);
      assert.equal(pipeline.getPlaybackState(), "completed");
    } finally {
      await api.pipeline.stop();
      await pipeline.deleteProfileById(imported.id);
      await ollama.close();
    }
  });

  test("a plain text file is read whole, and from the cursor", async () => {
    const api = await activateExtension();
    const sink = api.audioSink as FakeAudioSink;
    const document = await vscode.workspace.openTextDocument({
      language: "plaintext",
      content: "Première phrase du fichier.\nDeuxième phrase du fichier.\nTroisième phrase du fichier."
    });
    await vscode.window.showTextDocument(document);
    const testPipeline = api.pipeline as unknown as { getPlaybackState(): string };

    await vscode.commands.executeCommand("llmVoice.speakDocument");
    assert.equal(testPipeline.getPlaybackState(), "playing", "a whole text file must start reading");
    const tts = api.ttsProvider as unknown as { requests: Array<{ text: string }> };
    const whole = tts.requests.at(-1)?.text ?? "";
    assert.match(whole, /Première phrase/);
    await api.pipeline.stop();

    await api.pipeline.start({ scope: "from-cursor", uri: document.uri.toString(), languageId: "plaintext", cursor: { line: 2, column: 0 } });
    assert.equal(testPipeline.getPlaybackState(), "playing");
    assert.match(tts.requests.at(-1)?.text ?? "", /Troisième phrase/);
    assert.doesNotMatch(tts.requests.at(-1)?.text ?? "", /Première phrase/);
    await api.pipeline.stop();
    assert.ok(sink.loads.length >= 2);
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  });

  test("from the Markdown preview, the document behind it is read", async function () {
    const api = await activateExtension();
    const fileUri = fixtureUri("markdown", "three-sections.md");
    const document = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand("markdown.showPreview", fileUri);
    const deadline = Date.now() + 5000;
    const isPreview = (): boolean => {
      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      return input instanceof vscode.TabInputWebview && input.viewType.includes("markdown.preview");
    };
    while (!isPreview() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(isPreview(), "the built-in preview must be the active tab, otherwise this test proves nothing");
    assert.equal(vscode.window.activeTextEditor, undefined);

    await vscode.commands.executeCommand("llmVoice.speakDocument");
    const testPipeline = api.pipeline as unknown as { getPlaybackState(): string };
    assert.notEqual(testPipeline.getPlaybackState(), "idle", "reading must start from the preview");
    await api.pipeline.stop();
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
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
