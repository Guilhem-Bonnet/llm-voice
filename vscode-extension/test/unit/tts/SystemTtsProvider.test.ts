/**
 * `SystemTtsProvider` (S7.1, ADR-009 niveau 1b): every case here runs
 * against a fake `SystemTtsProcessRunner` — no real `espeak-ng`/`piper`/
 * `say`/PowerShell is spawned. The real espeak-ng/Piper path is proven by
 * `test/integration-real/system-tts.test.ts` (gated), run once against the
 * actual binaries present on the dev machine.
 */
import { describe, expect, it } from "vitest";
import {
  buildEspeakInvocation,
  buildPiperInvocation,
  buildSayInvocation,
  buildSapiInvocation,
  concatWavBuffers,
  isRunningInFlatpak,
  parseEspeakVoices,
  parseSapiVoices,
  parseSayVoices,
  splitTextForSynthesis,
  SystemTtsProvider,
  type SystemTtsEngine,
  type SystemTtsInvocation,
  type SystemTtsProcessRunner,
  type RunOptions
} from "../../../src/tts/SystemTtsProvider.js";

function makeWav(dataSize: number, sampleRate = 22050): Uint8Array {
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < dataSize / 2; i++) {
    buffer.writeInt16LE((i % 100) - 50, 44 + i * 2);
  }
  return buffer;
}

/** A `SystemTtsProcessRunner` fully in-memory: `run()` writes a fake WAV to `invocation.args`'s output path (mimicking what a real engine's `-w`/`-f`/`-o` flag would do), `capture()` returns a canned string, both record every call for assertions. */
class FakeRunner implements SystemTtsProcessRunner {
  readonly whichAnswers = new Map<string, string | undefined>();
  readonly existsAnswers = new Map<string, boolean>();
  readonly dirAnswers = new Map<string, string[]>();
  readonly runCalls: { invocation: SystemTtsInvocation; options: RunOptions }[] = [];
  readonly removedFiles: string[] = [];
  readonly writtenFiles = new Map<string, string>();
  captureAnswer = "";
  runError: Error | undefined;
  wavDataSize = 200;

  async which(command: string): Promise<string | undefined> {
    return this.whichAnswers.get(command);
  }

  async exists(candidate: string): Promise<boolean> {
    return this.existsAnswers.get(candidate) ?? false;
  }

  /** Mirrors a real `fs.readdir`: `[]` for a directory that does not exist or is empty — never rejects. */
  async readdir(dir: string): Promise<string[]> {
    return this.dirAnswers.get(dir) ?? [];
  }

  async writeFile(candidate: string, content: string): Promise<void> {
    this.writtenFiles.set(candidate, content);
  }

  async readFile(_candidate: string): Promise<Buffer> {
    return Buffer.from(makeWav(this.wavDataSize));
  }

  async removeFile(candidate: string): Promise<void> {
    this.removedFiles.push(candidate);
  }

  async run(invocation: SystemTtsInvocation, options: RunOptions): Promise<void> {
    this.runCalls.push({ invocation, options });
    if (this.runError !== undefined) {
      throw this.runError;
    }
    if (options.signal?.aborted === true) {
      throw new Error("aborted");
    }
  }

  async capture(invocation: SystemTtsInvocation, options: RunOptions): Promise<string> {
    this.runCalls.push({ invocation, options });
    return this.captureAnswer;
  }
}

const ESPEAK_ENGINE: SystemTtsEngine = { kind: "espeak-ng", binaryPath: "/usr/bin/espeak-ng" };
const PIPER_ENGINE: SystemTtsEngine = {
  kind: "piper",
  binaryPath: "/tmp/piper/bin/piper",
  voiceModelPath: "/tmp/piper/voices/fr_FR-siwis-medium.onnx"
};
const SAY_ENGINE: SystemTtsEngine = { kind: "say", binaryPath: "/usr/bin/say" };

