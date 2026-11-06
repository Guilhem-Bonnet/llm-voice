/**
 * ADR-018 §7, étape 4 : le jeu d'acteurs observé là où il se passe, le corps de `POST /tts`
 * reçu par `MockTtsServer`, à travers la vraie chaîne `ttsFor`/`createTtsProvider`/
 * `KyutaiPocketProvider`. Sink factice, aucun GPU.
 */
import * as assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  previousSegment(): Promise<void>;
  nextSegment(): Promise<void>;
  clearAudioCache(): Promise<void>;
  toggleCast(uri?: string): Promise<boolean | undefined>;
  flushCastDocumentsForTest(): Promise<void>;
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
  let api: ExtensionTestApi;
  let server: MockTtsServer;
  let mainUrl = "";
  const window = vscode.window as unknown as Record<string, unknown>;
  const originalInfo = window.showInformationMessage;
  const originalPick = window.showQuickPick;
  const originalWarning = window.showWarningMessage;
  let informed: string[] = [];
  let warned: string[] = [];

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
    api = (await extension.activate()) as ExtensionTestApi;
    pipeline = api.pipeline as unknown as TestPipeline;
    window.showInformationMessage = (message: string) => {
      informed.push(message);
      return Promise.resolve(undefined);
    };
    window.showWarningMessage = (message: string) => {
      warned.push(message);
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
    window.showWarningMessage = originalWarning;
    pipeline.setSceneChoiceForTest(() => Promise.resolve(undefined));
    await server.close();
  });

  setup(async () => {
    informed = [];
    warned = [];
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

  test("activer tient même si une autre écriture de l'état se croise avec elle", async () => {
    const uri = fileWith(SCENE);
    const key = createHash("sha256").update(uri, "utf8").digest("hex");
    const stored = (): boolean => api.context.globalState.get<Record<string, boolean>>("llmVoice.cast.documents")?.[key] === true;
    let wanted = false;
    for (let round = 0; round < 60; round += 1) {
      void api.context.globalState.update("llmVoice.test.croisement", round);
      await new Promise((resolve) => setTimeout(resolve, round % 5));
      wanted = !wanted;
      assert.equal(await pipeline.toggleCast(uri), wanted, `bascule ${round}`);
      assert.equal((await pipeline.describeScript({ uri, languageId: "markdown", text: SCENE }))?.enabled, wanted, `lecture ${round}`);
    }
    await pipeline.toggleCast(uri);
    wanted = !wanted;
    void api.context.globalState.update("llmVoice.test.croisement", undefined);
    await pipeline.flushCastDocumentsForTest();
    assert.equal(stored(), wanted);
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
    // La distribution dépend du chemin du fichier, tiré au hasard : une voix fixe tombait sur
    // celle que Lucien avait déjà (554 chemins sur 20 000), et il n'y avait rien à régénérer.
    const before = sent().find((request) => request.text.startsWith("Vous cherchez"))?.voice;
    let chosen: string | undefined;
    server.requests.length = 0;
    const editor = await vscode.window.showTextDocument(vscode.Uri.parse(uri));
    assert.ok(editor);
    window.showQuickPick = (items: readonly { label: string; voiceId?: string }[]) => {
      const rows = [...items];
      const row = rows.find((candidate) => candidate.label === "Lucien") ?? rows.find((candidate) => candidate.voiceId !== undefined && candidate.voiceId !== before);
      chosen = row?.voiceId ?? chosen;
      return Promise.resolve(row);
    };
    await pipeline.chooseCastVoices();
    window.showQuickPick = originalPick;
    assert.ok(informed.some((message) => message.includes("prochaine lecture")), informed.join(" | "));
    assert.deepEqual(sent(), []);

    await readToTheEnd(uri);
    assert.deepEqual(sent(), [{ text: "Vous cherchez ceci, peut-être ?", voice: chosen }]);
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

  /** Une scène trop longue pour partir sans poser la question. */
  function longScene(tag: string): string {
    const lines = Array.from({ length: 40 }, (_, index) => `${index % 2 === 0 ? "ALMA" : "BRUNO"} : ${tag} ${index}, courte.`);
    return fileWith(`${lines.join("\n\n")}\n`);
  }

  async function withServer(options: ConstructorParameters<typeof MockTtsServer>[0], body: (fresh: MockTtsServer) => Promise<void>): Promise<void> {
    const fresh = new MockTtsServer(options);
    const url = await fresh.listen();
    try {
      writeVoice({ providerId: "kyutai-1-6b", baseUrl: url, voice: NARRATOR });
      pipeline.resetAutoTtsCacheForTest();
      await body(fresh);
    } finally {
      writeVoice({ providerId: "kyutai-1-6b", baseUrl: mainUrl, voice: NARRATOR });
      pipeline.resetAutoTtsCacheForTest();
      await fresh.close();
    }
  }

  /** Ce profil coupe l'attente du moteur (`readyTimeoutMs: 0`) : elle est le sujet des tests à froid. */
  async function withEngineWait(body: () => Promise<void>): Promise<void> {
    const settings = vscode.workspace.getConfiguration("llmVoice");
    await settings.update("tts.readyTimeoutMs", 10000, vscode.ConfigurationTarget.Global);
    try {
      await body();
    } finally {
      await settings.update("tts.readyTimeoutMs", undefined, vscode.ConfigurationTarget.Global);
    }
  }

  function postsOf(fresh: MockTtsServer): string[] {
    return fresh.requests.filter((request) => request.method === "POST" && request.url === "/tts").map((request) => fieldOf(request.body, "text") ?? "");
  }

  function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve: (value: T) => void = () => undefined;
    const promise = new Promise<T>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  test("un fichier texte à plusieurs voix dit exactement le texte de sa lecture simple, passage par passage", async () => {
    documents += 1;
    const lines = [
      "ALMA : Voir https://example.com/a?b=1 et 3.5 km.",
      "BRUNO : Le calcul 2*3*4 est juste -> voilà.",
      "",
      "ALMA : Un _mot_ puis [un lien](http://z.fr/x) ici.",
      "BRUNO : Rien de plus."
    ];
    const file = join(mkdtempSync(join(tmpdir(), "cast-")), `piece-${documents}-${Date.now()}.txt`);
    writeFileSync(file, `${lines.join("\n")}\n`);
    const uri = vscode.Uri.file(file).toString();
    await pipeline.toggleCast(uri);
    await pipeline.start({ scope: "document", uri, languageId: "plaintext" });
    await waitFor(() => pipeline.getPlaybackState() === "completed", `completed, was ${pipeline.getPlaybackState()}`);
    assert.deepEqual(sent().map((request) => request.text), [
      "Voir https://example.com/a?b=1 et 3.5 km.",
      "Le calcul 2*3*4 est juste -> voilà.",
      "Un _mot_ puis [un lien](http://z.fr/x) ici.",
      "Rien de plus."
    ]);
    assert.deepEqual(warned, []);
  });

  test("un lien dans une réplique ne fait pas perdre la distribution du document", async () => {
    const uri = fileWith(`${SCENE}\nANSELME : Voir [la doc](http://z.fr/x) maintenant.\n`);
    await pipeline.toggleCast(uri);
    await readToTheEnd(uri);
    const requests = sent();
    assert.deepEqual(warned, []);
    const link = requests.find((request) => request.text === "Voir la doc maintenant.");
    assert.ok(link, JSON.stringify(requests));
    assert.equal(link.voice, requests.find((request) => request.text.startsWith("J'ai couru"))?.voice);
    assert.notEqual(link.voice, NARRATOR);
  });

  test("Préparer à froid : le moteur charge avant le premier passage", async () => {
    await withEngineWait(() =>
      withServer({ healthBody: { status: "healthy", model_loaded: false }, msPerChar: 2 }, async (fresh) => {
        pipeline.setSceneChoiceForTest(() => Promise.resolve("Préparer"));
        const uri = longScene("Froid");
        await pipeline.toggleCast(uri);
        await read(uri);
        await pipeline.getPreparationForTest();
        const posts = fresh.requests.filter((request) => request.method === "POST").map((request) => request.url);
        assert.equal(posts[0], "/load", posts.slice(0, 3).join(" "));
        assert.equal(posts.filter((url) => url === "/tts").length, 40);
      })
    );
  });

  for (const [reason, cause] of [["gpu_yield", "La voix se met en retrait pendant le jeu"], ["gpu_memory", "La carte graphique n'a pas assez de mémoire"]] as const) {
    test(`Préparer suspendue (${reason}) : la vraie cause, une seule demande, et rien ne repart`, async () => {
      await withServer({ healthBody: { status: "healthy", model_loaded: true }, msPerChar: 2, ttsHold: reason }, async (fresh) => {
        pipeline.setSceneChoiceForTest(() => Promise.resolve("Préparer"));
        const uri = longScene(`Suspendue ${reason}`);
        await pipeline.toggleCast(uri);
        await read(uri);
        await pipeline.getPreparationForTest();
        assert.equal(postsOf(fresh).length, 1);
        assert.equal(warned.length, 1, warned.join(" | "));
        assert.ok(warned[0]?.includes(cause), warned[0]);
        assert.ok(warned[0]?.includes("0 passages sur 40"), warned[0]);
        assert.ok(!warned[0]?.includes("ne répond pas"), warned[0]);
      });
    });
  }

  test("Préparer en échec : le message donne la cause, sans dire que le moteur ne répond pas", async () => {
    await withServer({ healthBody: { status: "healthy", model_loaded: true }, msPerChar: 2, fail500: true }, async () => {
      pipeline.setSceneChoiceForTest(() => Promise.resolve("Préparer"));
      const uri = longScene("Échec");
      await pipeline.toggleCast(uri);
      await read(uri);
      await pipeline.getPreparationForTest();
      assert.equal(warned.length, 1, warned.join(" | "));
      assert.ok(warned[0]?.includes("simulated failure"), warned[0]);
      assert.ok(!warned[0]?.includes("ne répond pas"), warned[0]);
    });
  });

  for (const answer of ["Lire quand même", "Préparer"]) {
    test(`Arrêter ferme la question : « ${answer} » donné après Stop ne lance rien`, async () => {
      const uri = longScene(`Question ${answer}`);
      await pipeline.toggleCast(uri);
      const choice = deferred<string | undefined>();
      let asked = 0;
      pipeline.setSceneChoiceForTest(() => {
        asked += 1;
        return choice.promise;
      });
      const stateBefore = pipeline.getPlaybackState();
      await read(uri);
      await waitFor(() => asked === 1, "la question");
      await pipeline.stop();
      assert.ok(!informed.includes("LLM Voice : rien à arrêter."), informed.join(" | "));
      choice.resolve(answer);
      await pipeline.getPreparationForTest();
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.deepEqual(sent(), []);
      assert.equal(pipeline.getPlaybackState(), stateBefore);
    });
  }

  test("Arrêter annule une préparation en cours : plus aucune requête, pas de « prêt »", async () => {
    await withServer({ healthBody: { status: "healthy", model_loaded: true }, msPerChar: 2, ttsDelayMs: 50 }, async (fresh) => {
      pipeline.setSceneChoiceForTest(() => Promise.resolve("Préparer"));
      const uri = longScene("Annulée");
      await pipeline.toggleCast(uri);
      await read(uri);
      await waitFor(() => postsOf(fresh).length >= 2, "deux passages préparés");
      await pipeline.stop();
      await pipeline.getPreparationForTest();
      const count = postsOf(fresh).length;
      assert.ok(count < 40, String(count));
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(postsOf(fresh).length, count);
      assert.ok(!informed.some((message) => message.includes("prêt")), informed.join(" | "));
      assert.deepEqual(warned, []);
    });
  });

  test("Arrêter pendant le chargement du moteur : aucune synthèse ne part", async () => {
    await withEngineWait(() =>
      withServer({ healthBody: { status: "healthy", state: "loading", model_loaded: false }, msPerChar: 2 }, async (fresh) => {
        pipeline.setSceneChoiceForTest(() => Promise.resolve("Préparer"));
        const uri = longScene("Chargement");
        await pipeline.toggleCast(uri);
        await read(uri);
        await waitFor(() => fresh.requests.some((request) => request.method === "POST" && request.url === "/load"), "POST /load");
        await pipeline.stop();
        await pipeline.getPreparationForTest();
        await new Promise((resolve) => setTimeout(resolve, 200));
        assert.deepEqual(postsOf(fresh), []);
      })
    );
  });

  test("« Lire » répondu à « prêt » après un Stop ne lance rien", async () => {
    const uri = longScene("Prêt");
    await pipeline.toggleCast(uri);
    pipeline.setSceneChoiceForTest(() => Promise.resolve("Préparer"));
    const answer = deferred<string | undefined>();
    let ready = false;
    window.showInformationMessage = (message: string) => {
      informed.push(message);
      if (message.includes("prêt")) {
        ready = true;
        return answer.promise;
      }
      return Promise.resolve(undefined);
    };
    try {
      await read(uri);
      await waitFor(() => ready, "le message « prêt »");
      await pipeline.stop();
      const stateAfterStop = pipeline.getPlaybackState();
      answer.resolve("Lire");
      await pipeline.getPreparationForTest();
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.equal(pipeline.getPlaybackState(), stateAfterStop);
    } finally {
      window.showInformationMessage = (message: string) => {
        informed.push(message);
        return Promise.resolve(undefined);
      };
    }
  });

  test("un narrateur absent de `/voices` : le message dit cela, et non qu'il faut une voix 1.6B", async () => {
    await withServer(
      { healthBody: { status: "healthy", model_loaded: true }, msPerChar: 2, kyutaiVoices: { voices: [{ id: "estelle", available: true }] } },
      async () => {
        const uri = fileWith(SCENE);
        await pipeline.toggleCast(uri);
        await readToTheEnd(uri);
        assert.ok(informed.some((message) => message.includes("voix du narrateur n'est pas disponible")), informed.join(" | "));
        assert.ok(!informed.some((message) => message.includes("demande une voix Kyutai 1.6B")), informed.join(" | "));
      }
    );
  });

  test("le préchauffage n'est coupé que si la lecture passe réellement par le jeu d'acteurs", async () => {
    const settings = vscode.workspace.getConfiguration("llmVoice");
    await settings.update("tts.warmup", true, vscode.ConfigurationTarget.Global);
    const warmed = (fresh: MockTtsServer): boolean => postsOf(fresh).includes("Bonjour, ceci fonctionne.");
    const options = { healthBody: { status: "healthy", model_loaded: true }, msPerChar: 2 };
    try {
      await withServer(options, async (fresh) => {
        const uri = fileWith("Un texte sans aucun personnage. Il se lit seul.\n");
        await pipeline.toggleCast(uri);
        await readToTheEnd(uri);
        await waitFor(() => warmed(fresh), "le préchauffage d'un document activé sans personnage", 3000);
      });
      await withServer(options, async (fresh) => {
        const uri = fileWith(SCENE);
        await pipeline.toggleCast(uri);
        await readToTheEnd(uri);
        await new Promise((resolve) => setTimeout(resolve, 200));
        assert.equal(warmed(fresh), false, postsOf(fresh).join(" | "));
      });
    } finally {
      await settings.update("tts.warmup", undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test("Précédent et Suivant vont de réplique en réplique, chacune à sa voix", async () => {
    await withServer({ healthBody: { status: "healthy", model_loaded: true }, msPerChar: 150 }, async (fresh) => {
      const uri = fileWith(SCENE);
      await pipeline.toggleCast(uri);
      await read(uri);
      await waitFor(() => pipeline.getPlaybackState() === "playing" && pipeline.getCurrentChunkIndex() === 0, "premier passage");
      assert.equal(pipeline.getSpeakerLineForTest(), "Narrateur · voix Camille");
      await nextPassage(1);
      assert.equal(pipeline.getSpeakerLineForTest(), "Madeleine · voix Estelle");
      await nextPassage(2);
      assert.equal(pipeline.getSpeakerLineForTest(), "Narrateur · voix Camille");
      await nextPassage(3);
      const anselme = pipeline.getSpeakerLineForTest();
      assert.match(anselme ?? "", /^Anselme · voix /);
      await pipeline.previousSegment();
      await waitFor(() => pipeline.getCurrentChunkIndex() === 2 && pipeline.getPlaybackState() === "playing", "retour au passage 2");
      assert.equal(pipeline.getSpeakerLineForTest(), "Narrateur · voix Camille");
      await nextPassage(3);
      assert.equal(pipeline.getSpeakerLineForTest(), anselme);
      await pipeline.stop();
      const voices = new Map(
        fresh.requests
          .filter((request) => request.method === "POST" && request.url === "/tts")
          .map((request) => [fieldOf(request.body, "text"), fieldOf(request.body, "voice_url")])
      );
      assert.equal(voices.get("Scène"), NARRATOR);
      assert.equal(voices.get("Tu arrives bien tard, Anselme."), "estelle");
      assert.equal(voices.get("essoufflé"), NARRATOR);
      assert.ok(![NARRATOR, "estelle"].includes(voices.get("J'ai couru depuis le pont.") ?? NARRATOR));
    });
  });

  async function nextPassage(index: number): Promise<void> {
    await pipeline.nextSegment();
    await waitFor(() => pipeline.getCurrentChunkIndex() === index && pipeline.getPlaybackState() === "playing", `passage ${index}, à ${pipeline.getCurrentChunkIndex()}`);
  }

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
