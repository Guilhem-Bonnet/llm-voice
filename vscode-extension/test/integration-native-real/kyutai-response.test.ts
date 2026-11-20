/**
 * "Lire la dernière réponse" de bout en bout, sans aucun faux. VS Code réel, moteur natif,
 * Core réel, voix réelle de Kyutai TTS 1.6B, vraie frappe de Ctrl+Alt+V puis R, focus dans
 * le terminal intégré : là où un outil en ligne de commande a sa réponse.
 * `native-real.sh --response` dépose une réponse de test dans un dossier temporaire, capte
 * le son et compare ce qui est dit au texte déposé.
 */
import * as assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import * as vscode from "vscode";
import type { ExtensionTestApi } from "../../src/extension.js";
import { clickIn, findFrame, photograph as photographWindow, sleep } from "./webviewProbe.js";

interface TestPipeline {
  getPlaybackState(): string;
  listInboxEntriesForTest(): Promise<readonly { id: string; read: boolean }[]>;
  getResponseCodeChipForTest(): { text: string } | undefined;
}

const enabled = process.env.LLM_VOICE_NATIVE_REAL === "1" && process.env.LLM_VOICE_NATIVE_REAL_SCENARIO === "response";

interface KeyStroke {
  key: string;
  code: string;
  keyCode: number;
  modifiers: number;
}

const CTRL_ALT = 2 | 1;

type Send = (method: string, params: Record<string, unknown>) => Promise<{ data?: string } | undefined>;

/** Le protocole de débogage du navigateur donne accès à la vraie fenêtre de VS Code. */
async function withWindow(port: string, use: (send: Send) => Promise<void>): Promise<void> {
  const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; url: string; webSocketDebuggerUrl: string }[];
  const page = targets.find((target) => target.type === "page" && target.url.includes("workbench"));
  assert.ok(page, `fenêtre de VS Code introuvable : ${targets.map((target) => target.url).join(" | ")}`);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", reject);
  });
  let nextId = 0;
  const send: Send = (method, params) =>
    new Promise((resolve) => {
      nextId += 1;
      const id = nextId;
      const onMessage = (event: MessageEvent): void => {
        const reply = JSON.parse(String(event.data)) as { id?: number; result?: { data?: string } };
        if (reply.id === id) {
          socket.removeEventListener("message", onMessage);
          resolve(reply.result);
        }
      };
      socket.addEventListener("message", onMessage);
      socket.send(JSON.stringify({ id, method, params }));
    });
  await use(send);
  socket.close();
}

/** De vraies frappes, reçues par le gestionnaire de raccourcis de VS Code. */
function pressKeys(port: string, strokes: readonly KeyStroke[]): Promise<void> {
  return withWindow(port, async (send) => {
    await send("Emulation.setFocusEmulationEnabled", { enabled: true });
    for (const { key, code, keyCode, modifiers } of strokes) {
      const common = { key, code, modifiers, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
      await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...common });
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...common });
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  });
}

/** Une photo de la vraie fenêtre, webviews comprises. */
function photograph(port: string, path: string): Promise<void> {
  return withWindow(port, async (send) => {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    assert.ok(shot?.data, "pas d'image");
    writeFileSync(path, Buffer.from(shot.data, "base64"));
  });
}

const CHORD = { key: "v", code: "KeyV", keyCode: 86, modifiers: CTRL_ALT };

interface WaitWatch {
  stop(): Promise<{ seenAfterMs?: number; furthestPercent: number; label?: string; shown: boolean }>;
}

/**
 * The waiting bar of the panel, read in the real page from the gesture on. Visible means a page
 * that is shown, a bar with a height and a width: a block no one can see would not count.
 */
function watchWaitBar(port: string, startedAt: number): WaitWatch {
  let running = true;
  let seenAfterMs: number | undefined;
  let furthestPercent = 0;
  let label: string | undefined;
  const shot = process.env.LLM_VOICE_NATIVE_REAL_WAIT_SHOT;
  const watching = (async () => {
    const frame = await findFrame(port, "#wait-bar", 60_000);
    if (frame === undefined) {
      return;
    }
    while (running) {
      const seen = await frame.evaluate<{ shown: boolean; percent: number; label: string }>(`(() => {
        const box = document.getElementById("wait-bar").getBoundingClientRect();
        return {
          shown: !document.getElementById("wait").hidden && document.visibilityState === "visible" && box.width > 0 && box.height > 0,
          percent: Number(document.getElementById("wait-bar").getAttribute("aria-valuenow")),
          label: document.getElementById("wait-label").textContent
        };
      })()`);
      if (seen.shown) {
        if (seenAfterMs === undefined) {
          seenAfterMs = Date.now() - startedAt;
          label = seen.label;
          if (shot !== undefined) {
            await photographWindow(port, shot);
          }
        }
        furthestPercent = Math.max(furthestPercent, seen.percent);
      }
      await sleep(100);
    }
    frame.close();
  })();
  return {
    stop: async () => {
      running = false;
      await watching;
      return { ...(seenAfterMs !== undefined ? { seenAfterMs } : {}), furthestPercent, ...(label !== undefined ? { label } : {}), shown: seenAfterMs !== undefined };
    }
  };
}

