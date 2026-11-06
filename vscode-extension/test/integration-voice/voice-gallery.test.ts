/**
 * The voice gallery in a real extension host (card 0-005): the real `ttsFor` chain
 * against `MockTtsServer`, the real page in a real webview for what it does on its
 * own (booting under its CSP, saying `ready`). A click cannot be scripted from here:
 * clicks are `test/unit/views/voiceGallery.behavior.test.ts`, on the real page; here
 * the message a click sends goes through the panel's own controller.
 */
import * as assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import type { ExtensionTestApi } from "../../src/extension.js";
import { KYUTAI_POCKET_VOICE_CATALOG } from "../../src/tts/kyutaiVoiceCatalog.js";
import { voiceGalleryCsp } from "../../src/views/voiceGallery/voiceGalleryHtml.js";
import { MockTtsServer } from "../fakes/mockTtsServer.js";

interface TestPipeline {
  getPlaybackState(): string;
  start(source: { scope: string; text?: string }): Promise<void>;
  stop(): Promise<void>;
  getVoiceGalleryHtmlForTest(): string | undefined;
  dispatchVoiceGalleryMessageForTest(message: unknown): Promise<void>;
  observeVoiceGalleryForTest(observer: ((message: unknown) => void) | undefined): void;
  closeVoiceGalleryForTest(): void;
}

interface Posted {
  type: string;
  activeId?: string;
  uri?: string;
  engines?: Record<string, { status: string }>;
}

function storageDir(): string {
  const dir = process.env.LLM_VOICE_TEST_STORAGE_DIR;
  assert.ok(dir);
  return dir;
}

function writeVoice(voice: Record<string, unknown>): void {
  writeFileSync(join(storageDir(), "global-voice.json"), JSON.stringify({ schemaVersion: 1, voice: { speed: 1, ...voice } }));
}