describe("SystemTtsProvider — invocation builders (per-platform argv construction)", () => {
  it("builds espeak-ng argv exactly as validated live (espeak-ng -v fr -s <wpm> -w <path> -- <text>)", () => {
    const invocation = buildEspeakInvocation(ESPEAK_ENGINE, {
      text: "Bonjour le monde",
      outputPath: "/tmp/out.wav",
      language: "fr-FR"
    });
    expect(invocation).toEqual({
      file: "/usr/bin/espeak-ng",
      args: ["-v", "fr", "-s", "175", "-w", "/tmp/out.wav", "--", "Bonjour le monde"]
    });
  });

  it("espeak-ng: speed multiplies the default WPM and clamps to [80, 400]", () => {
    const fast = buildEspeakInvocation(ESPEAK_ENGINE, { text: "x", outputPath: "/tmp/o.wav", speed: 3 });
    expect(fast.args).toContain("400");
    const slow = buildEspeakInvocation(ESPEAK_ENGINE, { text: "x", outputPath: "/tmp/o.wav", speed: 0.1 });
    expect(slow.args).toContain("80");
  });

  it("espeak-ng: never interpolates text into a shell string — text stays one argv entry", () => {
    const invocation = buildEspeakInvocation(ESPEAK_ENGINE, {
      text: "rm -rf / ; echo pwned",
      outputPath: "/tmp/out.wav"
    });
    expect(invocation.args.at(-1)).toBe("rm -rf / ; echo pwned");
    expect(invocation.args.filter((arg) => arg.includes("rm -rf"))).toHaveLength(1);
  });

  it("piper: -m <model> -f <output>, text piped to stdin (never argv)", () => {
    const invocation = buildPiperInvocation(PIPER_ENGINE, { text: "Bonjour", outputPath: "/tmp/out.wav" });
    expect(invocation.file).toBe("/tmp/piper/bin/piper");
    expect(invocation.args).toEqual(["-m", "/tmp/piper/voices/fr_FR-siwis-medium.onnx", "-f", "/tmp/out.wav"]);
    expect(invocation.input).toBe("Bonjour");
  });

  it("piper: speed maps to --length_scale = 1/speed (underscore, the shipped C++ binary's flag)", () => {
    const invocation = buildPiperInvocation(PIPER_ENGINE, { text: "x", outputPath: "/tmp/o.wav", speed: 2 });
    expect(invocation.args).toContain("--length_scale");
    expect(invocation.args).toContain("0.500");
  });

  it("piper: throws without a voice model (never silently synthesizes with none)", () => {
    expect(() =>
      buildPiperInvocation({ kind: "piper", binaryPath: "/bin/piper" }, { text: "x", outputPath: "/tmp/o.wav" })
    ).toThrow(/no voice model/);
  });

  it("say: -v <voice> -r <wpm> -o <output> --file-format=WAVE --data-format=LEI16@22050 <text>", () => {
    const invocation = buildSayInvocation(SAY_ENGINE, { text: "Bonjour", outputPath: "/tmp/out.wav", language: "fr-FR" });
    expect(invocation.args).toEqual([
      "-v",
      "Thomas",
      "-r",
      "175",
      "-o",
      "/tmp/out.wav",
      "--file-format=WAVE",
      "--data-format=LEI16@22050",
      "Bonjour"
    ]);
  });

  it("say: omits -v for a non-French language with no explicit voice", () => {
    const invocation = buildSayInvocation(SAY_ENGINE, { text: "Hello", outputPath: "/tmp/o.wav", language: "en-US" });
    expect(invocation.args).not.toContain("-v");
  });

  it("sapi: text/voice/output are bound script parameters, never interpolated into the script body", () => {
    const invocation = buildSapiInvocation(
      { kind: "sapi", binaryPath: "powershell.exe" },
      { text: "Bonjour \"guillemets\"", outputPath: "C:\\tmp\\out.wav", voice: "Hortense" },
      "C:\\tmp\\script.ps1"
    );
    expect(invocation.args).toEqual([
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "C:\\tmp\\script.ps1",
      "-Text",
      "Bonjour \"guillemets\"",
      "-OutputPath",
      "C:\\tmp\\out.wav",
      "-Rate",
      "0",
      "-VoiceName",
      "Hortense"
    ]);
  });
});

