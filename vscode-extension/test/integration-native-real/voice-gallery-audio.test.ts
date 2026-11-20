/**
 * Une phrase d'essai de la galerie, dans le vrai `<audio>` de la vraie webview. Vrai VS Code,
 * vrai clic à la souris, vraie voix de Kyutai TTS 1.6B. Le DOM simulé des tests unitaires ne
 * charge rien : il n'a jamais vu que VS Code refusait le fichier (401, « Échantillon illisible »).
 *
 * Service kyutai16 démarré, depuis vscode-extension/, après `npm run build` :
 *   LLM_VOICE_NATIVE_REAL=1 LLM_VOICE_NATIVE_REAL_SCENARIO=gallery LLM_VOICE_NATIVE_REAL_ENGINE=kyutai16 \
 *   LLM_VOICE_NATIVE_REAL_CDP_PORT=47632 xvfb-run -a npx vscode-test --label native-real
 *
 * Ce son sort de VS Code, pas du Core, et la session le rend aux enceintes même avec PULSE_SINK :
 * ce scénario lance donc VS Code en `--mute-audio` (.vscode-test.mjs). Il prouve la lecture, pas le son.
 */
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { clickIn, findFrame, sleep } from "./webviewProbe.js";

const enabled = process.env.LLM_VOICE_NATIVE_REAL === "1" && process.env.LLM_VOICE_NATIVE_REAL_SCENARIO === "gallery";

interface AudioFacts {
  currentTime: number;
  duration: number | null;
  errorCode: number | null;
  errorMessage: string | null;
  status: string;
}

(enabled ? suite : suite.skip)("galerie de voix réelle — une phrase d'essai se lit dans la webview", () => {
  test("Écouter une voix de Kyutai narration : l'audio avance jusqu'au bout", async function () {
    this.timeout(180_000);
    const port = process.env.LLM_VOICE_NATIVE_REAL_CDP_PORT;
    assert.ok(port, "native-real.sh doit donner le port de débogage");
    const extension = vscode.extensions.getExtension("guilhem-bonnet.llm-voice");
    assert.ok(extension, "extension should be discoverable by id");
    await extension.activate();

    await vscode.commands.executeCommand("llmVoice.openVoiceGallery");
    const frame = await findFrame(port, "[data-voice-id]", 30_000);
    assert.ok(frame, "galerie introuvable dans la fenêtre");
    try {
      // La galerie demande l'état des serveurs à l'ouverture.
      await sleep(2000);
      const card = `document.querySelector(${JSON.stringify('[data-voice-id="kyutai16:estelle"]')})`;
      await clickIn(port, frame, `[...${card}.querySelectorAll("button")].find((button) => button.textContent === "Écouter" && !button.hidden)`);

      const read = `(() => {
        const audio = document.getElementById("audio");
        return {
          currentTime: audio.currentTime,
          duration: Number.isFinite(audio.duration) ? audio.duration : null,
          errorCode: audio.error ? audio.error.code : null,
          errorMessage: audio.error ? audio.error.message : null,
          status: ${card}.querySelector(".status").textContent
        };
      })()`;
      let furthest = 0;
      let duration = 0;
      let last = await frame.evaluate<AudioFacts>(read);
      const deadline = Date.now() + 120_000;
      const failure = (): string => `audio ${JSON.stringify(last)} ; réponses ${frame.responses().join(" | ")}`;
      // « Déjà écoutée » : la carte l'écrit quand l'audio s'est terminé, et seulement alors.
      while (last.status !== "Déjà écoutée") {
        assert.ok(Date.now() < deadline, `pas de fin de lecture. ${failure()}`);
        assert.ok(!/illisible|impossible|arrêté/i.test(last.status), failure());
        await sleep(50);
        last = await frame.evaluate<AudioFacts>(read);
        furthest = Math.max(furthest, last.currentTime);
        duration = last.duration ?? duration;
      }
      console.log(`gallery-proof ${JSON.stringify({ playedSeconds: furthest, durationSeconds: duration, responses: frame.responses().slice(-1) })}`);
      assert.ok(duration > 1, `durée : ${duration}. ${failure()}`);
      assert.ok(furthest >= duration * 0.8, `lecture arrêtée à ${furthest} s sur ${duration} s. ${failure()}`);
    } finally {
      frame.close();
    }
  });
});