(enabled ? suite : suite.skip)("moteur natif réel — Lire la dernière réponse, Ctrl+Alt+V puis R", () => {
  test("le raccourci, depuis le terminal, lit la réponse déposée jusqu'au bout", async function () {
    this.timeout(300_000);
    const port = process.env.LLM_VOICE_NATIVE_REAL_CDP_PORT;
    assert.ok(port, "native-real.sh doit donner le port de débogage");

    const extension = vscode.extensions.getExtension("guilhem-bonnet.llm-voice");
    assert.ok(extension, "extension should be discoverable by id");
    const api = (await extension.activate()) as ExtensionTestApi;
    const pipeline = api.pipeline as unknown as TestPipeline;
    assert.equal(api.audioSink, undefined, "no FakeAudioSink: this suite must run the native engine");

    const [entry] = await pipeline.listInboxEntriesForTest();
    assert.ok(entry, "la réponse de test doit être dans le dossier temporaire");

    // Rien ne se lit tout seul : la réponse attend, et rien ne part avant le geste.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const idle = pipeline.getPlaybackState();
    assert.ok(!["preparing", "buffering", "playing"].includes(idle), `état avant le geste : ${idle}`);

    const shot = process.env.LLM_VOICE_NATIVE_REAL_SHOT;
    if (shot !== undefined) {
      await vscode.commands.executeCommand("llmVoice.inboxView.focus");
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await photograph(port, shot);
    }

    vscode.window.createTerminal("preuve").show(false);
    await vscode.commands.executeCommand("workbench.action.terminal.focus");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Témoin : Ctrl+Alt+V puis C porte `!terminalFocus`. S'il ne fait rien alors que le
    // presse-papiers a du texte, le focus est bien dans le terminal.
    await vscode.env.clipboard.writeText("Ce texte de contrôle ne doit jamais être lu.");
    assert.equal(await vscode.env.clipboard.readText(), "Ce texte de contrôle ne doit jamais être lu.");
    await pressKeys(port, [CHORD, { key: "c", code: "KeyC", keyCode: 67, modifiers: 0 }]);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    assert.equal(pipeline.getPlaybackState(), idle, "le focus n'est pas dans le terminal : le témoin a démarré");

    const startedAt = Date.now();
    const gesture = process.env.LLM_VOICE_NATIVE_REAL_RESPONSE_GESTURE ?? "shortcut";
    let waitBar: WaitWatch;
    if (gesture === "shortcut") {
      waitBar = watchWaitBar(port, startedAt);
      await pressKeys(port, [CHORD, { key: "r", code: "KeyR", keyCode: 82, modifiers: 0 }]);
    } else {
      // « Tout lire » : le bouton du panneau, à la souris. Le panneau est donc ouvert.
      await vscode.commands.executeCommand("llmVoice.playerView.focus");
      await sleep(2000);
      const panel = await findFrame(port, "#btn-response-read", 30_000);
      assert.ok(panel, "panneau introuvable");
      waitBar = watchWaitBar(port, Date.now());
      await clickIn(port, panel, `document.getElementById("btn-response-read")`);
      panel.close();
    }

    let firstSoundMs: number | undefined;
    let state = pipeline.getPlaybackState();
    const pressedDeadline = Date.now() + 15_000;
    while (state === idle) {
      assert.ok(Date.now() < pressedDeadline, "le raccourci n'a lancé aucune lecture");
      await new Promise((resolve) => setTimeout(resolve, 100));
      state = pipeline.getPlaybackState();
    }
    const deadline = Date.now() + 240_000;
    while (!["completed", "error", "stopped"].includes(state)) {
      assert.ok(Date.now() < deadline, `state stayed "${state}"`);
      if (state === "playing" && firstSoundMs === undefined) {
        firstSoundMs = Date.now() - startedAt;
        // Pendant la lecture, la puce ne se montre que si la réponse a un bloc de code.
        const expected = process.env.LLM_VOICE_NATIVE_REAL_RESPONSE_HAS_CODE === "1" ? "Code : ignoré" : undefined;
        assert.equal(pipeline.getResponseCodeChipForTest()?.text, expected);
        const chipShot = process.env.LLM_VOICE_NATIVE_REAL_CHIP_SHOT;
        if (chipShot !== undefined) {
          await vscode.commands.executeCommand("llmVoice.playerView.focus");
          await new Promise((resolve) => setTimeout(resolve, 1500));
          await photograph(port, chipShot);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      state = pipeline.getPlaybackState();
    }

    const wait = await waitBar.stop();
    console.log(`response-proof ${JSON.stringify({ gesture, firstSoundMs, totalMs: Date.now() - startedAt, wait })}`);
    assert.equal(state, "completed");
    assert.ok(wait.shown, "la barre d'attente du panneau n'a pas été visible");
    const [after] = await pipeline.listInboxEntriesForTest();
    assert.equal(after?.read, true, "la réponse lue est marquée comme lue");
  });
});