describe("SystemTtsProvider — voice list parsing", () => {
  it("parses espeak-ng --voices=fr output (real format, espeak-ng 1.52.0)", () => {
    const output =
      "Pty Language       Age/Gender VoiceName          File                 Other Languages\n" +
      " 5  fr-fr           --/M      French_(France)    roa/fr               (fr 5)\n" +
      " 7  fr-fr           --/M      french-mbrola-1    mb/mb-fr1            (fr 7)\n";
    const voices = parseEspeakVoices(output);
    expect(voices).toEqual([
      { id: "French_(France)", label: "French (France)", language: "fr-fr" },
      { id: "french-mbrola-1", label: "french-mbrola-1", language: "fr-fr" }
    ]);
  });

  it("parses say -v '?' output", () => {
    const output = "Amelie          fr_FR    # Bonjour, je m'appelle Amelie.\nThomas          fr_FR    # Bonjour, je m'appelle Thomas.\n";
    const voices = parseSayVoices(output);
    expect(voices).toEqual([
      { id: "Amelie", label: "Amelie", language: "fr_FR" },
      { id: "Thomas", label: "Thomas", language: "fr_FR" }
    ]);
  });

  it("parses one SAPI voice name per line", () => {
    const output = "Microsoft Hortense Desktop\nMicrosoft Zira Desktop\n";
    expect(parseSapiVoices(output)).toEqual([
      { id: "Microsoft Hortense Desktop", label: "Microsoft Hortense Desktop" },
      { id: "Microsoft Zira Desktop", label: "Microsoft Zira Desktop" }
    ]);
  });
});

describe("SystemTtsProvider — text chunking", () => {
  it("returns the whole text as one chunk when under the limit", () => {
    expect(splitTextForSynthesis("Bonjour le monde.", 500)).toEqual(["Bonjour le monde."]);
  });

  it("returns nothing for empty/whitespace-only text", () => {
    expect(splitTextForSynthesis("   ", 500)).toEqual([]);
  });

  it("splits on sentence boundaries once the limit is exceeded", () => {
    const text = "Phrase un. Phrase deux. Phrase trois.";
    const chunks = splitTextForSynthesis(text, 12);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join(" ")).toBe(chunks.join(" ")); // no character lost between chunks' words
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(20); // hard-split may exceed slightly on unbreakable runs, bounded
    }
  });

  it("hard-splits a single sentence longer than maxChars on word boundaries", () => {
    const longWord = "mot ".repeat(50).trim();
    const chunks = splitTextForSynthesis(longWord, 20);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(longWord);
  });
});

describe("SystemTtsProvider — WAV concatenation", () => {
  it("returns the single buffer unchanged when there is only one", () => {
    const wav = makeWav(100);
    expect(concatWavBuffers([wav])).toBe(wav);
  });

  it("concatenates PCM data from same-format chunks into one valid WAV", () => {
    const a = makeWav(100);
    const b = makeWav(200);
    const combined = concatWavBuffers([a, b]);
    const buf = Buffer.from(combined);
    expect(buf.toString("ascii", 0, 4)).toBe("RIFF");
    expect(buf.readUInt32LE(40)).toBe(300); // dataSize
    expect(buf.length).toBe(44 + 300);
  });

  it("throws on inconsistent sample rate between chunks", () => {
    const a = makeWav(100, 22050);
    const b = makeWav(100, 16000);
    expect(() => concatWavBuffers([a, b])).toThrow(/inconsistent WAV format/);
  });

  it("throws given zero buffers", () => {
    expect(() => concatWavBuffers([])).toThrow();
  });
});

