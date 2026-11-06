/**
 * GAO-tests-int-gr-001 — the test that would have caught the field bug
 * `segmentId "session-4:0"` (2026-09-29): the pipeline's chunk ids contain a
 * `:`, the Core's contract refuses it, every `enqueue` failed with
 * `invalid_request` and nothing was ever heard.
 *
 * The *whole* extension, no fake at all: real VS Code (headless, xvfb),
 * `llmVoice.audio.engine=native`, real `llm-voice-core`, real Piper through
 * the `system` provider. The sound itself is captured and transcribed by
 * `scripts/audio-proof/native-real.sh` (this file only proves the extension
 * side: segments started and ended, Core launched, no error in the journal).
 *
 * Opt-in (`LLM_VOICE_NATIVE_REAL=1`, `.vscode-test.mjs` label `native-real`):
 * skipped otherwise so a CI without audio stays green.
 */
import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import type { ExtensionTestApi } from "../../src/extension.js";

/** `getPlaybackState`/`getCurrentChunkIndex`/`getTotalChunks` are reachable only through this cast (same as `pipeline.test.ts`). */
interface TestPipeline {
  getPlaybackState(): string;
  getCurrentChunkIndex(): number;
  getTotalChunks(): number;
}

const enabled = process.env.LLM_VOICE_NATIVE_REAL === "1" && process.env.LLM_VOICE_NATIVE_REAL_SCENARIO !== "kyutai" && process.env.LLM_VOICE_NATIVE_REAL_SCENARIO !== "cast" && process.env.LLM_VOICE_NATIVE_REAL_SCENARIO !== "response";

/** What a broken native path writes to the journal (field bug: `start failed … Core: enqueue refused (invalid_request)`). */
const JOURNAL_FAILURE = /chunk failed|start failed|invalid_request/;

/** Every `LLM Voice` log file the extension host wrote (the `LogOutputChannel` lives under `<logs>/window-N/exthost/output_logging_<date>`). */
async function readJournal(context: vscode.ExtensionContext): Promise<string> {
  const exthostDir = path.dirname(context.logUri.fsPath);
  const parts: string[] = [];
  let dirs: string[] = [];
  try {
    dirs = await fs.readdir(exthostDir);
  } catch {
    return "";
  }
  for (const dir of dirs.filter((d) => d.startsWith("output_logging_"))) {
    const files = await fs.readdir(path.join(exthostDir, dir));
    for (const file of files.filter((f) => f.includes("LLM Voice"))) {
      parts.push(await fs.readFile(path.join(exthostDir, dir, file), "utf8"));
    }
  }
  // The extension's own log directory (`context.logUri`) as a second source.
  try {
    for (const file of await fs.readdir(context.logUri.fsPath)) {
      parts.push(await fs.readFile(path.join(context.logUri.fsPath, file), "utf8"));
    }
  } catch {
    // no dedicated directory: nothing to add
  }
  return parts.join("\n");
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

(enabled ? suite : suite.skip)("moteur natif réel — extension entière, vrai Core, vraie voix Piper", () => {
  test("speakDocument : au moins 2 segments démarrés puis terminés, sans erreur de chunk", async function () {
    this.timeout(180_000);

    const extension = vscode.extensions.getExtension("guilhem-bonnet.llm-voice");
    assert.ok(extension, "extension should be discoverable by id");
    const api = (await extension.activate()) as ExtensionTestApi;
    const pipeline = api.pipeline as unknown as TestPipeline;
    assert.equal(api.audioSink, undefined, "no FakeAudioSink: this suite must run the native engine");

    const mdPath = path.resolve(__dirname, "../../../test/fixtures-native-real/native-real.md");
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(mdPath));
    await vscode.window.showTextDocument(document);

    await vscode.commands.executeCommand("llmVoice.speakDocument");

    // Observe playback through the public controller state (the native sink
    // has no test double to inspect): every distinct chunk index seen while
    // `playing` is a segment the Core reported as started.
    const startedIndexes = new Set<number>();
    const states = new Set<string>();
    const deadline = Date.now() + 150_000;
    let state = pipeline.getPlaybackState();
    let nextJournalCheck = 0;
    while (state !== "completed" && state !== "error" && state !== "stopped") {
      // Fail fast on a journal error: a refused enqueue leaves the controller
      // in `preparing` forever (that is exactly how the field bug looked).
      if (Date.now() >= nextJournalCheck) {
        nextJournalCheck = Date.now() + 500;
        const early = JOURNAL_FAILURE.exec(await readJournal(api.context));
        if (early !== null) {
          assert.fail(`journal reports a failure while playing:\n${await readJournal(api.context)}`);
        }
      }
      if (Date.now() > deadline) {
        assert.fail(`playback never completed (state=${state}, seen indexes=${[...startedIndexes].join(",")})`);
      }
      if (state === "playing") {
        startedIndexes.add(pipeline.getCurrentChunkIndex());
      }
      states.add(state);
      await new Promise((resolve) => setTimeout(resolve, 20));
      state = pipeline.getPlaybackState();
    }
    const total = pipeline.getTotalChunks();

    const journal = await readJournal(api.context);
    assert.doesNotMatch(journal, JOURNAL_FAILURE, `journal reports a failure:\n${journal}`);
    assert.ok(journal.includes("llmVoice.audio.engine=native"), `journal unreadable or wrong engine:\n${journal}`);
    assert.equal(state, "completed", `final state should be completed (states seen: ${[...states].join(",")})`);
    assert.ok(total >= 2, `expected at least 2 segments, got ${total}`);
    // Every segment started (`playing` observed at its index) and — since the
    // session completed — every one of them ended (`segment_ended` is what
    // advances the controller; `completed` only follows the last one).
    assert.ok(
      startedIndexes.size >= 2,
      `at least 2 segments should have started, saw indexes [${[...startedIndexes].join(",")}] of ${total}`
    );
    assert.equal(startedIndexes.size, total, `every segment should have started (indexes [${[...startedIndexes].join(",")}] of ${total})`);

    // The Core was really launched: `core.json` in the isolated state dir the
    // bench gave us, and the pid it records is a live process.
    const stateDir = process.env.LLM_VOICE_CORE_STATE_DIR;
    assert.ok(stateDir, "LLM_VOICE_CORE_STATE_DIR should be set by native-real.sh (isolated Core state dir)");
    const coreJson = path.join(stateDir, "core.json");
    assert.ok(await pathExists(coreJson), `core.json missing in ${stateDir}: the Core was never launched`);
    const info = JSON.parse(await fs.readFile(coreJson, "utf8")) as { pid: number; port: number };
    assert.doesNotThrow(() => process.kill(info.pid, 0), `Core pid ${info.pid} is not alive`);
  });
});
