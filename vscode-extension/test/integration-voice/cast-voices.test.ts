/**
 * ADR-018 §7, étape 4 : le jeu d'acteurs observé là où il se passe, le corps de `POST /tts`
 * reçu par `MockTtsServer`, à travers la vraie chaîne `ttsFor`/`createTtsProvider`/
 * `KyutaiPocketProvider`. Sink factice, aucun GPU.
 */
import * as assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";
import type { ExtensionTestApi } from "../../src/extension.js";
import { MockTtsServer } from "../fakes/mockTtsServer.js";

const NARRATOR = "cml-577_394";

interface TestPipeline {
  getPlaybackState(): string;
  getTotalChunks(): number;
  getCurrentChunkIndex(): number;
  start(source: { scope: string; text?: string; uri?: string; languageId?: string }): Promise<void>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  play(): Promise<void>;
  clearAudioCache(): Promise<void>;
  toggleCast(uri?: string): Promise<boolean | undefined>;
  describeScript(document: { uri: string; languageId: string; text: string }): Promise<{ text: string; roles: number; enabled: boolean } | undefined>;
  chooseCastVoices(): Promise<void>;
  setSceneChoiceForTest(choice: (message: string) => Thenable<string | undefined>): void;
  getPreparationForTest(): Promise<void> | undefined;
  getSpeakerLineForTest(): string | undefined;
  resetAutoTtsCacheForTest(): void;
}

function storageDir(): string {
  const dir = process.env.LLM_VOICE_TEST_STORAGE_DIR;
  assert.ok(dir);
  return dir;
}

