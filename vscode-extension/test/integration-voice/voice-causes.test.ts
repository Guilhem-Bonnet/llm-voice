/**
 * ADR-017 §1.1, the four causes of "the voice I chose is not the one I hear",
 * observed where they happen: the body of `POST /tts` received by
 * `MockTtsServer`, through the real `ttsFor`/`createTtsProvider`/
 * `ChatterboxProvider` chain (`voice-chain` profile, ADR-017 § Tests).
 *
 * These assertions were first run red against the model before ADR-017, with
 * `seed` and `chooseVoice` driving a voice per profile; the failures are recorded in
 * `_grimoire-output/evidence/GAO-refonte-ux-0-004/evidence-pack.md`.
 */
import * as assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";
import type { ExtensionTestApi } from "../../src/extension.js";
import type { TtsBinding, VoiceProfile } from "../../src/core/profile.js";
import { MockTtsServer } from "../fakes/mockTtsServer.js";
import { makeSilentWav } from "../fakes/wav.js";

const MAIN_PORT = 47611;
const OTHER_PORT = 47612;
const AUTO_PORT = 47613;
const MAIN_URL = `http://127.0.0.1:${MAIN_PORT}`;
const OTHER_URL = `http://127.0.0.1:${OTHER_PORT}`;

interface TestPipeline {
  getPlaybackState(): string;
  start(source: { scope: string; text?: string; uri?: string; languageId?: string }): Promise<void>;
  stop(): Promise<void>;
  selectProfileById(id: string): Promise<void>;
  chooseVoiceById(voiceId: string): Promise<void>;
  applyVoiceTierChoice(tier: "system" | "piper" | "chatterbox"): Promise<void>;
  previewVoice(profile: VoiceProfile, voiceId: string): Promise<void>;
  speakLatestResponse(): Promise<void>;
  listInboxEntriesForTest(): Promise<readonly { message: { message: string } }[]>;
  clearAudioCache(): Promise<void>;
  resetAutoTtsCacheForTest(): void;
  getPerformanceSnapshotForTest(): { cacheHits: number; cacheMisses: number };
  getSpeedGapForTest(): string | undefined;
  closeVoiceGalleryForTest(): void;
}

function storageDir(): string {
  const dir = process.env.LLM_VOICE_TEST_STORAGE_DIR;
  assert.ok(dir, "LLM_VOICE_TEST_STORAGE_DIR should be set by .vscode-test.mjs");
  return dir;
}

function mode(id: string, tts: TtsBinding): VoiceProfile {
  return {
    id,
    label: id,
    mode: "faithful",
    language: "fr-FR",
    tts,
    chunking: { unit: "sentence", maxSentences: 3, prefetchChunks: 0 },
    playback: { rate: 1, volume: 1 }
  };
}

function writeMode(modes: readonly VoiceProfile[]): void {
  writeFileSync(
    join(storageDir(), "profiles.json"),
    JSON.stringify({ schemaVersion: 2, voiceMigration: 1, defaultProfileId: "chain-last", profiles: modes })
  );
}

function writeVoice(voice: TtsBinding & { providerId: string }, speed = 1): void {
  writeFileSync(
    join(storageDir(), "global-voice.json"),
    JSON.stringify({ schemaVersion: 1, voice: { ...voice, speed } })
  );
}

/** Three modes that inherit: the last chosen one, the one of documents, the one of Claude's replies. */
function seed(voice: TtsBinding & { providerId: string }, speed = 1, rate = 1): void {
  writeVoice(voice, speed);
  writeMode([
    { ...mode("chain-last", {}), playback: { rate, volume: 1 } },
    mode("chain-document", {}),
    mode("chain-reply", {})
  ]);
}

async function chooseVoice(pipeline: TestPipeline, voiceId: string): Promise<void> {
  await pipeline.chooseVoiceById(voiceId);
}

