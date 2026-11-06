/**
 * The host side of the gallery, without VS Code: every message from the page is
 * validated here, and this is what writes the voice (ADR-017 § Découpe, 0-005).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { GlobalVoice, TtsBinding } from "../../../src/core/profile.js";
import { KYUTAI_POCKET_VOICE_CATALOG } from "../../../src/tts/kyutaiVoiceCatalog.js";
import {
  activeEntryId,
  bindingForEntry,
  buildVoiceMenuRows,
  GALLERY_CREDITS,
  GALLERY_ENTRIES,
  GALLERY_LINKS,
  isLoopbackUrl,
  parseGalleryMessage,
  rememberRecent,
  startCommand,
  GALLERY_VOICE_COUNT
} from "../../../src/views/voiceGallery/galleryModel.js";
import { VoiceGalleryController, type VoiceGalleryDeps } from "../../../src/views/voiceGallery/VoiceGalleryController.js";
import { KYUTAI16_VOICE_CATALOG } from "../../../src/tts/kyutai16VoiceCatalog.js";

const KNOWN = new Set(GALLERY_ENTRIES.map((entry) => entry.id));

function harness(options: {
  voice?: GlobalVoice;
  health?: (binding: { providerId: string; baseUrl: string }) => "ok" | "unreachable";
  piper?: boolean;
  synthesize?: VoiceGalleryDeps["synthesize"];
} = {}) {
  let voice: GlobalVoice = options.voice ?? { providerId: "system", speed: 1 };
  let favorites: readonly string[] = [];
  const posted: { type: string; [key: string]: unknown }[] = [];
  const deps = {
    getGlobalVoice: vi.fn(async () => voice),
    applyBinding: vi.fn(async (binding: TtsBinding & { providerId: string }) => {
      voice = { ...binding, speed: voice.speed };
    }),
    checkHealth: vi.fn(async (binding: { providerId: string; baseUrl: string }) => options.health?.(binding) ?? "unreachable"),
    isPiperInstalled: vi.fn(async () => options.piper ?? true),
    synthesize: vi.fn(options.synthesize ?? (async () => ({ uri: "res://trial/a.wav" }))),
    getFavorites: vi.fn(() => favorites),
    setFavorites: vi.fn(async (next: readonly string[]) => {
      favorites = next;
    }),
    sampleUri: (path: string) => `res://${path}`,
    writeClipboard: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined),
    prepare: vi.fn(async () => undefined),
    log: vi.fn()
  };
  const controller = new VoiceGalleryController(deps, (message) => {
    posted.push(message as { type: string });
  });
  const lastState = () => [...posted].reverse().find((message) => message.type === "state") as
    | { activeId?: string; activeLabel: string; favorites: string[]; cards: { id: string; section: string; ready: boolean; sampleUri?: string; canChoose: boolean; state?: string }[]; engines: Record<string, { status: string; command: string }> }
    | undefined;
  return { controller, deps, posted, lastState, currentVoice: () => voice };
}

describe("parseGalleryMessage: nothing from the page is trusted", () => {
  it.each([
    ["not an object", "choose"],
    ["null", null],
    ["no type", { voiceId: "estelle" }],
    ["unknown type", { type: "exec", command: "rm" }],
    ["unknown voice", { type: "choose", voiceId: "nobody" }],
    ["prototype key", { type: "choose", voiceId: "__proto__" }],
    ["voice not a string", { type: "choose", voiceId: { toString: (): string => "estelle" } }],
    ["path as a voice", { type: "trial", voiceId: "../../secret", text: "", requestId: 1 }],
    ["text not a string", { type: "trial", voiceId: "estelle", text: 3, requestId: 1 }],
    ["text too long", { type: "trial", voiceId: "estelle", text: "a".repeat(301), requestId: 1 }],
    ["no request id", { type: "trial", voiceId: "estelle", text: "x" }],
    ["favourite without boolean", { type: "favorite", voiceId: "estelle", favorite: "yes" }],
    ["unknown engine", { type: "copyCommand", engine: "rm -rf" }],
    ["unknown preparation", { type: "prepare", target: "format-disk" }],
    ["url not a string", { type: "openLink", url: 1 }]
  ])("refuses %s", (_name, raw) => {
    expect(parseGalleryMessage(raw, KNOWN)).toBeUndefined();
  });

  it("keeps what it recognised, and only that", () => {
    expect(parseGalleryMessage({ type: "choose", voiceId: "estelle", extra: "<x>" }, KNOWN)).toEqual({
      type: "choose",
      voiceId: "estelle"
    });
    expect(parseGalleryMessage({ type: "trial", voiceId: "alba", text: " bonjour ", requestId: 4 }, KNOWN)).toEqual({
      type: "trial",
      voiceId: "alba",
      text: "bonjour",
      requestId: 4
    });
  });
});

describe("Choisir", () => {
  it("writes engine, voice and URL together, and updates the card without a reload", async () => {
    const { controller, deps, lastState } = harness();
    await controller.handle({ type: "ready" });

    await controller.handle({ type: "choose", voiceId: "alba" });

    expect(deps.applyBinding).toHaveBeenCalledExactlyOnceWith({
      providerId: "kyutai-pocket",
      baseUrl: "http://localhost:8000",
      voice: "alba"
    });
    expect(lastState()?.activeId).toBe("alba");
    expect(lastState()?.activeLabel).toBe("Alba");
  });

  it("a stale sample or setting of another engine does not survive under the choice", async () => {
    const { controller, deps } = harness({
      voice: {
        providerId: "chatterbox",
        baseUrl: "http://localhost:8004",
        referenceAudio: "/x/moi.wav",
        parameters: { exaggeration: 1 },
        speed: 1
      }
    });

    await controller.handle({ type: "choose", voiceId: "estelle" });

    expect(deps.applyBinding.mock.calls[0]?.[0]).toEqual({
      providerId: "kyutai-pocket",
      baseUrl: "http://localhost:8000",
      voice: "estelle"
    });
  });

  it("keeps the URL of the server already configured for that engine", async () => {
    const { controller, deps } = harness({
      voice: { providerId: "kyutai-pocket", baseUrl: "http://127.0.0.1:9000", voice: "estelle", speed: 1 }
    });

    await controller.handle({ type: "choose", voiceId: "alba" });

    expect(deps.applyBinding.mock.calls[0]?.[0]).toMatchObject({ baseUrl: "http://127.0.0.1:9000", voice: "alba" });
  });

  it.each([
    ["system", { providerId: "system" }],
    ["piper", { providerId: "system", voice: "fr_FR-siwis-medium" }],
    ["kokoro", { providerId: "kokoro", baseUrl: "http://localhost:8880", voice: "ff_siwis" }],
    ["chatterbox", { providerId: "chatterbox", baseUrl: "http://localhost:8004" }]
  ])("%s has its whole binding", async (id, binding) => {
    const { controller, deps } = harness({ health: () => "ok" });

    await controller.handle({ type: "choose", voiceId: id });

    expect(deps.applyBinding).toHaveBeenCalledExactlyOnceWith(binding);
  });

  it("an unknown id is refused: nothing written, nothing synthesized, nothing starred", async () => {
    const { controller, deps } = harness();

    await controller.handle({ type: "choose", voiceId: "nobody" });
    await controller.handle({ type: "trial", voiceId: "nobody", text: "x", requestId: 1 });
    await controller.handle({ type: "favorite", voiceId: "nobody", favorite: true });

    expect(deps.applyBinding).not.toHaveBeenCalled();
    expect(deps.synthesize).not.toHaveBeenCalled();
    expect(deps.setFavorites).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledTimes(3);
  });

  it("refuses Piper while it is not installed, and Ma voix, which needs a file", async () => {
    const { controller, deps, posted } = harness({ piper: false });

    await controller.handle({ type: "choose", voiceId: "piper" });
    await controller.handle({ type: "choose", voiceId: "own-voice" });

    expect(deps.applyBinding).not.toHaveBeenCalled();
    expect(posted.filter((message) => message.type === "notice")).toHaveLength(2);
  });

  it("a failed write is told to the page and the card stays as it was", async () => {
    const { controller, deps, posted, lastState } = harness();
    await controller.handle({ type: "ready" });
    deps.applyBinding.mockRejectedValueOnce(new Error("disque plein"));

    await controller.handle({ type: "choose", voiceId: "alba" });

    expect(posted.find((message) => message.type === "notice")).toMatchObject({ message: expect.stringContaining("disque plein") });
    expect(lastState()?.activeId).toBe("system");
  });
});

describe("ready and health", () => {
  it("opening only ever checks health: no synthesis, no write, no clipboard", async () => {
    const { controller, deps, lastState } = harness({
      health: (binding) => (binding.providerId === "kyutai-pocket" ? "ok" : "unreachable")
    });

    await controller.handle({ type: "ready" });

    expect(deps.synthesize).not.toHaveBeenCalled();
    expect(deps.applyBinding).not.toHaveBeenCalled();
    expect(deps.writeClipboard).not.toHaveBeenCalled();
    expect(lastState()?.engines.kyutai?.status).toBe("started");
    expect(lastState()?.engines.kokoro?.status).toBe("stopped");
    expect(lastState()?.cards.find((card) => card.id === "estelle")?.ready).toBe(true);
  });

  it("gives every Kyutai voice its included sample, whatever the server does", async () => {
    const { controller, lastState } = harness();

    await controller.handle({ type: "ready" });

    const kyutai = lastState()?.cards.filter((card) => card.section === "kyutai") ?? [];
    expect(kyutai).toHaveLength(20);
    for (const card of kyutai) {
      expect(card.sampleUri).toBe(`res://voices/${card.id}.ogg`);
      expect(card.ready).toBe(false);
    }
  });

  it("never probes a server that is not on this machine", async () => {
    const { controller, deps, lastState } = harness({
      voice: { providerId: "kyutai-pocket", baseUrl: "https://tts.example.com", voice: "estelle", speed: 1 },
      health: () => "ok"
    });

    await controller.handle({ type: "ready" });

    const probed = deps.checkHealth.mock.calls.map((call) => call[0].baseUrl);
    expect(probed).not.toContain("https://tts.example.com");
    expect(probed.every((url) => isLoopbackUrl(url))).toBe(true);
    expect(lastState()?.engines.kyutai?.status).toBe("unknown");
  });

  it("places Piper by what is installed: ready, or to prepare", async () => {
    const installed = harness({ piper: true });
    await installed.controller.handle({ type: "ready" });
    expect(installed.lastState()?.cards.find((card) => card.id === "piper")).toMatchObject({ section: "local", ready: true });

    const missing = harness({ piper: false });
    await missing.controller.handle({ type: "ready" });
    expect(missing.lastState()?.cards.find((card) => card.id === "piper")).toMatchObject({
      section: "prepare",
      ready: false,
      canChoose: false,
      prepare: "piper"
    });
  });

  it("marks the active voice, or names it when it is none of the gallery's", async () => {
    const own = harness({ voice: { providerId: "chatterbox", referenceAudio: "/x/moi.wav", speed: 1 } });
    await own.controller.handle({ type: "ready" });
    expect(own.lastState()?.activeId).toBe("own-voice");

    const other = harness({ voice: { providerId: "openai-compatible", baseUrl: "http://x", voice: "nova", speed: 1 } });
    await other.controller.handle({ type: "ready" });
    expect(other.lastState()?.activeId).toBeUndefined();
    expect(other.lastState()?.activeLabel).toBe("nova");
  });
});

describe("phrase d'essai", () => {
  it("server stopped: says so with no request to the engine and no process", async () => {
    const { controller, deps, posted } = harness();

    await controller.handle({ type: "trial", voiceId: "estelle", text: "Bonjour", requestId: 7 });

    expect(deps.synthesize).not.toHaveBeenCalled();
    expect(posted.find((message) => message.type === "trialStopped")).toEqual({
      type: "trialStopped",
      requestId: 7,
      voiceId: "estelle",
      engine: "kyutai"
    });
  });

  it("server started: the phrase goes to the engine with the voice, and the audio comes back", async () => {
    const { controller, deps, posted } = harness({ health: () => "ok" });

    await controller.handle({ type: "trial", voiceId: "alba", text: "Bonjour", requestId: 8 });

    expect(deps.synthesize).toHaveBeenCalledOnce();
    expect(deps.synthesize.mock.calls[0]?.[0]).toMatchObject({ providerId: "kyutai-pocket", voice: "alba" });
    expect(deps.synthesize.mock.calls[0]?.[1]).toBe("Bonjour");
    expect(posted.find((message) => message.type === "trialAudio")).toEqual({
      type: "trialAudio",
      requestId: 8,
      voiceId: "alba",
      uri: "res://trial/a.wav"
    });
    expect(deps.applyBinding).not.toHaveBeenCalled();
  });

  it("an empty phrase on a voice with no sample uses a phrase of ours; the system voice needs no server", async () => {
    const { controller, deps } = harness();

    await controller.handle({ type: "trial", voiceId: "system", text: "", requestId: 9 });

    expect(deps.checkHealth).not.toHaveBeenCalled();
    expect(deps.synthesize.mock.calls[0]?.[1]).toBe("Bonjour. Je lis ce document à voix haute.");
  });

  it("Annuler aborts the synthesis, and nothing plays afterwards", async () => {
    let signal: AbortSignal | undefined;
    const { controller, posted } = harness({
      health: () => "ok",
      synthesize: (_binding, _text, abort) =>
        new Promise((_resolve, reject) => {
          signal = abort;
          abort.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        })
    });

    const trial = controller.handle({ type: "trial", voiceId: "alba", text: "Bonjour", requestId: 10 });
    await vi.waitFor(() => expect(signal).toBeDefined());
    await controller.handle({ type: "cancelTrial", requestId: 10 });
    await trial;

    expect(signal?.aborted).toBe(true);
    expect(posted.filter((message) => message.type === "trialAudio")).toEqual([]);
    expect(posted.filter((message) => message.type === "trialError")).toEqual([]);
  });

  it("a new trial aborts the one before it; closing aborts what is left", async () => {
    const signals: AbortSignal[] = [];
    const { controller } = harness({
      synthesize: (_binding, _text, abort) =>
        new Promise((_resolve, reject) => {
          signals.push(abort);
          abort.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        })
    });

    void controller.handle({ type: "trial", voiceId: "system", text: "un", requestId: 1 });
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    void controller.handle({ type: "trial", voiceId: "system", text: "deux", requestId: 2 });
    await vi.waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[0]?.aborted).toBe(true);

    controller.dispose();
    expect(signals[1]?.aborted).toBe(true);
  });

  it("an engine failure reaches the card", async () => {
    const { controller, posted } = harness({
      synthesize: async () => {
        throw new Error("HTTP 500");
      }
    });

    await controller.handle({ type: "trial", voiceId: "system", text: "x", requestId: 11 });

    expect(posted.find((message) => message.type === "trialError")).toMatchObject({
      requestId: 11,
      voiceId: "system",
      message: expect.stringContaining("HTTP 500")
    });
  });

  it("refuses to listen to what has no voice to speak with", async () => {
    const { controller, deps } = harness({ health: () => "ok" });

    await controller.handle({ type: "trial", voiceId: "own-voice", text: "x", requestId: 12 });
    await controller.handle({ type: "trial", voiceId: "chatterbox", text: "x", requestId: 13 });

    expect(deps.synthesize).not.toHaveBeenCalled();
  });
});

describe("favorites", () => {
  it("are kept by the host and sent back to the page", async () => {
    const { controller, deps, lastState } = harness();

    await controller.handle({ type: "favorite", voiceId: "alba", favorite: true });
    expect(deps.setFavorites).toHaveBeenLastCalledWith(["alba"]);
    expect(lastState()?.favorites).toEqual(["alba"]);

    await controller.handle({ type: "favorite", voiceId: "alba", favorite: false });
    expect(lastState()?.favorites).toEqual([]);
  });

  it("forget what is no longer in the gallery", async () => {
    const { controller, deps, lastState } = harness();
    deps.getFavorites.mockReturnValue(["alba", "gone", "__proto__"]);

    await controller.handle({ type: "ready" });

    expect(lastState()?.favorites).toEqual(["alba"]);
  });
});

describe("links, commands, preparation", () => {
  it("opens only a link of the list, and never a scheme that could run something", async () => {
    const { controller, deps } = harness();

    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "https://evil.example/", "command:llmVoice.stop"]) {
      await controller.handle({ type: "openLink", url });
    }
    expect(deps.openExternal).not.toHaveBeenCalled();

    await controller.handle({ type: "openLink", url: GALLERY_LINKS[0] });
    expect(deps.openExternal).toHaveBeenCalledExactlyOnceWith(GALLERY_LINKS[0]);
  });

  it("every allowed link is https", () => {
    for (const url of GALLERY_LINKS) {
      expect(new URL(url).protocol).toBe("https:");
    }
  });

  it("copies the command of the engine, adapted to its port, and starts nothing", async () => {
    const { controller, deps } = harness({
      voice: { providerId: "kyutai-pocket", baseUrl: "http://127.0.0.1:9000", voice: "estelle", speed: 1 }
    });

    await controller.handle({ type: "copyCommand", engine: "kyutai" });

    expect(deps.writeClipboard).toHaveBeenCalledExactlyOnceWith("pocket-tts serve --language french --port 9000");
    // The game-mode folder lives in /run/user and vanishes at each reboot; Docker refuses the mount without it.
    expect(startCommand("kyutai16", "http://localhost:8020")).toMatch(/^mkdir -p "\$XDG_RUNTIME_DIR\/gpu-yield" && docker compose /);
    expect(startCommand("kokoro", "http://localhost:8880")).toContain("-p 127.0.0.1:8880:8880");
    expect(startCommand("kokoro", "http://localhost:9000")).toContain("-p 127.0.0.1:9000:8880");
    expect(startCommand("kyutai", "http://localhost:8000")).toBe("pocket-tts serve --language french");
  });

  it("preparing refreshes what the page shows", async () => {
    const { controller, deps, lastState } = harness({ piper: false });

    await controller.handle({ type: "prepare", target: "piper" });
    expect(deps.prepare).toHaveBeenCalledExactlyOnceWith("piper");
    expect(lastState()).toBeDefined();
  });
});

describe("the model", () => {
  it("has 23 voices of the mockup, 36 of Kyutai narration, then the two to prepare; every id is distinct", () => {
    expect(KNOWN.size).toBe(GALLERY_ENTRIES.length);
    expect(GALLERY_ENTRIES).toHaveLength(23 + 36 + 2);
    expect(GALLERY_VOICE_COUNT).toBe(23 + 36);
    expect(GALLERY_ENTRIES.filter((entry) => entry.engine === "kyutai16")).toHaveLength(36);
    expect(GALLERY_ENTRIES.filter((entry) => entry.engine === "kyutai")).toHaveLength(20);
    expect(GALLERY_ENTRIES.map((entry) => entry.id)).toEqual(expect.arrayContaining(["system", "piper", "kokoro", "chatterbox", "own-voice"]));
  });

  it("round-trips: what is chosen is what is then marked active", () => {
    const current: GlobalVoice = { providerId: "system", speed: 1 };
    for (const entry of GALLERY_ENTRIES.filter((candidate) => candidate.id !== "own-voice")) {
      expect(activeEntryId(bindingForEntry(entry, current))).toBe(entry.id);
    }
  });

  it("credits name every voice of the catalogue under its real licence", () => {
    const credited = GALLERY_CREDITS.groups.flatMap((group) =>
      group.voices.split(", ").map((voice) => ({ voice, licence: group.licence }))
    );
    expect(credited.map((row) => row.voice).sort()).toEqual(KYUTAI_POCKET_VOICE_CATALOG.map((voice) => voice.label).sort());
    for (const voice of KYUTAI_POCKET_VOICE_CATALOG) {
      const row = credited.find((candidate) => candidate.voice === voice.label);
      expect(row?.licence, voice.id).toContain(voice.licence?.spdx === "CC0-1.0" ? "CC0" : "CC BY 4.0");
    }
  });

  it("credits carry what CREDITS.md says of the forbidden uses and of the model", () => {
    const shipped = readFileSync(resolve(__dirname, "../../../media/voices/CREDITS.md"), "utf8");
    expect(shipped).toContain("consentement");
    expect(GALLERY_CREDITS.clause).toContain("consentement");
    expect(GALLERY_CREDITS.clause).toContain("authentique");
    expect(GALLERY_CREDITS.groups.map((group) => group.source).join(" ")).toContain("VCTK");
    expect(GALLERY_CREDITS.engine.licence).toContain("CC BY 4.0");
    for (const { url } of GALLERY_CREDITS.links) {
      expect(GALLERY_LINKS).toContain(url);
    }
  });

  it("every sample exists, in a format the webview of VS Code can decode", () => {
    // Measured in a real webview on VS Code 1.145 (`voice-gallery.test.ts`): Ogg Opus
    // and WebM Opus are refused ("no supported streams"), Ogg Vorbis loads.
    for (const voice of KYUTAI_POCKET_VOICE_CATALOG) {
      expect(voice.preview, voice.id).toBe(`voices/${voice.id}.ogg`);
      const head = readFileSync(resolve(__dirname, "../../../media", voice.preview ?? "")).subarray(0, 64).toString("latin1");
      expect(head.startsWith("OggS"), voice.id).toBe(true);
      expect(head, voice.id).toContain("vorbis");
      expect(head, voice.id).not.toContain("OpusHead");
    }
  });

  it("rememberRecent puts the last one first, without a double and within a limit", () => {
    expect(rememberRecent(["a", "b", "c", "d", "e"], "c")).toEqual(["c", "a", "b", "d", "e"]);
    expect(rememberRecent(["a", "b", "c", "d", "e"], "z")).toEqual(["z", "a", "b", "c", "d"]);
  });
});

describe("the voice menu (Quick Pick of chooseVoice)", () => {
  it("has the recent voices, the active one first, then the gallery and Ma voix", () => {
    const rows = buildVoiceMenuRows({ activeId: "estelle", activeLabel: "Estelle", recents: ["piper", "estelle", "system"] });

    expect(rows.map((row) => row.label)).toEqual([
      "Voix récentes",
      "Estelle",
      "Piper Siwis",
      "Voix système",
      "Plus de voix",
      "Ouvrir la galerie",
      "Utiliser ma voix"
    ]);
    expect(rows[1]?.description).toBe("active");
    expect(rows.find((row) => row.label === "Ouvrir la galerie")?.description).toBe("59 voix");
  });

  it("never lists the catalogue, whatever the history", () => {
    const rows = buildVoiceMenuRows({
      activeId: "estelle",
      activeLabel: "Estelle",
      recents: GALLERY_ENTRIES.map((entry) => entry.id)
    });

    expect(rows.filter((row) => row.action?.kind === "voice").length).toBeLessThanOrEqual(5);
  });

  it("drops a recent id that no longer exists, and an active voice outside the gallery still shows", () => {
    const rows = buildVoiceMenuRows({ activeId: undefined, activeLabel: "nova", recents: ["gone", "system"] });

    expect(rows.map((row) => row.label)).toEqual([
      "Voix récentes",
      "nova",
      "Voix système",
      "Plus de voix",
      "Ouvrir la galerie",
      "Utiliser ma voix"
    ]);
    expect(rows[1]?.action).toEqual({ kind: "current" });
  });
});

describe("Kyutai narration", () => {
  const started = (binding: { providerId: string }) => (binding.providerId === "kyutai-1-6b" ? "ok" : "unreachable") as "ok" | "unreachable";
  const CAMILLE = "kyutai16:cml-577_394";

  it("lists Camille first, keeps every card when the server is stopped, and offers listening", async () => {
    const { controller, lastState } = harness();

    await controller.handle({ type: "ready" });

    const cards = lastState()?.cards.filter((card) => card.section === "kyutai16") ?? [];
    expect(cards).toHaveLength(36);
    expect(cards[0]?.id).toBe(CAMILLE);
    for (const card of cards) {
      expect(card).toMatchObject({ ready: false, canChoose: false, canListen: true, state: "Non prête" });
      expect(card.sampleUri, card.id).toBeUndefined();
    }
  });

  it("makes them ready once its own server answers, Pocket's state apart", async () => {
    const { controller, lastState } = harness({ health: started });

    await controller.handle({ type: "ready" });

    expect(lastState()?.engines.kyutai16?.status).toBe("started");
    expect(lastState()?.engines.kyutai?.status).toBe("stopped");
    expect(lastState()?.cards.find((card) => card.id === CAMILLE)).toMatchObject({ ready: true, canChoose: true, state: "Prête" });
    expect(lastState()?.cards.find((card) => card.id === "estelle")?.ready).toBe(false);
  });

  it("probes port 8020 by itself, and never synthesizes for it", async () => {
    const { controller, deps } = harness();

    await controller.handle({ type: "ready" });

    expect(deps.checkHealth).toHaveBeenCalledWith({ providerId: "kyutai-1-6b", baseUrl: "http://localhost:8020" }, expect.anything());
    expect(deps.synthesize).not.toHaveBeenCalled();
  });

  it("Choisir writes engine, voice id and port together, and marks that card, not Pocket's Estelle", async () => {
    const { controller, currentVoice, lastState } = harness({ health: started });

    await controller.handle({ type: "choose", voiceId: "kyutai16:estelle" });

    expect(currentVoice()).toEqual({ providerId: "kyutai-1-6b", baseUrl: "http://localhost:8020", voice: "estelle", speed: 1 });
    expect(lastState()?.activeId).toBe("kyutai16:estelle");
    expect(lastState()?.activeLabel).toBe("Estelle");
  });

  it("names the active voice by its first name", async () => {
    const { controller, lastState } = harness({ voice: { providerId: "kyutai-1-6b", voice: "cml-577_394", speed: 1 } });

    await controller.handle({ type: "ready" });

    expect(lastState()?.activeId).toBe(CAMILLE);
    expect(lastState()?.activeLabel).toBe("Camille");
  });

  it("a voice id outside the catalogue marks no card", () => {
    expect(activeEntryId({ providerId: "kyutai-1-6b", voice: "../../etc/passwd" })).toBeUndefined();
    expect(activeEntryId({ providerId: "kyutai-1-6b" })).toBe(CAMILLE);
  });

  it("Écouter says the server is stopped, with nothing sent to any engine", async () => {
    const { controller, deps, posted } = harness();

    await controller.handle({ type: "trial", voiceId: CAMILLE, text: "Bonjour", requestId: 1 });

    expect(posted).toContainEqual({ type: "trialStopped", requestId: 1, voiceId: CAMILLE, engine: "kyutai16" });
    expect(deps.synthesize).not.toHaveBeenCalled();
  });

  it("Écouter sends the phrase with the server's voice id, or a default phrase: there is no sample", async () => {
    const { controller, deps, posted } = harness({ health: started });

    await controller.handle({ type: "trial", voiceId: CAMILLE, text: "", requestId: 2 });

    expect(deps.synthesize).toHaveBeenCalledWith(
      { providerId: "kyutai-1-6b", baseUrl: "http://localhost:8020", voice: "cml-577_394" },
      "Bonjour. Je lis ce document à voix haute.",
      expect.anything()
    );
    expect(posted).toContainEqual({ type: "trialAudio", requestId: 2, voiceId: CAMILLE, uri: "res://trial/a.wav" });
  });

  it("copies the Compose command, and shows it unchanged whatever the port", async () => {
    const { controller, deps, lastState } = harness();

    await controller.handle({ type: "ready" });
    await controller.handle({ type: "copyCommand", engine: "kyutai16" });

    expect(deps.writeClipboard).toHaveBeenCalledWith("docker compose -f deploy/docker-compose.tts.yml up -d kyutai16");
    expect(lastState()?.engines.kyutai16?.command).toBe("docker compose -f deploy/docker-compose.tts.yml up -d kyutai16");
    expect(startCommand("kyutai16", "http://localhost:9999")).toBe("docker compose -f deploy/docker-compose.tts.yml up -d kyutai16");
  });

  it("credits name all 36 voices and what is not documented, and each link is allowed", async () => {
    const narration = GALLERY_CREDITS.narration;
    const named = narration.flatMap((group) => (group.licence.startsWith("Modèle") ? [] : group.voices.split(", ")));
    expect(named.sort()).toEqual(KYUTAI16_VOICE_CATALOG.map((voice) => voice.label).sort());
    expect(narration.map((group) => group.note ?? "").join(" ")).toContain("consentement");
    expect(narration.find((group) => group.voices === "Estelle")?.licence).toBe("CC0");
    expect(GALLERY_LINKS).toContain("https://huggingface.co/kyutai/tts-1.6b-en_fr");
    const { controller, posted } = harness();
    await controller.handle({ type: "ready" });
    const state = [...posted].reverse().find((message) => message.type === "state") as unknown as {
      credits: { groups: { source: string }[] };
      kyutai16Note: string;
    };
    expect(state.credits.groups.map((group) => group.source)).toContain("Kyutai narration, CML-TTS");
    expect(state.kyutai16Note).toContain("accent");
  });

  it("CREDITS.md says the same, and that no sample ships", () => {
    const shipped = readFileSync(resolve(__dirname, "../../../media/voices/CREDITS.md"), "utf8");
    for (const voice of KYUTAI16_VOICE_CATALOG) {
      expect(shipped, voice.label).toContain(voice.label);
    }
    expect(shipped).toContain("Aucun échantillon de ces voix");
  });
});
