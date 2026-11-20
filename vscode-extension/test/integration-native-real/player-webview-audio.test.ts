/**
 * Le moteur `webview`, valeur par défaut de `llmVoice.audio.engine` : le passage arrive dans le
 * vrai `<audio>` du panneau. Même défaut que la galerie : racine en `vscode-userdata`, fichier en
 * `file`, et VS Code répondait 401 sur tout le cache audio. Ce test prouve que le fichier est servi
 * et décodé, pas qu'il sonne : la lecture de ce moteur attend un clic, qu'il n'exerce pas.
 *
 * Service kyutai16 démarré, depuis vscode-extension/, après `npm run build` :
 *   LLM_VOICE_NATIVE_REAL=1 LLM_VOICE_NATIVE_REAL_SCENARIO=player-webview LLM_VOICE_NATIVE_REAL_ENGINE=kyutai16 \
 *   LLM_VOICE_NATIVE_REAL_CDP_PORT=47632 xvfb-run -a npx vscode-test --label native-real
 */
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { findFrame, sleep } from "./webviewProbe.js";

const enabled = process.env.LLM_VOICE_NATIVE_REAL === "1" && process.env.LLM_VOICE_NATIVE_REAL_SCENARIO === "player-webview";

(enabled ? suite : suite.skip)("moteur webview réel — le panneau lit le fichier du cache audio", () => {
  test("le fichier du cache est servi et décodé", async function () {
    this.timeout(150_000);
    const port = process.env.LLM_VOICE_NATIVE_REAL_CDP_PORT;
    assert.ok(port, "le port de débogage est requis");
    const extension = vscode.extensions.getExtension("guilhem-bonnet.llm-voice");
    assert.ok(extension, "extension should be discoverable by id");
    await extension.activate();

    await vscode.commands.executeCommand("llmVoice.playerView.focus");
    const frame = await findFrame(port, "#wait-bar", 30_000);
    assert.ok(frame, "panneau introuvable");
    try {
      void vscode.commands.executeCommand("llmVoice.testVoice");
      let audioResponses: string[] = [];
      let readyState = 0;
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline && readyState < 2) {
        audioResponses = frame.responses().filter((response) => response.endsWith(".wav"));
        if (audioResponses.some((response) => response.startsWith("401"))) {
          break;
        }
        readyState = await frame.evaluate<number>(`document.getElementById("audio").readyState`);
        await sleep(100);
      }
      console.log(`player-webview-proof ${JSON.stringify({ readyState, audioResponses })}`);
      assert.ok(!audioResponses.some((response) => response.startsWith("401")), `fichier refusé : ${audioResponses.join(" | ")}`);
      assert.ok(readyState >= 2, `fichier non chargé, readyState ${readyState} ; ${frame.responses().join(" | ")}`);
    } finally {
      await vscode.commands.executeCommand("llmVoice.stop").then(undefined, () => undefined);
      frame.close();
    }
  });
});
