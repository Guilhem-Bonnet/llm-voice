/**
 * ADR-018 : le jeu d'acteurs de bout en bout, sans aucun faux. VS Code réel, moteur natif,
 * Core réel, voix réelles de Kyutai TTS 1.6B. `native-real.sh --cast` capte le son, compare
 * ce qui est dit au texte attendu, et relève dans le journal du serveur les voix demandées.
 */
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { ExtensionTestApi } from "../../src/extension.js";

interface TestPipeline {
  getPlaybackState(): string;
  start(source: { scope: string; uri?: string; languageId?: string }): Promise<void>;
  toggleCast(uri?: string): Promise<boolean | undefined>;
  setSceneChoiceForTest(choice: (message: string) => Thenable<string | undefined>): void;
  getSpeakerLineForTest(): string | undefined;
}

const enabled = process.env.LLM_VOICE_NATIVE_REAL === "1" && process.env.LLM_VOICE_NATIVE_REAL_SCENARIO === "cast";

(enabled ? suite : suite.skip)("moteur natif réel — jeu d'acteurs, plusieurs voix Kyutai 1.6B", () => {
  test("la scène est lue jusqu'au bout, un personnage après l'autre", async function () {
    this.timeout(600_000);
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

    const startedAt = Date.now();
    pipeline.setSceneChoiceForTest(() => Promise.resolve("Lire quand même"));
    await pipeline.start({ scope: "document", uri, languageId: "markdown" });

    const speakers = new Set<string>();
    let firstSoundMs: number | undefined;
    let state = pipeline.getPlaybackState();
    const deadline = Date.now() + 560_000;
    while (!["completed", "error", "stopped"].includes(state)) {
      assert.ok(Date.now() < deadline, `state stayed "${state}"`);
      if (state === "playing") {
        firstSoundMs ??= Date.now() - startedAt;
      }
      const speaker = pipeline.getSpeakerLineForTest();
      if (speaker) {
        speakers.add(speaker);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      state = pipeline.getPlaybackState();
    }

    console.log(`cast-proof ${JSON.stringify({ firstSoundMs, totalMs: Date.now() - startedAt, speakers: [...speakers] })}`);
    assert.equal(state, "completed");
    assert.ok(speakers.size >= 3, `trois personnages attendus à l'écran, vu : ${[...speakers].join(" | ")}`);
  });
});