function writeVoice(voice: Record<string, unknown>): void {
  writeFileSync(join(storageDir(), "global-voice.json"), JSON.stringify({ schemaVersion: 1, voice: { speed: 1, ...voice } }));
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`waitFor: ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function fieldOf(body: string, name: string): string | undefined {
  const match = new RegExp(`name="${name}"\\r\\n\\r\\n([\\s\\S]*?)\\r\\n--`).exec(body);
  return match?.[1];
}

interface Sent {
  text: string;
  voice: string | undefined;
}

let documents = 0;

function fileWith(text: string): string {
  documents += 1;
  const file = join(mkdtempSync(join(tmpdir(), "cast-")), `scene-${documents}-${Date.now()}.md`);
  writeFileSync(file, text);
  return vscode.Uri.file(file).toString();
}

const SCENE = [
  "% madeleine = Estelle",
  "",
  "# Scène",
  "",
  "MADELEINE : Tu arrives bien tard, Anselme.",
  "",
  "ANSELME : (essoufflé) J'ai couru depuis le pont.",
  "",
  "MADELEINE : La clef est perdue.",
  "",
  "ANSELME : Je l'ai rendue à ton frère.",
  "",
  "*Lucien entre.*",
  "",
  "LUCIEN : Vous cherchez ceci, peut-être ?",
  ""
].join("\n");

suite("voice-chain: jeu d'acteurs (ADR-018)", () => {
  let pipeline: TestPipeline;
  let server: MockTtsServer;
  let mainUrl = "";
  const window = vscode.window as unknown as Record<string, unknown>;
  const originalInfo = window.showInformationMessage;
  const originalPick = window.showQuickPick;
  let informed: string[] = [];

  const sent = (): Sent[] =>
    server.requests
      .filter((request) => request.method === "POST" && request.url === "/tts")
      .map((request) => ({ text: fieldOf(request.body, "text") ?? "", voice: fieldOf(request.body, "voice_url") }));

  async function read(uri: string): Promise<void> {
    await pipeline.start({ scope: "document", uri, languageId: "markdown" });
  }

  async function readToTheEnd(uri: string): Promise<void> {
    await read(uri);
    await waitFor(() => pipeline.getPlaybackState() === "completed", `completed, was ${pipeline.getPlaybackState()}`, 40000);
  }

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension("guilhem-bonnet.llm-voice");
    assert.ok(extension);
    const api = (await extension.activate()) as ExtensionTestApi;
    pipeline = api.pipeline as unknown as TestPipeline;
    window.showInformationMessage = (message: string) => {
      informed.push(message);
      return Promise.resolve(undefined);
    };
    server = new MockTtsServer({ healthBody: { status: "healthy", model_loaded: true }, msPerChar: 8, ttsDelayMs: 15 });
    mainUrl = await server.listen();
    writeVoice({ providerId: "kyutai-1-6b", baseUrl: mainUrl, voice: NARRATOR });
    pipeline.resetAutoTtsCacheForTest();
  });

  suiteTeardown(async () => {
    window.showInformationMessage = originalInfo;
    window.showQuickPick = originalPick;
    pipeline.setSceneChoiceForTest(() => Promise.resolve(undefined));
    await server.close();
  });

  setup(async () => {
    informed = [];
    if (pipeline.getPlaybackState() !== "idle") {
      await pipeline.stop();
    }
    await pipeline.clearAudioCache();
    server.requests.length = 0;
    server.maxConcurrentTts = 0;
  });

  test("sans activation, rien ne change : une voix, et les étiquettes sont lues comme aujourd'hui", async () => {
    const uri = fileWith(SCENE);
    await readToTheEnd(uri);
    const requests = sent();
    assert.ok(requests.length > 0);
    assert.ok(requests.every((request) => request.voice === NARRATOR));
    assert.ok(requests.some((request) => request.text.includes("MADELEINE")));
  });

  test("activer change un réglage retenu par document : aucune lecture, aucune requête", async () => {
    const uri = fileWith(SCENE);
    const before = await pipeline.describeScript({ uri, languageId: "markdown", text: SCENE });
    assert.deepEqual(before, { text: "Théâtre repéré : 3 personnages.", roles: 3, enabled: false });
    const stateBefore = pipeline.getPlaybackState();
    assert.equal(await pipeline.toggleCast(uri), true);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(pipeline.getPlaybackState(), stateBefore);
    assert.deepEqual(sent(), []);
    const after = await pipeline.describeScript({ uri, languageId: "markdown", text: SCENE });
    assert.equal(after?.enabled, true);
    assert.ok(!JSON.stringify(after).includes("Madeleine"));
    assert.equal(await pipeline.toggleCast(uri), false);
    assert.equal((await pipeline.describeScript({ uri, languageId: "markdown", text: SCENE }))?.enabled, false);
    const novel = "— Vous partez ? dit-il.\n\n— Oui.\n\n— Bien.\n";
    assert.deepEqual(await pipeline.describeScript({ uri: fileWith(novel), languageId: "markdown", text: novel }), {
      text: "Dialogues de roman : lus par le narrateur pour l'instant.",
      roles: 0,
      enabled: false
    });
  });

  test("`voice_url` suit le personnage, dans l'ordre, jamais deux requêtes à la fois ; relire ne génère rien", async () => {
    const uri = fileWith(SCENE);
    await pipeline.toggleCast(uri);
    const speakers = new Set<string>();
    await read(uri);
    await waitFor(
      () => {
        const line = pipeline.getSpeakerLineForTest();
        if (line !== undefined && pipeline.getPlaybackState() === "playing") {
          speakers.add(line);
        }
        return pipeline.getPlaybackState() === "completed";
      },
      `completed, was ${pipeline.getPlaybackState()}`,
      40000
    );

    const requests = sent();
    assert.deepEqual(
      requests.map((request) => request.text),
      [
        "Scène",
        "Tu arrives bien tard, Anselme.",
        "essoufflé",
        "J'ai couru depuis le pont.",
        "La clef est perdue.",
        "Je l'ai rendue à ton frère.",
        "Lucien entre.",
        "Vous cherchez ceci, peut-être ?"
      ]
    );
    const voices = requests.map((request) => request.voice);
    const [title, madeleine, aside, anselme, madeleineAgain, anselmeAgain, stage, lucien] = voices;
    assert.equal(title, NARRATOR);
    assert.equal(aside, NARRATOR);
    assert.equal(stage, NARRATOR);
    assert.equal(madeleine, "estelle");
    assert.equal(madeleineAgain, "estelle");
    assert.equal(anselme, anselmeAgain);
    assert.equal(new Set([NARRATOR, madeleine, anselme, lucien]).size, 4);
    assert.equal(server.maxConcurrentTts, 1);
    assert.ok(requests.every((request) => !/MADELEINE|ANSELME|LUCIEN|%/.test(request.text)));
    assert.ok(speakers.has("Narrateur · voix Camille"), [...speakers].join(" | "));
    assert.ok(speakers.has("Madeleine · voix Estelle"), [...speakers].join(" | "));

    server.requests.length = 0;
    await readToTheEnd(uri);
    assert.deepEqual(sent(), []);
    // La distribution est restée la même, puisque le cache a répondu.
  });

  test("la pause et la reprise fonctionnent entre deux voix", async () => {
    const uri = fileWith(SCENE);
    await pipeline.toggleCast(uri);
    await read(uri);
    await waitFor(() => pipeline.getCurrentChunkIndex() >= 2 && pipeline.getPlaybackState() === "playing", "third passage");
    await pipeline.pause();
    assert.equal(pipeline.getPlaybackState(), "paused");
    const index = pipeline.getCurrentChunkIndex();
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(pipeline.getCurrentChunkIndex(), index);
    await pipeline.play();
    await waitFor(() => pipeline.getPlaybackState() === "completed", `completed, was ${pipeline.getPlaybackState()}`, 40000);
    assert.equal(server.maxConcurrentTts, 1);
    assert.equal(pipeline.getCurrentChunkIndex(), pipeline.getTotalChunks() - 1);
  });

  test("une voix changée par la Distribution s'applique à la lecture suivante, et ne régénère que ses répliques", async () => {
    const uri = fileWith(SCENE);
    await pipeline.toggleCast(uri);
    await readToTheEnd(uri);
    server.requests.length = 0;
    const editor = await vscode.window.showTextDocument(vscode.Uri.parse(uri));
    assert.ok(editor);
    window.showQuickPick = (items: readonly { label: string; voiceId?: string }[]) => {
      const rows = [...items];
      return Promise.resolve(rows.find((row) => row.label === "Lucien") ?? rows.find((row) => row.voiceId === "cml-928_486"));
    };
    await pipeline.chooseCastVoices();
    window.showQuickPick = originalPick;
    assert.ok(informed.some((message) => message.includes("prochaine lecture")), informed.join(" | "));
    assert.deepEqual(sent(), []);

    await readToTheEnd(uri);
    assert.deepEqual(sent(), [{ text: "Vous cherchez ceci, peut-être ?", voice: "cml-928_486" }]);
  });

  test("au-delà de 20 s : rien ne part avant le choix ; « Préparer » remplit le cache sans lire ; la lecture ne génère plus rien", async () => {
    const lines = Array.from({ length: 40 }, (_, index) => `${index % 2 === 0 ? "ALMA" : "BRUNO"} : Réplique numéro ${index}, courte.`);
    const scene = `${lines.join("\n\n")}\n`;
    const uri = fileWith(scene);
    await pipeline.toggleCast(uri);

    const stateBefore = pipeline.getPlaybackState();
    const asked: string[] = [];
    pipeline.setSceneChoiceForTest((message) => {
      asked.push(message);
      return Promise.resolve(undefined);
    });
    await read(uri);
    await pipeline.getPreparationForTest();
    assert.equal(asked.length, 1);
    assert.match(asked[0] ?? "", /Cette scène demande environ \d+ min de préparation\./);
    assert.deepEqual(sent(), []);
    assert.equal(pipeline.getPlaybackState(), stateBefore);

    pipeline.setSceneChoiceForTest(() => Promise.resolve("Préparer"));
    await read(uri);
    await pipeline.getPreparationForTest();
    assert.equal(sent().length, 40);
    assert.equal(server.maxConcurrentTts, 1);
    assert.equal(pipeline.getPlaybackState(), stateBefore);
    assert.ok(informed.some((message) => message.includes("prêt, 40 passages")), informed.join(" | "));

    server.requests.length = 0;
    await read(uri);
    await waitFor(() => pipeline.getPlaybackState() === "playing", "playing");
    await pipeline.stop();
    assert.deepEqual(sent(), []);
  });

  test("« Lire quand même » lance la lecture, et reste un geste", async () => {
    const lines = Array.from({ length: 40 }, (_, index) => `${index % 2 === 0 ? "ALMA" : "BRUNO"} : Autre réplique ${index}, brève.`);
    const uri = fileWith(`${lines.join("\n\n")}\n`);
    await pipeline.toggleCast(uri);
    pipeline.setSceneChoiceForTest(() => Promise.resolve("Lire quand même"));
    await read(uri);
    await pipeline.getPreparationForTest();
    await waitFor(() => pipeline.getPlaybackState() === "playing", "playing");
    await pipeline.stop();
    assert.ok(sent().length >= 1);
    assert.equal(server.maxConcurrentTts, 1);
  });

  test("une sélection garde ses voix et sa distribution, et lit seulement ce qui est sélectionné", async () => {
    const uri = fileWith(SCENE);
    await pipeline.toggleCast(uri);
    await readToTheEnd(uri);
    const whole = sent();
    const anselme = whole.find((request) => request.text.startsWith("J'ai couru"))?.voice;
    assert.ok(anselme);
    await pipeline.clearAudioCache();
    server.requests.length = 0;
    await pipeline.start({
      scope: "selection",
      uri,
      languageId: "markdown",
      selection: { startLine: 6, startColumn: 0, endLine: 6, endColumn: 48 },
      selections: [
        { startLine: 6, startColumn: 0, endLine: 6, endColumn: 48 },
        { startLine: 10, startColumn: 0, endLine: 10, endColumn: 40 }
      ]
    } as unknown as Parameters<TestPipeline["start"]>[0]);
    await waitFor(() => pipeline.getPlaybackState() === "completed", `completed, was ${pipeline.getPlaybackState()}`);
    assert.deepEqual(sent(), [
      { text: "essoufflé", voice: NARRATOR },
      { text: "J'ai couru depuis le pont.", voice: anselme },
      { text: "Je l'ai rendue à ton frère.", voice: anselme }
    ]);
  });

  test("un fichier texte suit la même grammaire, ligne par ligne", async () => {
    documents += 1;
    const file = join(mkdtempSync(join(tmpdir(), "cast-")), `piece-${documents}-${Date.now()}.txt`);
    writeFileSync(file, "ALMA : Un soir.\nBRUNO : Deux matins.\n\nALMA : Trois nuits.\nBRUNO : Quatre jours.\n");
    const uri = vscode.Uri.file(file).toString();
    await pipeline.toggleCast(uri);
    await pipeline.start({ scope: "document", uri, languageId: "plaintext" });
    await waitFor(() => pipeline.getPlaybackState() === "completed", `completed, was ${pipeline.getPlaybackState()}`);
    const requests = sent();
    assert.deepEqual(requests.map((request) => request.text), ["Un soir.", "Deux matins.", "Trois nuits.", "Quatre jours."]);
    assert.equal(requests[0]?.voice, requests[2]?.voice);
    assert.equal(requests[1]?.voice, requests[3]?.voice);
    assert.notEqual(requests[0]?.voice, requests[1]?.voice);
    assert.ok(requests.every((request) => request.voice !== NARRATOR));
  });

  test("un moteur neuf : pas de préchauffage avant le choix, ni pendant la première lecture", async () => {
    const fresh = new MockTtsServer({ healthBody: { status: "healthy", model_loaded: true }, msPerChar: 8, ttsDelayMs: 15 });
    const url = await fresh.listen();
    const posted = (): string[] =>
      fresh.requests.filter((request) => request.method === "POST" && request.url === "/tts").map((request) => fieldOf(request.body, "text") ?? "");
    try {
      writeVoice({ providerId: "kyutai-1-6b", baseUrl: url, voice: NARRATOR });
      const lines = Array.from({ length: 40 }, (_, index) => `${index % 2 === 0 ? "ALMA" : "BRUNO"} : Encore une réplique ${index}.`);
      const uri = fileWith(`${lines.join("\n\n")}\n`);
      await pipeline.toggleCast(uri);
      pipeline.setSceneChoiceForTest(() => Promise.resolve(undefined));
      await read(uri);
      await pipeline.getPreparationForTest();
      assert.deepEqual(posted(), []);

      const short = fileWith(SCENE);
      await pipeline.toggleCast(short);
      await readToTheEnd(short);
      assert.equal(posted().length, 8);
      assert.equal(fresh.maxConcurrentTts, 1);
    } finally {
      writeVoice({ providerId: "kyutai-1-6b", baseUrl: mainUrl, voice: NARRATOR });
      await fresh.close();
    }
  });

  test("une voix hors 1.6B : à une voix, sans étiquette, et le motif est donné", async () => {
    const uri = fileWith(SCENE);
    await pipeline.toggleCast(uri);
    const other = new MockTtsServer({ healthBody: { status: "healthy" }, msPerChar: 2 });
    const url = await other.listen();
    try {
      writeVoice({ providerId: "kyutai-pocket", baseUrl: url, voice: "estelle" });
      await readToTheEnd(uri);
      const bodies = other.requests.filter((request) => request.method === "POST" && request.url === "/tts").map((request) => fieldOf(request.body, "voice_url"));
      assert.ok(bodies.length > 0);
      assert.ok(bodies.every((voice) => voice === "estelle"));
      assert.ok(!other.requests.some((request) => (fieldOf(request.body, "text") ?? "").includes("MADELEINE")));
      assert.ok(informed.some((message) => message.includes("demande une voix Kyutai 1.6B")), informed.join(" | "));
    } finally {
      writeVoice({ providerId: "kyutai-1-6b", baseUrl: mainUrl, voice: NARRATOR });
      await other.close();
    }
  });
});
