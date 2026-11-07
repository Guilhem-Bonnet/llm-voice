/**
 * GAO-metteur-en-s-001 : 07 lu à plusieurs voix Qwen3, après « Proposer d'après le texte »
 * (analyste et metteur en scène locaux). `native-real.sh --qwen3-cast` capte le son sur un sink
 * nul ; `LLM_VOICE_NATIVE_REAL_EARLY=0` mesure la même lecture sans démarrage anticipé.
 */
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { ExtensionTestApi } from "../../src/extension.js";

interface TestPipeline {
  getPlaybackState(): string;
  start(source: { scope: string; uri?: string; languageId?: string }): Promise<void>;
  toggleCast(uri?: string): Promise<boolean | undefined>;
  setSceneChoiceForTest(choice: (message: string) => Thenable<string | undefined>): void;
  prepareCastProposals(uri: string): Promise<string>;
  setEarlyStartForTest(enabled: boolean): void;
  lastCastDirectionsForTest(): readonly (string | undefined)[];
}

const enabled = process.env.LLM_VOICE_NATIVE_REAL === "1" && process.env.LLM_VOICE_NATIVE_REAL_SCENARIO === "qwen3-cast";

(enabled ? suite : suite.skip)("moteur natif réel — 07 à plusieurs voix Qwen3, états joués", () => {
  test("propositions, consignes, lecture jusqu'au bout sans attente une fois partie", async function () {
    this.timeout(1_500_000);
    const documentPath = process.env.LLM_VOICE_NATIVE_REAL_DOCUMENT;
    assert.ok(documentPath, "native-real.sh doit donner le document");
    const extension = vscode.extensions.getExtension("guilhem-bonnet.llm-voice");
    assert.ok(extension, "extension should be discoverable by id");
    const api = (await extension.activate()) as ExtensionTestApi;
    const pipeline = api.pipeline as unknown as TestPipeline;
    assert.equal(api.audioSink, undefined, "no FakeAudioSink: this suite must run the native engine");
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(documentPath));
    await vscode.window.showTextDocument(document);
    const uri = document.uri.toString();
    assert.equal(await pipeline.toggleCast(uri), true, "le document doit passer à plusieurs voix");
    const early = process.env.LLM_VOICE_NATIVE_REAL_EARLY !== "0";
    pipeline.setEarlyStartForTest(early);

    const proposeStarted = Date.now();
    const notice = await pipeline.prepareCastProposals(uri);
    const proposeMs = Date.now() - proposeStarted;

    pipeline.setSceneChoiceForTest(() => Promise.resolve("Lire quand même"));
    const startedAt = Date.now();
    await pipeline.start({ scope: "document", uri, languageId: "markdown" });
    let firstSoundMs: number | undefined;
    const states: string[] = [];
    let state = pipeline.getPlaybackState();
    const deadline = Date.now() + 1_400_000;
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
    const directions = pipeline.lastCastDirectionsForTest();
    console.log(`qwen3-cast-proof ${JSON.stringify({ early, proposeMs, notice, firstSoundMs, totalMs: Date.now() - startedAt, states, passages: directions.length, directions: directions.map((item, index) => [index, item ?? null]).filter((row) => row[1] !== null) })}`);
    assert.equal(state, "completed");
    assert.ok(!states.slice(states.indexOf("playing")).includes("buffering"), `attente pendant la lecture : ${states.join(" > ")}`);
  });
});