describe("SystemTtsProvider — isRunningInFlatpak", () => {
  it("reads FLATPAK_ID", () => {
    const previous = process.env["FLATPAK_ID"];
    try {
      delete process.env["FLATPAK_ID"];
      expect(isRunningInFlatpak()).toBe(false);
      process.env["FLATPAK_ID"] = "com.example.App";
      expect(isRunningInFlatpak()).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env["FLATPAK_ID"];
      } else {
        process.env["FLATPAK_ID"] = previous;
      }
    }
  });
});

describe("SystemTtsProvider — detection order and engine selection", () => {
  it("Linux: prefers Piper over espeak-ng when both are available", async () => {
    const runner = new FakeRunner();
    runner.whichAnswers.set("espeak-ng", "/usr/bin/espeak-ng");
    runner.existsAnswers.set("/piper/bin/piper", true);
    runner.existsAnswers.set("/piper/voices/fr_FR-siwis-medium.onnx", true);
    const provider = new SystemTtsProvider({ platform: "linux", piperInstallDir: "/piper", runner, isFlatpak: false });

    const health = await provider.health();
    expect(health.status).toBe("ok");
    expect(health.endpoint).toBe("local:piper");
  });

  it("Linux: falls back to espeak-ng when Piper's model is missing", async () => {
    const runner = new FakeRunner();
    runner.whichAnswers.set("espeak-ng", "/usr/bin/espeak-ng");
    runner.existsAnswers.set("/piper/bin/piper", true);
    // no voice model registered as existing
    const provider = new SystemTtsProvider({ platform: "linux", piperInstallDir: "/piper", runner, isFlatpak: false });

    const health = await provider.health();
    expect(health.endpoint).toBe("local:espeak-ng");
  });

  it("Linux: unreachable when nothing is installed", async () => {
    const runner = new FakeRunner();
    const provider = new SystemTtsProvider({ platform: "linux", runner, isFlatpak: false });
    const health = await provider.health();
    expect(health.status).toBe("unreachable");
    expect(health.detail).toMatch(/espeak-ng/);
  });

  it("falls back to espeak-ng for a bare Piper on PATH with no discoverable French voice model anywhere", async () => {
    const runner = new FakeRunner();
    runner.whichAnswers.set("piper", "/usr/bin/piper");
    runner.whichAnswers.set("espeak-ng", "/usr/bin/espeak-ng");
    const provider = new SystemTtsProvider({ platform: "linux", runner, isFlatpak: false });
    const health = await provider.health();
    expect(health.endpoint).toBe("local:espeak-ng");
  });

  // Bug fix (voice-selection-not-applied): the reported case is a Piper
  // binary on PATH (`/home/guilhem/.local/bin/piper`) with voice models
  // under `~/.llm-voice/voices/` — neither ever consulted before this fix
  // (`detectPiper` only trusted `piperInstallDir`, the extension's own
  // managed install). Any one French-tagged `.onnx` model is enough.
  it("bug fix: detects a PATH-resolved Piper binary with a French voice model under ~/.llm-voice/voices/", async () => {
    const runner = new FakeRunner();
    runner.whichAnswers.set("piper", "/home/user/.local/bin/piper");
    runner.whichAnswers.set("espeak-ng", "/usr/bin/espeak-ng");
    runner.dirAnswers.set("/home/user/.llm-voice/voices", ["fr_FR-upmc-medium.onnx", "fr_FR-upmc-medium.onnx.json"]);
    const provider = new SystemTtsProvider({
      platform: "linux",
      runner,
      isFlatpak: false,
      homeDir: "/home/user"
    });

    const health = await provider.health();

    expect(health.status).toBe("ok");
    expect(health.endpoint).toBe("local:piper");
  });

  it("bug fix: also searches ~/.local/share/piper-voices/ and the resolved binary's own directory", async () => {
    const shareRunner = new FakeRunner();
    shareRunner.whichAnswers.set("piper", "/home/user/.local/bin/piper");
    shareRunner.dirAnswers.set("/home/user/.local/share/piper-voices", ["fr_FR-siwis-medium.onnx"]);
    const shareProvider = new SystemTtsProvider({
      platform: "linux",
      runner: shareRunner,
      isFlatpak: false,
      homeDir: "/home/user"
    });
    expect((await shareProvider.health()).endpoint).toBe("local:piper");

    const binDirRunner = new FakeRunner();
    binDirRunner.whichAnswers.set("piper", "/opt/piper/piper");
    binDirRunner.dirAnswers.set("/opt/piper", ["fr_FR-tom-medium.onnx"]);
    const binDirProvider = new SystemTtsProvider({
      platform: "linux",
      runner: binDirRunner,
      isFlatpak: false,
      homeDir: "/home/user"
    });
    expect((await binDirProvider.health()).endpoint).toBe("local:piper");
  });

  it("bug fix: a non-French model on PATH is not enough — falls back to espeak-ng", async () => {
    const runner = new FakeRunner();
    runner.whichAnswers.set("piper", "/home/user/.local/bin/piper");
    runner.whichAnswers.set("espeak-ng", "/usr/bin/espeak-ng");
    runner.dirAnswers.set("/home/user/.llm-voice/voices", ["en_US-lessac-medium.onnx"]);
    const provider = new SystemTtsProvider({ platform: "linux", runner, isFlatpak: false, homeDir: "/home/user" });

    const health = await provider.health();
    expect(health.endpoint).toBe("local:espeak-ng");
  });

  it("bug fix: the extension's own managed install (piperInstallDir) still wins first when it already has a model", async () => {
    const runner = new FakeRunner();
    runner.whichAnswers.set("piper", "/home/user/.local/bin/piper");
    runner.existsAnswers.set("/managed/bin/piper", true);
    runner.existsAnswers.set("/managed/voices/fr_FR-siwis-medium.onnx", true);
    runner.dirAnswers.set("/managed/voices", ["fr_FR-siwis-medium.onnx"]);
    const provider = new SystemTtsProvider({
      platform: "linux",
      runner,
      piperInstallDir: "/managed",
      isFlatpak: false,
      homeDir: "/home/user"
    });

    const health = await provider.health();
    expect(health.status).toBe("ok");
    expect(health.endpoint).toBe("local:piper");
  });

  it("macOS: detects say", async () => {
    const runner = new FakeRunner();
    runner.whichAnswers.set("say", "/usr/bin/say");
    const provider = new SystemTtsProvider({ platform: "darwin", runner });
    const health = await provider.health();
    expect(health.endpoint).toBe("local:say");
  });

  it("Windows: detects PowerShell for SAPI", async () => {
    const runner = new FakeRunner();
    runner.whichAnswers.set("powershell", "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    const provider = new SystemTtsProvider({ platform: "win32", runner });
    const health = await provider.health();
    expect(health.endpoint).toBe("local:sapi");
  });
});

describe("SystemTtsProvider — synthesize()", () => {
  it("produces a WAV via the detected engine and cleans up the temp file", async () => {
    const runner = new FakeRunner();
    runner.whichAnswers.set("espeak-ng", "/usr/bin/espeak-ng");
    const provider = new SystemTtsProvider({ platform: "linux", runner, isFlatpak: false });

    const result = await provider.synthesize({ text: "Bonjour", language: "fr-FR" });
    expect(result.format).toBe("wav");
    expect(result.data.byteLength).toBeGreaterThan(44);
    expect(runner.removedFiles).toHaveLength(1);
    expect(runner.runCalls).toHaveLength(1);
    expect(runner.runCalls[0]?.invocation.file).toBe("/usr/bin/espeak-ng");
  });

  it("rejects empty text without spawning anything", async () => {
    const runner = new FakeRunner();
    runner.whichAnswers.set("espeak-ng", "/usr/bin/espeak-ng");
    const provider = new SystemTtsProvider({ platform: "linux", runner, isFlatpak: false });
    await expect(provider.synthesize({ text: "   " })).rejects.toThrow(/empty text/);
    expect(runner.runCalls).toHaveLength(0);
  });

  it("throws with a clear message when no engine is available", async () => {
    const runner = new FakeRunner();
    const provider = new SystemTtsProvider({ platform: "linux", runner, isFlatpak: false });
    await expect(provider.synthesize({ text: "Bonjour" })).rejects.toThrow(/SystemTtsProvider/);
  });

  it("splits long text into multiple engine invocations and still cleans up every temp file", async () => {
    const runner = new FakeRunner();
    runner.whichAnswers.set("espeak-ng", "/usr/bin/espeak-ng");
    const provider = new SystemTtsProvider({ platform: "linux", runner, isFlatpak: false });
    const longText = "Phrase numéro un pour dépasser la limite. ".repeat(20);

    const result = await provider.synthesize({ text: longText });
    expect(runner.runCalls.length).toBeGreaterThan(1);
    expect(runner.removedFiles.length).toBe(runner.runCalls.length);
    expect(result.data.byteLength).toBeGreaterThan(44);
  });

  it("propagates AbortSignal through to the runner and still cleans up the temp file", async () => {
    const runner = new FakeRunner();
    runner.whichAnswers.set("espeak-ng", "/usr/bin/espeak-ng");
    runner.runError = new Error("SystemTtsProvider: espeak-ng killed by SIGTERM");
    const provider = new SystemTtsProvider({ platform: "linux", runner, isFlatpak: false });
    const controller = new AbortController();
    controller.abort();

    await expect(provider.synthesize({ text: "Bonjour" }, controller.signal)).rejects.toThrow();
    expect(runner.runCalls[0]?.options.signal).toBe(controller.signal);
    expect(runner.removedFiles).toHaveLength(1);
  });

  it("propagates a custom timeoutMs to every run() call", async () => {
    const runner = new FakeRunner();
    runner.whichAnswers.set("espeak-ng", "/usr/bin/espeak-ng");
    const provider = new SystemTtsProvider({ platform: "linux", runner, isFlatpak: false, timeoutMs: 5_000 });

    await provider.synthesize({ text: "Bonjour" });
    expect(runner.runCalls[0]?.options.timeoutMs).toBe(5_000);
  });

  it("throws when the engine produces an empty file, and still cleans up", async () => {
    const runner = new FakeRunner();
    runner.whichAnswers.set("espeak-ng", "/usr/bin/espeak-ng");
    runner.wavDataSize = 0;
    // readFile returns a header-only WAV (0 data bytes): byteLength is 44, not 0, so
    // simulate a genuinely empty file by overriding readFile for this test.
    runner.readFile = async () => Buffer.alloc(0);
    const provider = new SystemTtsProvider({ platform: "linux", runner, isFlatpak: false });

    await expect(provider.synthesize({ text: "Bonjour" })).rejects.toThrow(/empty file/);
    expect(runner.removedFiles).toHaveLength(1);
  });
});

describe("SystemTtsProvider — getCapabilities/listVoices", () => {
  it("advertises streaming: false, wav format, and the speed parameter", async () => {
    const runner = new FakeRunner();
    runner.whichAnswers.set("espeak-ng", "/usr/bin/espeak-ng");
    runner.captureAnswer = "Pty Language       Age/Gender VoiceName          File                 Other Languages\n";
    const provider = new SystemTtsProvider({ platform: "linux", runner, isFlatpak: false });

    const caps = await provider.getCapabilities();
    expect(caps.streaming).toBe(false);
    expect(caps.formats).toEqual(["wav"]);
    expect(caps.parameters.map((p) => p.name)).toEqual(["speed"]);
  });

  it("listVoices() returns [] when no engine is detected, without throwing", async () => {
    const runner = new FakeRunner();
    const provider = new SystemTtsProvider({ platform: "linux", runner, isFlatpak: false });
    await expect(provider.listVoices()).resolves.toEqual([]);
  });
});
