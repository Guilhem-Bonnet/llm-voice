/**
 * The whole extension, no fake: real VS Code, native engine, real Core, real
 * Estelle voice from `pocket-tts serve`, through the profile editor's Test
 * button path, paused and resumed mid-sentence. `native-real.sh --kyutai`
 * captures the sound and measures the silence the pause must leave in it.
 */
import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import type { ExtensionTestApi } from "../../src/extension.js";

interface TestPipeline {
  getPlaybackState(): string;
  getProfileById(id: string): Promise<unknown>;
  openProfileEditorById(id: string): Promise<void>;
  dispatchProfileEditorMessageForTest(id: string, message: { type: "test"; profile: unknown }): Promise<void>;
  closeProfileEditorForTest(id: string): void;
}

const PROFILE_ID = "native-real-kyutai";
const PAUSE_MS = 2500;
const enabled = process.env.LLM_VOICE_NATIVE_REAL === "1" && process.env.LLM_VOICE_NATIVE_REAL_SCENARIO === "kyutai";

async function waitForState(pipeline: TestPipeline, wanted: readonly string[], timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let state = pipeline.getPlaybackState();
  while (!wanted.includes(state)) {
    assert.ok(Date.now() < deadline, `state stayed "${state}", expected one of ${wanted.join(", ")}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    state = pipeline.getPlaybackState();
  }
  return state;
}

async function readJournal(context: vscode.ExtensionContext): Promise<string> {
  const exthostDir = path.dirname(context.logUri.fsPath);
  const parts: string[] = [];
  for (const dir of await fs.readdir(exthostDir)) {
    if (!dir.startsWith("output_logging_")) {
      continue;
    }
    for (const file of await fs.readdir(path.join(exthostDir, dir))) {
      if (file.includes("LLM Voice")) {
        parts.push(await fs.readFile(path.join(exthostDir, dir, file), "utf8"));
      }
    }
  }
  try {
    for (const file of await fs.readdir(context.logUri.fsPath)) {
      parts.push(await fs.readFile(path.join(context.logUri.fsPath, file), "utf8"));
    }
  } catch {
    // no dedicated directory: nothing to add
  }
  return parts.join("\n");
}

(enabled ? suite : suite.skip)("moteur natif réel — Estelle depuis le bouton Test, pause et reprise", () => {
  test("la voix est lue jusqu'au bout, la pause fige l'état, la reprise termine", async function () {
    this.timeout(180_000);

    const extension = vscode.extensions.getExtension("guilhem-bonnet.llm-voice");
    assert.ok(extension, "extension should be discoverable by id");
    const api = (await extension.activate()) as ExtensionTestApi;
    const pipeline = api.pipeline as unknown as TestPipeline;
    assert.equal(api.audioSink, undefined, "no FakeAudioSink: this suite must run the native engine");

    await pipeline.openProfileEditorById(PROFILE_ID);
    const profile = await pipeline.getProfileById(PROFILE_ID);
    await pipeline.dispatchProfileEditorMessageForTest(PROFILE_ID, { type: "test", profile });

    await waitForState(pipeline, ["playing"], 120_000);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal(pipeline.getPlaybackState(), "playing", "still speaking 1.5 s in");

    await vscode.commands.executeCommand("llmVoice.pause");
    assert.equal(pipeline.getPlaybackState(), "paused");
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
    assert.equal(pipeline.getPlaybackState(), "paused", "must stay paused until resumed");

    await vscode.commands.executeCommand("llmVoice.play");
    const final = await waitForState(pipeline, ["completed", "error", "stopped"], 60_000);
    pipeline.closeProfileEditorForTest(PROFILE_ID);

    const journal = await readJournal(api.context);
    assert.doesNotMatch(journal, /chunk failed|start failed|invalid_request/, `journal reports a failure:\n${journal}`);
    assert.equal(final, "completed");
  });
});
