/**
 * GAO-qwen3-dans-l-001 : un texte long lu de bout en bout avec la voix Qwen3, moteur natif, Core
 * réel, service Qwen3 réel. Toute la lecture est préparée avant le premier son :
 * `native-real.sh --qwen3` capte le son sur un sink nul, mesure le plus long silence et le WER.
 * `--qwen3-stop` : Stop pendant la préparation, aucun son, plus aucune requête ensuite.
 */
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { ExtensionTestApi } from "../../src/extension.js";

interface TestPipeline {
  getPlaybackState(): string;
  start(source: { scope: string; uri?: string; languageId?: string }): Promise<void>;
  stop(): Promise<void>;
}

const scenario = process.env.LLM_VOICE_NATIVE_REAL_SCENARIO;
const enabled = process.env.LLM_VOICE_NATIVE_REAL === "1" && (scenario === "qwen3" || scenario === "qwen3-stop");

async function openReading(): Promise<{ pipeline: TestPipeline; uri: string }> {
  const documentPath = process.env.LLM_VOICE_NATIVE_REAL_DOCUMENT;
  assert.ok(documentPath, "native-real.sh doit donner le document");
  const extension = vscode.extensions.getExtension("guilhem-bonnet.llm-voice");
  assert.ok(extension, "extension should be discoverable by id");
  const api = (await extension.activate()) as ExtensionTestApi;
  assert.equal(api.audioSink, undefined, "no FakeAudioSink: this suite must run the native engine");
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(documentPath));
  await vscode.window.showTextDocument(document);
  return { pipeline: api.pipeline as unknown as TestPipeline, uri: document.uri.toString() };
}

(enabled ? suite : suite.skip)("moteur natif réel — voix Qwen3, lecture préparée en entier", () => {
  test("un texte long est lu jusqu'au bout, sans rien jouer avant d'avoir tout préparé", async function () {
    if (scenario !== "qwen3") {
      this.skip();
    }
    this.timeout(1_500_000);
    const { pipeline, uri } = await openReading();
    const startedAt = Date.now();
    await pipeline.start({ scope: "document", uri, languageId: "markdown" });

    let firstSoundMs: number | undefined;
    const states: string[] = [];
    let state = pipeline.getPlaybackState();
    const deadline = Date.now() + 1_450_000;
    while (!["completed", "error", "stopped"].includes(state)) {
      assert.ok(Date.now() < deadline, `state stayed "${state}"`);
      if (states[states.length - 1] !== state) {
        states.push(state);
      }
      if (state === "playing") {
        firstSoundMs ??= Date.now() - startedAt;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      state = pipeline.getPlaybackState();
    }
    states.push(state);
    console.log(`qwen3-proof ${JSON.stringify({ firstSoundMs, totalMs: Date.now() - startedAt, states })}`);
    assert.equal(state, "completed");
    // Une fois le son parti, la machine ne repasse jamais par l'attente d'un passage.
    assert.ok(!states.slice(states.indexOf("playing")).includes("buffering"), `attente pendant la lecture : ${states.join(" > ")}`);
  });

  test("Stop pendant la préparation : aucun son, et la préparation s'arrête", async function () {
    if (scenario !== "qwen3-stop") {
      this.skip();
    }
    this.timeout(300_000);
    const { pipeline, uri } = await openReading();
    void pipeline.start({ scope: "document", uri, languageId: "markdown" });
    const prepareDeadline = Date.now() + 120_000;
    while (pipeline.getPlaybackState() !== "preparing") {
      assert.ok(Date.now() < prepareDeadline, `jamais en préparation : ${pipeline.getPlaybackState()}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    // Laisse partir au moins une requête, puis Stop.
    await new Promise((resolve) => setTimeout(resolve, 20_000));
    assert.equal(pipeline.getPlaybackState(), "preparing", "toujours en préparation avant Stop");
    const stopAt = Date.now();
    await pipeline.stop();
    const states = new Set<string>();
    for (let index = 0; index < 100; index += 1) {
      states.add(pipeline.getPlaybackState());
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    console.log(`qwen3-stop ${JSON.stringify({ stopAtEpochMs: stopAt, statesAfterStop: [...states] })}`);
    assert.ok(!states.has("playing") && !states.has("preparing"), `après Stop : ${[...states].join(", ")}`);
  });
});
