/**
 * The wait before the sound, several selections, and the panel following the editor,
 * through the real commands and the real Pipeline, under the `fake-tts` profile.
 * Shares one `Pipeline` with the other files of this profile: each test stops first.
 */
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { TtsHoldError, type TtsRequest } from "../../src/core/tts.js";
import type { ExtensionTestApi } from "../../src/extension.js";
import type { FakeTtsProvider } from "../fakes/FakeTtsProvider.js";

interface TestPipeline {
  getPlaybackState(): string;
  getWaitMeasuresForTest(): Record<string, Record<string, number>>;
  retryAfterHold(): Promise<void>;
}

async function activate(): Promise<{ api: ExtensionTestApi; pipeline: TestPipeline; tts: FakeTtsProvider }> {
  const extension = vscode.extensions.getExtension("guilhem-bonnet.llm-voice");
  assert.ok(extension);
  const api = (await extension.activate()) as ExtensionTestApi;
  assert.ok(api.ttsProvider);
  return { api, pipeline: api.pipeline as unknown as TestPipeline, tts: api.ttsProvider as FakeTtsProvider };
}

async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(predicate(), "condition not reached in time");
}

async function stopped(api: ExtensionTestApi, pipeline: TestPipeline): Promise<void> {
  if (!["idle", "stopped"].includes(pipeline.getPlaybackState())) {
    await api.pipeline.stop();
  }
}

/** Three paragraphs with words no other test synthesises: the cache cannot answer for them. */
async function threeParagraphs(): Promise<{ editor: vscode.TextEditor; words: string[] }> {
  const stamp = `${Date.now()}`;
  const words = [`Alpha${stamp}`, `Bravo${stamp}`, `Charlie${stamp}`];
  const document = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: words.map((word) => `Ceci parle de ${word}, et de rien d'autre.`).join("\n\n") + "\n"
  });
  return { editor: await vscode.window.showTextDocument(document), words };
}

function selectLine(editor: vscode.TextEditor, line: number): vscode.Selection {
  return new vscode.Selection(line, 0, line, editor.document.lineAt(line).text.length);
}

suite("the wait, the passages, the open document", () => {
  test("several selections read every passage, in document order, and nothing between them", async () => {
    const { api, pipeline, tts } = await activate();
    await stopped(api, pipeline);
    const { editor, words } = await threeParagraphs();
    editor.selections = [selectLine(editor, 4), selectLine(editor, 0)];
    const before = tts.requests.length;

    await vscode.commands.executeCommand("llmVoice.speakSelection");
    await until(() => pipeline.getPlaybackState() === "playing");

    const spoken = tts.requests.slice(before).map((request: TtsRequest) => request.text).join(" ");
    assert.ok(spoken.includes(words[0] as string), "the first passage is read");
    assert.ok(spoken.includes(words[2] as string), "the third passage is read");
    assert.ok(!spoken.includes(words[1] as string), "what lies between them is not");
    assert.ok(spoken.indexOf(words[0] as string) < spoken.indexOf(words[2] as string), "document order, not selection order");
    await api.pipeline.stop();
  });

  test("following the editor starts nothing", async () => {
    const { api, pipeline, tts } = await activate();
    await stopped(api, pipeline);
    const state = pipeline.getPlaybackState();
    const before = tts.requests.length;
    const { editor } = await threeParagraphs();
    editor.selection = selectLine(editor, 2);
    editor.selections = [selectLine(editor, 0), selectLine(editor, 2)];
    await new Promise((resolve) => setTimeout(resolve, 150));

    assert.equal(tts.requests.length, before);
    assert.equal(pipeline.getPlaybackState(), state);
  });

  test("the first sound ends the wait, and the speed is measured without any text", async () => {
    const { api, pipeline, tts } = await activate();
    await stopped(api, pipeline);
    const original = tts.synthesize.bind(tts);
    tts.synthesize = async (request, signal) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return original(request, signal);
    };
    try {
      const { editor, words } = await threeParagraphs();
      await api.pipeline.start({ scope: "document", uri: editor.document.uri.toString(), languageId: "markdown" });
      await until(() => pipeline.getPlaybackState() === "playing");
      await until(() => !api.statusBar.text.includes("sync~spin"));

      const measures = pipeline.getWaitMeasuresForTest()[tts.id];
      assert.ok(measures !== undefined && (measures.synthesisMsPerChar as number) > 0, "a real measure, by engine");
      const stored = JSON.stringify(api.context.globalState.get("llmVoice.waitMeasures"));
      for (const word of words) {
        assert.ok(!stored.includes(word), "no text in globalState");
      }
    } finally {
      tts.synthesize = original;
      await api.pipeline.stop();
    }
  });

  test("the mode jeu is not insisted upon: no retry loop, then the same passage on Réessayer", async () => {
    const { api, pipeline, tts } = await activate();
    await stopped(api, pipeline);
    const original = tts.synthesize.bind(tts);
    let calls = 0;
    tts.synthesize = async () => {
      calls += 1;
      throw new TtsHoldError("gpu-yield", "Mode jeu actif");
    };
    try {
      const { editor } = await threeParagraphs();
      await api.pipeline.start({ scope: "document", uri: editor.document.uri.toString(), languageId: "markdown" });
      await until(() => pipeline.getPlaybackState() === "error");
      const settled = calls;
      await new Promise((resolve) => setTimeout(resolve, 1500));
      assert.equal(calls, settled, "nothing asks again on its own");
      assert.ok(calls <= 3, `at most the prefetch window, once each: ${calls}`);

      tts.synthesize = original;
      await pipeline.retryAfterHold();
      await until(() => pipeline.getPlaybackState() === "playing");
    } finally {
      tts.synthesize = original;
      await api.pipeline.stop();
    }
  });
});