function readVoice(): Record<string, unknown> {
  return (JSON.parse(readFileSync(join(storageDir(), "global-voice.json"), "utf8")) as { voice: Record<string, unknown> }).voice;
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`waitFor: ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function synthesisRequests(server: MockTtsServer): { body: string }[] {
  return server.requests.filter((request) => request.method === "POST" && request.url === "/tts");
}

suite("voice-chain: voice gallery (card 0-005)", () => {
  let api: ExtensionTestApi;
  let pipeline: TestPipeline;
  let server: MockTtsServer;
  let url: string;
  let posted: Posted[];
  const window = vscode.window as unknown as Record<string, unknown>;
  const originalInfo = window.showInformationMessage;

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension("guilhem-bonnet.llm-voice");
    assert.ok(extension);
    api = (await extension.activate()) as ExtensionTestApi;
    pipeline = api.pipeline as unknown as TestPipeline;
    window.showInformationMessage = () => Promise.resolve(undefined);
    server = new MockTtsServer({ healthBody: { status: "healthy" } });
    url = await server.listen();
    pipeline.observeVoiceGalleryForTest((message) => posted.push(message as Posted));
  });

  suiteTeardown(async () => {
    pipeline.observeVoiceGalleryForTest(undefined);
    window.showInformationMessage = originalInfo;
    await server.close();
  });

  setup(() => {
    posted = [];
    server.requests.length = 0;
    writeVoice({ providerId: "kyutai-pocket", baseUrl: url, voice: "estelle" });
  });

  teardown(() => {
    pipeline.closeVoiceGalleryForTest();
  });

  test("one tab, under a strict CSP; the real page boots by itself and nothing asks for speech", async () => {
    const original = window.createWebviewPanel as (...args: unknown[]) => unknown;
    let created = 0;
    window.createWebviewPanel = (...args: unknown[]) => {
      if (args[0] === "llmVoice.voiceGallery") {
        created += 1;
      }
      return original.apply(vscode.window, args);
    };
    const sinkBefore = api.audioSink?.commands.length;
    try {
      await vscode.commands.executeCommand("llmVoice.openVoiceGallery");
      await vscode.commands.executeCommand("llmVoice.openVoiceGallery");
      await vscode.commands.executeCommand("llmVoice.browseVoices");
    } finally {
      window.createWebviewPanel = original;
    }
    assert.equal(created, 1);

    const html = pipeline.getVoiceGalleryHtmlForTest() ?? "";
    assert.match(html, /default-src 'none'/);
    assert.match(html, /connect-src 'none'/);
    const mediaSources = /media-src ([^;]+);/.exec(html)?.[1]?.split(" ") ?? [];
    assert.ok(mediaSources.length > 0);
    for (const source of mediaSources) {
      assert.match(source, /^'self'$|^https:\/\/\*\.vscode-cdn\.net$/, "only what VS Code serves from this machine");
    }
    assert.doesNotMatch(html, /unsafe-inline|unsafe-eval|blob:/);

    // Only the page's own `ready` can have started this: nobody dispatched it here.
    await waitFor(() => posted.some((message) => message.engines?.kyutai?.status === "started"), "state after the page's ready");
    assert.ok(server.requests.some((request) => request.method === "GET" && request.url === "/health"), "the local health check ran");
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(synthesisRequests(server).length, 0, "no POST /tts before a click");
    assert.equal(pipeline.getPlaybackState() === "playing", false);
    assert.equal(api.audioSink?.commands.length, sinkBefore, "the sink hears nothing");
    assert.equal(posted.filter((message) => message.type === "trialAudio").length, 0);
  });

  test("Choisir writes engine, voice and URL together, and the next reading speaks with it", async () => {
    await vscode.commands.executeCommand("llmVoice.openVoiceGallery");

    await pipeline.dispatchVoiceGalleryMessageForTest({ type: "choose", voiceId: "alba" });

    assert.deepEqual(readVoice(), { providerId: "kyutai-pocket", baseUrl: url, voice: "alba", speed: 1 });
    assert.equal(posted.filter((message) => message.type === "state").at(-1)?.activeId, "alba");
    assert.equal(synthesisRequests(server).length, 0, "choosing is not listening");

    await pipeline.start({ scope: "clipboard", text: `Après le choix ${Date.now()}.` });
    await waitFor(() => synthesisRequests(server).length > 0, "a POST /tts from the reading");
    await pipeline.stop();
    const body = synthesisRequests(server)[0]?.body ?? "";
    assert.match(body, /name="voice_url"\s+alba/, "the reading uses the voice chosen");
  });

  test("an unknown id changes nothing and reaches no engine", async () => {
    await vscode.commands.executeCommand("llmVoice.openVoiceGallery");
    const before = readFileSync(join(storageDir(), "global-voice.json"), "utf8");

    await pipeline.dispatchVoiceGalleryMessageForTest({ type: "choose", voiceId: "nobody" });
    await pipeline.dispatchVoiceGalleryMessageForTest({ type: "trial", voiceId: "nobody", text: "x", requestId: 1 });
    await pipeline.dispatchVoiceGalleryMessageForTest({ type: "favorite", voiceId: "nobody", favorite: true });

    assert.equal(readFileSync(join(storageDir(), "global-voice.json"), "utf8"), before);
    assert.equal(synthesisRequests(server).length, 0);
    assert.ok(!(api.context.globalState.get<string[]>("llmVoice.voices.favorites") ?? []).includes("nobody"));
  });

  test("a trial phrase goes to the engine on request, is kept on this machine, and changes no voice", async () => {
    await vscode.commands.executeCommand("llmVoice.openVoiceGallery");
    const before = readFileSync(join(storageDir(), "global-voice.json"), "utf8");
    const text = `Essai ${Date.now()}.`;

    await pipeline.dispatchVoiceGalleryMessageForTest({ type: "trial", voiceId: "alba", text, requestId: 1 });

    assert.equal(synthesisRequests(server).length, 1);
    assert.match(synthesisRequests(server)[0]?.body ?? "", /name="voice_url"\s+alba/);
    const audio = posted.find((message) => message.type === "trialAudio");
    assert.ok(audio?.uri?.startsWith("https://"), "served by VS Code, like the samples");

    await pipeline.dispatchVoiceGalleryMessageForTest({ type: "trial", voiceId: "alba", text, requestId: 2 });
    assert.equal(synthesisRequests(server).length, 1, "the same phrase comes from the local cache");
    assert.equal(readFileSync(join(storageDir(), "global-voice.json"), "utf8"), before);
  });

  test("server stopped: the page is told, no request, no process", async () => {
    writeVoice({ providerId: "kyutai-pocket", baseUrl: "http://127.0.0.1:9", voice: "estelle" });
    await vscode.commands.executeCommand("llmVoice.openVoiceGallery");

    await pipeline.dispatchVoiceGalleryMessageForTest({ type: "trial", voiceId: "alba", text: "Bonjour", requestId: 3 });

    assert.ok(posted.some((message) => message.type === "trialStopped"));
    assert.equal(posted.filter((message) => message.type === "trialAudio").length, 0);
  });

  test("Kyutai narration: the same contract on its own engine, Écouter then Choisir, and the reading speaks with it", async () => {
    writeVoice({ providerId: "kyutai-1-6b", baseUrl: url, voice: "cml-577_394" });
    await vscode.commands.executeCommand("llmVoice.openVoiceGallery");
    await waitFor(() => posted.some((message) => message.engines?.kyutai16?.status === "started"), "its server seen as started");
    const state = posted.filter((message) => message.type === "state").at(-1);
    assert.equal(state?.activeId, "kyutai16:cml-577_394");
    assert.equal(synthesisRequests(server).length, 0, "no POST /tts before a click");

    await pipeline.dispatchVoiceGalleryMessageForTest({ type: "trial", voiceId: "kyutai16:estelle", text: `Essai ${Date.now()}.`, requestId: 21 });
    assert.equal(synthesisRequests(server).length, 1);
    assert.match(synthesisRequests(server)[0]?.body ?? "", /name="voice_url"\s+estelle/);
    assert.ok(posted.find((message) => message.type === "trialAudio")?.uri?.startsWith("https://"));

    server.requests.length = 0;
    await pipeline.dispatchVoiceGalleryMessageForTest({ type: "choose", voiceId: "kyutai16:cml-7601_7727" });
    assert.deepEqual(readVoice(), { providerId: "kyutai-1-6b", baseUrl: url, voice: "cml-7601_7727", speed: 1 });
    assert.equal(synthesisRequests(server).length, 0, "choosing is not listening");

    await pipeline.start({ scope: "clipboard", text: `Lecture narrée ${Date.now()}.` });
    await waitFor(() => synthesisRequests(server).length > 0, "a POST /tts from the reading");
    await pipeline.stop();
    assert.match(synthesisRequests(server)[0]?.body ?? "", /name="voice_url"\s+cml-7601_7727/);
  });

  test("Kyutai narration, server stopped: the page is told, no request, no process", async () => {
    writeVoice({ providerId: "kyutai-1-6b", baseUrl: "http://127.0.0.1:9", voice: "cml-577_394" });
    await vscode.commands.executeCommand("llmVoice.openVoiceGallery");

    await pipeline.dispatchVoiceGalleryMessageForTest({ type: "trial", voiceId: "kyutai16:cml-577_394", text: "Bonjour", requestId: 22 });

    assert.ok(posted.some((message) => message.type === "trialStopped"));
    assert.equal(synthesisRequests(server).length, 0);
  });

  test("favorites live in globalState", async () => {
    await vscode.commands.executeCommand("llmVoice.openVoiceGallery");

    // 1 échec sur 6 passes en lisant juste après l'écriture : on vérifie l'état qui se stabilise,
    // et il doit le rester deux secondes de suite pour qu'une vraie perte reste visible.
    const settles = async (wanted: boolean): Promise<void> => {
      const has = (): boolean => api.context.globalState.get<string[]>("llmVoice.voices.favorites")?.includes("vera") ?? false;
      const deadline = Date.now() + 5000;
      let stableSince = Date.now();
      while (Date.now() - stableSince < 2000) {
        if (has() !== wanted) {
          stableSince = Date.now();
        }
        assert.ok(Date.now() < deadline, `favori attendu : ${String(wanted)}, lu : ${String(has())}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    };

    await pipeline.dispatchVoiceGalleryMessageForTest({ type: "favorite", voiceId: "vera", favorite: true });
    await settles(true);

    await pipeline.dispatchVoiceGalleryMessageForTest({ type: "favorite", voiceId: "vera", favorite: false });
    await settles(false);
  });

  test("the voice menu is short and leads to the gallery", async () => {
    const original = window.showQuickPick;
    let labels: string[] = [];
    window.showQuickPick = (items: { label: string }[]) => {
      labels = items.map((item) => item.label);
      return Promise.resolve(items.find((item) => item.label === "Ouvrir la galerie"));
    };
    try {
      await vscode.commands.executeCommand("llmVoice.chooseVoice");
    } finally {
      window.showQuickPick = original;
    }
    assert.ok(labels.includes("Ouvrir la galerie"));
    assert.ok(labels.includes("Utiliser ma voix"));
    assert.ok(labels.length <= 10, `the catalogue stays out of the menu: ${labels.join(", ")}`);
    assert.ok(pipeline.getVoiceGalleryHtmlForTest()?.includes("Choisir une voix"));
    assert.equal(server.requests.length, 0, "the menu asks no engine anything");
  });

  test("every shipped sample loads in a real webview under the gallery's CSP (canplay)", async () => {
    const media = vscode.Uri.joinPath(api.context.extensionUri, "media", "voices");
    const panel = vscode.window.createWebviewPanel("llmVoice.test.canplay", "canplay", vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [media]
    });
    try {
      const nonce = randomBytes(16).toString("base64url");
      const samples = KYUTAI_POCKET_VOICE_CATALOG.map((voice) => ({
        id: voice.id,
        uri: panel.webview.asWebviewUri(vscode.Uri.joinPath(api.context.extensionUri, "media", voice.preview ?? "")).toString()
      }));
      const answer = new Promise<{ id: string; event: string; detail: unknown }[]>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("the samples did not all answer in 60 s")), 60000);
        panel.webview.onDidReceiveMessage((results: { id: string; event: string; detail: unknown }[]) => {
          clearTimeout(timer);
          resolve(results);
        });
      });
      panel.webview.html = `<!DOCTYPE html><html><head>
        <meta http-equiv="Content-Security-Policy" content="${voiceGalleryCsp(nonce, panel.webview.cspSource)}" />
        </head><body><audio id="a" preload="auto"></audio><script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
          const a = document.getElementById("a");
          const samples = ${JSON.stringify(samples)};
          const results = [];
          const next = () => {
            const sample = samples[results.length];
            if (!sample) { vscode.postMessage(results); return; }
            const done = (event, detail) => {
              a.oncanplay = null; a.onerror = null;
              results.push({ id: sample.id, event, detail });
              next();
            };
            a.oncanplay = () => done("canplay", a.duration);
            a.onerror = () => done("error", a.error && a.error.message);
            a.src = sample.uri;
            a.load();
          };
          next();
        </script></body></html>`;

      const results = await answer;

      assert.equal(results.length, 20);
      for (const result of results) {
        assert.equal(result.event, "canplay", `${result.id} did not load: ${String(result.detail)}`);
        assert.ok(typeof result.detail === "number" && result.detail > 1, `${result.id}, duration ${String(result.detail)}`);
      }
    } finally {
      panel.dispose();
    }
  }).timeout(70000);
});