function persistedVoice(): TtsBinding {
  return (JSON.parse(readFileSync(join(storageDir(), "global-voice.json"), "utf8")) as { voice: TtsBinding }).voice;
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`waitFor: ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Answers every notification, including the one-action Piper offer of a system engine, with nothing. */
function declineNotifications(): () => void {
  const window = vscode.window as unknown as Record<string, unknown>;
  const original = window.showInformationMessage;
  window.showInformationMessage = () => Promise.resolve(undefined);
  return () => {
    window.showInformationMessage = original;
  };
}

interface TtsBody {
  text: string;
  voice_mode: string;
  predefined_voice_id?: string;
  reference_audio_filename?: string;
}

function ttsBodies(server: MockTtsServer): TtsBody[] {
  return server.requests
    .filter((request) => request.method === "POST" && request.url === "/tts")
    .map((request) => JSON.parse(request.body) as TtsBody);
}

suite("voice-chain: causes A, B, C, D (ADR-017 §1.1)", () => {
  let api: ExtensionTestApi;
  let pipeline: TestPipeline;
  let main: MockTtsServer;
  let other: MockTtsServer;
  let sampleDir: string;
  let samplePath: string;
  let secondSamplePath: string;
  const documentUri = (): vscode.Uri => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder);
    return vscode.Uri.file(join(folder.uri.fsPath, "markdown", "short.md"));
  };

  /** Reads `text` as a clipboard source and waits for one audible chunk, then stops. */
  async function readClipboard(text: string): Promise<void> {
    await pipeline.start({ scope: "clipboard", text });
    await waitFor(() => pipeline.getPlaybackState() === "playing", `playing, was ${pipeline.getPlaybackState()}`);
    await pipeline.stop();
  }

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension("guilhem-bonnet.llm-voice");
    assert.ok(extension);
    api = (await extension.activate()) as ExtensionTestApi;
    pipeline = api.pipeline as unknown as TestPipeline;
    assert.ok(api.audioSink, "LLM_VOICE_TEST_FAKE_SINK=1 should inject the fake sink");
    assert.equal(api.ttsProvider, undefined, "this profile must not inject the fake TTS provider");
    main = new MockTtsServer();
    await main.listen(MAIN_PORT);
    other = new MockTtsServer();
    await other.listen(OTHER_PORT);
    sampleDir = mkdtempSync(join(tmpdir(), "llm-voice-voice-chain-"));
    samplePath = join(sampleDir, "sample-one.wav");
    secondSamplePath = join(sampleDir, "sample-two.wav");
    writeFileSync(samplePath, makeSilentWav(200, 16000));
    writeFileSync(secondSamplePath, makeSilentWav(300, 16000));
  });

  suiteTeardown(async () => {
    await main.close();
    await other.close();
    rmSync(sampleDir, { recursive: true, force: true });
  });

  setup(async () => {
    main.requests.length = 0;
    other.requests.length = 0;
    main.uploadedReferenceFilenames.length = 0;
    seed({ providerId: "chatterbox", baseUrl: MAIN_URL, voice: "voice-initial" });
    await pipeline.selectProfileById("chain-last");
    await pipeline.clearAudioCache();
    pipeline.resetAutoTtsCacheForTest();
  });

  teardown(async () => {
    if (pipeline.getPlaybackState() !== "idle") {
      await pipeline.stop();
    }
  });

  test("V1, cause C: the voice chosen is the one a document asks the server for", async () => {
    await chooseVoice(pipeline, "voice-x");
    await pipeline.start({ scope: "document", uri: documentUri().toString(), languageId: "markdown" });
    await waitFor(() => ttsBodies(main).length > 0, "a POST /tts for the document");
    const body = ttsBodies(main)[0];
    assert.equal(body?.voice_mode, "predefined");
    assert.equal(body?.predefined_voice_id, "voice-x");
  });

  test("V1, cause C: the voice chosen is the one a Claude reply asks the server for", async () => {
    const inbox = process.env.LLM_VOICE_INBOX;
    assert.ok(inbox);
    const message = `Réponse de test ${Date.now()}.`;
    const sessionId = `voice-chain-${Date.now()}`;
    writeFileSync(
      join(inbox, `${Date.now()}-${sessionId}.json`),
      JSON.stringify({
        schemaVersion: 1,
        provider: "claude-code",
        sessionId,
        capturedAt: Date.now(),
        cwd: "/tmp/voice-chain",
        message
      })
    );
    await chooseVoice(pipeline, "voice-x");
    await pipeline.speakLatestResponse();
    await waitFor(() => ttsBodies(main).length > 0, "a POST /tts for the reply");
    const body = ttsBodies(main)[0];
    assert.equal(body?.voice_mode, "predefined");
    assert.equal(body?.predefined_voice_id, "voice-x");
  });

  test("V2, cause A: choosing a catalogue voice ends the cloning", async () => {
    seed({ providerId: "chatterbox", baseUrl: MAIN_URL, voice: "voice-initial", referenceAudio: samplePath });
    await readClipboard(`Avec échantillon ${Date.now()}.`);
    assert.equal(ttsBodies(main).at(-1)?.voice_mode, "clone", "the sample is what the server gets first");

    await chooseVoice(pipeline, "voice-x");
    await readClipboard(`Après le choix ${Date.now()}.`);
    const body = ttsBodies(main).at(-1);
    assert.equal(body?.voice_mode, "predefined");
    assert.equal(body?.predefined_voice_id, "voice-x");
    assert.equal(persistedVoice().referenceAudio, undefined, "the voice was replaced whole");
  });

  test("V2, cause A: the preview of a catalogue voice does not replay the sample", async () => {
    await pipeline.previewVoice(
      mode("chain-last", {
        providerId: "chatterbox",
        baseUrl: MAIN_URL,
        voice: "voice-initial",
        referenceAudio: samplePath
      }),
      "voice-x"
    );
    await waitFor(() => ttsBodies(main).length > 0, "a POST /tts for the preview");
    const body = ttsBodies(main).at(-1);
    assert.equal(body?.voice_mode, "predefined");
    assert.equal(body?.predefined_voice_id, "voice-x");
    assert.equal(main.uploadedReferenceFilenames.length, 0, "nothing of the old voice reached the server");
  });

  test("V3, cause B: same text, another sample: the synthesis starts again", async () => {
    const text = `Texte relu ${Date.now()}.`;
    seed({ providerId: "chatterbox", baseUrl: MAIN_URL, voice: "voice-initial", referenceAudio: samplePath });
    await readClipboard(text);
    assert.equal(ttsBodies(main).length, 1);

    await readClipboard(text);
    assert.equal(ttsBodies(main).length, 1, "same text, same voice: served by the cache");

    seed({ providerId: "chatterbox", baseUrl: MAIN_URL, voice: "voice-initial", referenceAudio: secondSamplePath });
    await readClipboard(text);
    assert.equal(ttsBodies(main).length, 2, "another sample is another voice: the cache must not answer");
  });

  test("V3, cause B: same text, another URL: the synthesis starts again, on the new server", async () => {
    const text = `Autre serveur ${Date.now()}.`;
    await readClipboard(text);
    assert.equal(ttsBodies(main).length, 1);

    seed({ providerId: "chatterbox", baseUrl: OTHER_URL, voice: "voice-initial" });
    await readClipboard(text);
    assert.equal(ttsBodies(other).length, 1, "another server is another voice: the cache must not answer");
  });

  test("V3, cause B: `auto` resolved elsewhere: the synthesis starts again, at the right engine", async () => {
    const restore = declineNotifications();
    const autoServer = new MockTtsServer();
    await autoServer.listen(AUTO_PORT);
    try {
      const text = `Moteur résolu ${Date.now()}.`;
      // A named voice: otherwise each engine's default voice would split the key,
      // and this test would pass even with `auto` hashed as written.
      seed({ providerId: "auto", voice: "voice-named" });
      await readClipboard(text);
      assert.equal(ttsBodies(autoServer).length, 1, "`auto` resolves to the fixed-port Chatterbox");

      await readClipboard(text);
      assert.equal(ttsBodies(autoServer).length, 1, "same engine, same text: served by the cache");
      assert.equal(pipeline.getPerformanceSnapshotForTest().cacheHits, 1);

      await autoServer.close();
      pipeline.resetAutoTtsCacheForTest();
      await readClipboard(text);
      const after = pipeline.getPerformanceSnapshotForTest();
      assert.equal(after.cacheHits, 0, "another engine is another voice: the cache must not answer");
      assert.equal(after.cacheMisses, 1, "the system engine synthesised it");
      assert.equal(ttsBodies(autoServer).length, 1, "and the stopped server was not asked");
    } finally {
      restore();
      await autoServer.close().catch(() => undefined);
    }
  });

  test("V3 and V11: an engine that declares `speed` receives the product, and the cache follows it", async () => {
    const speeches = (): { speed?: number }[] =>
      main.requests
        .filter((request) => request.url === "/v1/audio/speech")
        .map((request) => JSON.parse(request.body) as { speed?: number });
    const text = `Vitesse moteur ${Date.now()}.`;
    seed({ providerId: "kokoro", baseUrl: MAIN_URL, voice: "ff_siwis" }, 1.5, 1.1);
    await readClipboard(text);
    assert.equal(speeches().length, 1);
    assert.ok(Math.abs((speeches()[0]?.speed ?? 0) - 1.65) < 1e-9, `body speed was ${speeches()[0]?.speed}`);

    await readClipboard(text);
    assert.equal(speeches().length, 1, "same text, same speed: served by the cache");

    seed({ providerId: "kokoro", baseUrl: MAIN_URL, voice: "ff_siwis" }, 2, 1.1);
    await readClipboard(text);
    assert.equal(speeches().length, 2, "another speed is another audio");
    assert.equal(speeches()[1]?.speed, 2, "brought back within what the engine declares");
    assert.equal(pipeline.getSpeedGapForTest(), "×2, maximum de cette voix");
  });

  test("V11: an engine without `speed` gets none, and the gap is known, the factor of the mode alone included", async () => {
    seed({ providerId: "chatterbox", baseUrl: MAIN_URL, voice: "voice-initial" }, 1, 1.1);
    await readClipboard(`Sans voie ${Date.now()}.`);
    assert.equal((ttsBodies(main).at(-1) as unknown as { speed?: number }).speed, undefined);
    assert.equal(pipeline.getSpeedGapForTest(), "Vitesse non disponible avec cette voix");
  });

  test("V1: a mode with a voice of its own keeps it: the one case left, and the voice stays global", async () => {
    writeVoice({ providerId: "chatterbox", baseUrl: MAIN_URL, voice: "voice-global" });
    writeMode([
      mode("chain-last", { providerId: "chatterbox", baseUrl: MAIN_URL, voice: "voice-own" }),
      mode("chain-document", {}),
      mode("chain-reply", {})
    ]);
    await chooseVoice(pipeline, "voice-x");
    assert.equal(persistedVoice().voice, "voice-x", "chooseVoice always writes the global voice");
    await readClipboard(`Voix propre ${Date.now()}.`);
    assert.equal(ttsBodies(main).at(-1)?.predefined_voice_id, "voice-own");
  });

  test("V8: aliases and new commands answer; choosing a mode leaves global-voice.json alone (V5, V14)", async () => {
    const before = readFileSync(join(storageDir(), "global-voice.json"), "utf8");
    const stateBefore = pipeline.getPlaybackState();
    const sinkCommandsBefore = api.audioSink?.commands.length;
    for (const command of [
      "llmVoice.chooseMode",
      "llmVoice.selectProfile",
      "llmVoice.chooseVoice",
      "llmVoice.setupVoice",
      "llmVoice.browseVoices"
    ]) {
      const opened = vscode.commands.executeCommand(command);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await vscode.commands.executeCommand("workbench.action.closeQuickOpen");
      await assert.doesNotReject(Promise.resolve(opened), command);
    }
    pipeline.closeVoiceGalleryForTest();
    await pipeline.selectProfileById("chain-document");
    assert.equal(readFileSync(join(storageDir(), "global-voice.json"), "utf8"), before);
    assert.equal(pipeline.getPlaybackState(), stateBefore, "nothing of this starts a reading");
    assert.equal(api.audioSink?.commands.length, sinkCommandsBefore, "and the sink hears nothing of it");
    assert.equal(ttsBodies(main).length, 0, "nothing of this reaches the engine's synthesis");
  });

  test("opening the voice picker starts no synthesis, even with the warm-up on; a reading then warms the engine", async () => {
    const restore = declineNotifications();
    const config = vscode.workspace.getConfiguration("llmVoice");
    const server = new MockTtsServer();
    const url = await server.listen();
    const previousWarmup = config.inspect<boolean>("tts.warmup")?.globalValue;
    await config.update("tts.warmup", true, vscode.ConfigurationTarget.Global);
    try {
      seed({ providerId: "chatterbox", baseUrl: url, voice: "voice-initial" });
      const opened = vscode.commands.executeCommand("llmVoice.chooseVoice");
      await new Promise((resolve) => setTimeout(resolve, 500));
      await vscode.commands.executeCommand("workbench.action.closeQuickOpen");
      await opened;
      assert.equal(ttsBodies(server).length, 0);

      await readClipboard(`Préchauffage ${Date.now()}.`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.ok(ttsBodies(server).length >= 2, "the reading and its warm-up both reach the engine");
    } finally {
      await config.update("tts.warmup", previousWarmup, vscode.ConfigurationTarget.Global);
      await server.close();
      restore();
    }
  });

  test("the tiers of setupVoice, now of chooseVoice, write the whole global voice and leave the modes alone", async () => {
    const restore = declineNotifications();
    try {
      seed({ providerId: "chatterbox", baseUrl: MAIN_URL, voice: "voice-initial", referenceAudio: samplePath });
      const modes = readFileSync(join(storageDir(), "profiles.json"), "utf8");
      await pipeline.applyVoiceTierChoice("system");
      assert.deepEqual(persistedVoice(), { providerId: "system", speed: 1 });
      await pipeline.applyVoiceTierChoice("piper");
      assert.deepEqual(persistedVoice(), { providerId: "system", voice: "fr_FR-siwis-medium", speed: 1 });
      assert.equal(readFileSync(join(storageDir(), "profiles.json"), "utf8"), modes);
    } finally {
      restore();
    }
  });

  test("V4, cause D: a voice listed by the engine `auto` resolved to is saved with that engine", async () => {
    const autoServer = new MockTtsServer();
    await autoServer.listen(AUTO_PORT);
    try {
      seed({ providerId: "auto" });
      await readClipboard(`Résolution auto ${Date.now()}.`);
      assert.equal(ttsBodies(autoServer).length, 1, "`auto` resolves to the fixed-port Chatterbox");

      await chooseVoice(pipeline, "voice-x");
      assert.equal(persistedVoice().voice, "voice-x");
      assert.equal(persistedVoice().providerId, "chatterbox", "a voice id means nothing without its engine");
    } finally {
      await autoServer.close();
    }
  });
});
