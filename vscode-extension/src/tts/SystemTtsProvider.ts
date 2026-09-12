/**
 * ADR-009 niveau 1b: zero-install system voices. Synthesizes through a local
 * OS binary — Piper (once installed by `PiperSetup`), `espeak-ng`, macOS
 * `say`, or Windows SAPI via PowerShell — so a fresh install produces sound
 * immediately, with **no server, no network call, no configuration**
 * (S7.1's user-facing goal: today's VSIX only ever throws "Chatterbox n'est
 * pas installé").
 *
 * Unlike every other `TtsProvider` in this codebase, `SystemTtsProvider`
 * deliberately never touches `EgressGuard`/`fetch`: it only ever spawns a
 * local process with a fixed argument array (`SystemTtsProcessRunner.run`,
 * `child_process.spawn` under the hood, `shell` never involved) — there is
 * no network destination to guard against here. ADR-005/ADR-010's "no
 * `fetch` outside `net/`" rule is about outbound HTTP, not process
 * execution; this file is the one documented exception the ADRs anticipate
 * (ADR-009 §"1b. Local sans installation").
 *
 * Detection order (linux-first-v1.md §3-4):
 *  - **Linux**: Piper → `espeak-ng`. Piper itself is tried two ways, in
 *    order: (1) the extension's own managed install (`piperInstallDir`,
 *    `LLM Voice: Install Local Voice (Piper)`); (2) a `piper` binary
 *    resolved from `PATH` *with* a French `.onnx` voice model discoverable
 *    in `~/.llm-voice/voices/`, `~/.local/share/piper-voices/`, or the
 *    binary's own directory (bug fix, voice-selection-not-applied point 1:
 *    a manually-installed Piper — e.g. via the distro's package manager —
 *    used to be invisible to this class entirely). Piper deliberately
 *    outranks `espeak-ng` even when both are found (point 2 of the same
 *    fix): `espeak-ng`'s voice is noticeably more robotic, so `Pipeline`'s
 *    `ensureVoiceReady`/`shouldOfferAutoVoiceInstall` (`AutoVoiceInstall.ts`)
 *    offers the one-action Piper install even when `health()` already
 *    reports "ok" via `espeak-ng` — never blocking, always falling back to
 *    `espeak-ng` immediately on a decline or a failed/offline download.
 *  - **macOS**: `say` (ships with every macOS install).
 *  - **Windows**: PowerShell driving `System.Speech.Synthesis.SpeechSynthesizer`
 *    (SAPI), always present on Windows.
 *
 * `spd-say` (speech-dispatcher's CLI) is deliberately **not** wired into the
 * synthesis path, even though ADR-009/linux-first-v1.md §4 list it as a
 * last-resort fallback: standard `speech-dispatcher` builds have no flag to
 * render to a WAV file — the daemon owns the audio device directly and
 * speaks immediately — so it structurally cannot satisfy this class's
 * `synthesize(): Promise<AudioResult>` contract (a `AudioResult` byte
 * buffer the existing pipeline caches, chunks and plays through the
 * Webview's `<audio>`, not "however the OS feels like playing it"). Wiring
 * it in would mean bypassing `PlaybackController`/highlighting/caching
 * entirely for this one engine — a different feature, not a `TtsProvider`.
 * It stays out of `detectEngine()`'s search order until a WAV-capable path
 * exists (e.g. speech-dispatcher's `sd_generic` module writing to a file
 * sink, `linux-first-v1.md` §4).
 *
 * **Flatpak** (`FLATPAK_ID` set): the sandbox blocks direct execution of
 * host binaries — every spawn is re-routed through `flatpak-spawn --host`
 * (`linux-first-v1.md` §1). Not exercised by any test here (this dev
 * machine is a native RPM/deb install); documented as a best-effort path.
 */

import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import type { ProviderHealth } from "../core/health.js";
import type {
  AudioResult,
  TtsCapabilities,
  TtsParameterDescriptor,
  TtsProvider,
  TtsRequest,
  Voice
} from "../core/tts.js";

const DEFAULT_ID = "system";
/** `llmVoice.tts.timeoutMs`'s default (60000) is generous for a network
 *  round-trip; a local process that hasn't exited after 30s is stuck. */
const DEFAULT_TIMEOUT_MS = 30_000;
/**
 * Keeps a single engine invocation's argv/stdin comfortably below any
 * platform's `ARG_MAX`/pipe-buffer concerns and each WAV chunk small, so a
 * very long document never becomes one multi-minute, unabortable process
 * call — `synthesize()` splits on sentence boundaries above this and
 * concatenates the resulting WAVs (`concatWavBuffers`).
 */
export const MAX_CHARS_PER_CHUNK = 500;
const DEFAULT_ESPEAK_WPM = 175;
const MIN_ESPEAK_WPM = 80;
const MAX_ESPEAK_WPM = 400;
const DEFAULT_SAY_WPM = 175;
/** French macOS voice with the broadest OS-version availability. */
const DEFAULT_SAY_VOICE_FR = "Thomas";
/**
 * Matches `piperAssets.json`'s `voiceId` and `PiperSetup`'s install layout
 * (`<piperInstallDir>/voices/<voiceId>.onnx`) — the one voice this slice
 * installs (ADR-009 §3, `fr_FR-siwis-medium`).
 */
export const PIPER_VOICE_ID = "fr_FR-siwis-medium";

/**
 * `true` for a Piper `.onnx` voice model file whose BCP-47-ish prefix is
 * French — `fr_FR-siwis-medium.onnx`, `fr-FR-upmc-medium.onnx`,
 * `fr_BE-…`, case-insensitive. Piper's published voices are always named
 * `<lang>[_<REGION>]-<name>-<quality>.onnx` (`rhasspy/piper-voices`), so the
 * language is always the very first segment — this does not need to parse
 * the rest of the filename to answer "is this French".
 */
export function isFrenchPiperVoiceFile(fileName: string): boolean {
  return /^fr[_-]/i.test(fileName) && fileName.toLowerCase().endsWith(".onnx");
}

export type SystemTtsEngineKind = "piper" | "espeak-ng" | "say" | "sapi";

/** A concrete, already-located engine — the result of `detectEngine()`. */
export interface SystemTtsEngine {
  kind: SystemTtsEngineKind;
  binaryPath: string;
  /** `piper` only: the `.onnx` voice model paired with `binaryPath`. */
  voiceModelPath?: string;
}

/** One process invocation, decoupled from `child_process` so every builder below is unit-testable without spawning anything. */
export interface SystemTtsInvocation {
  file: string;
  args: readonly string[];
  /** Piped to stdin instead of argv (`piper` only: keeps arbitrary-length text off argv and off any shell). */
  input?: string;
}

export interface RunOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * The only seam through which `SystemTtsProvider` touches the filesystem or
 * spawns a process — real in production (`createDefaultRunner`), faked in
 * every unit test (`test/unit/tts/SystemTtsProvider.test.ts`), so "does this
 * build the right argv" and "does abort/timeout/cleanup work" are provable
 * without a real `espeak-ng`/`piper`/`say`/PowerShell on the test machine.
 */
export interface SystemTtsProcessRunner {
  /** Resolves a bare command to an absolute path via `PATH` (or `undefined` if not found). Never touches a shell. */
  which(command: string): Promise<string | undefined>;
  exists(candidate: string): Promise<boolean>;
  writeFile(candidate: string, content: string): Promise<void>;
  readFile(candidate: string): Promise<Buffer>;
  /** Best-effort: never rejects on a missing file (temp cleanup after a failed run). */
  removeFile(candidate: string): Promise<void>;
  /**
   * Lists `dir`'s entries (basenames only). Bug fix (voice-selection-not-applied,
   * point 1): backs `detectPiper`'s search for a French `.onnx` voice model
   * across every candidate directory (`piperVoiceSearchDirs`) — never
   * rejects, `[]` for a directory that does not exist or cannot be read,
   * exactly like every other best-effort probe on this interface.
   */
  readdir(dir: string): Promise<string[]>;
  /** Runs `invocation` to completion (exit code 0) or rejects — non-zero exit, spawn error, timeout or abort. */
  run(invocation: SystemTtsInvocation, options: RunOptions): Promise<void>;
  /** Same as `run`, but resolves with captured stdout instead of writing a file (voice listing). */
  capture(invocation: SystemTtsInvocation, options: RunOptions): Promise<string>;
}

export interface SystemTtsProviderOptions {
  /** Defaults to `"system"`. */
  id?: string;
  /** `globalStorageUri/piper` (`PiperSetup`'s install target); `undefined` disables the Piper tier entirely. */
  piperInstallDir?: string;
  /** Injectable for tests; defaults to `os.platform()`. */
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  /** Injectable for tests; defaults to a real `child_process`/`fs` implementation. */
  runner?: SystemTtsProcessRunner;
  /** Injectable for tests; defaults to `process.env["FLATPAK_ID"] !== undefined`. */
  isFlatpak?: boolean;
  /** Injectable for tests; defaults to `os.homedir()` — where `detectPiper` looks for `.llm-voice/voices/`. */
  homeDir?: string;
}

const SPEED_PARAMETER: readonly TtsParameterDescriptor[] = [
  {
    name: "speed",
    label: "Vitesse",
    type: "number",
    default: 1,
    min: 0.5,
    max: 2,
    step: 0.05,
    description: "Vitesse de lecture appliquée par le moteur système (espeak-ng/Piper/say/SAPI)."
  }
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** BCP-47 → espeak-ng/say voice language code: the primary subtag, lowercased. `undefined`/empty defaults to French (this product's primary language, CdC §3). */
function primarySubtag(language: string | undefined): string {
  if (language === undefined || language.trim().length === 0) {
    return "fr";
  }
  return language.split("-")[0]!.toLowerCase();
}

// --------------------------------------------------------------- WAV utils

interface WavInfo {
  sampleRate: number;
  numChannels: number;
  bitsPerSample: number;
  dataSize: number;
  dataOffset: number;
}

/** Parses a canonical 44-byte-header PCM WAV — what every engine here writes. */
function parseWavHeader(buffer: Uint8Array): WavInfo {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("SystemTtsProvider: not a valid RIFF/WAVE buffer");
  }
  if (buf.toString("ascii", 12, 16) !== "fmt " || buf.toString("ascii", 36, 40) !== "data") {
    throw new Error("SystemTtsProvider: unsupported WAV layout (expected a canonical 44-byte header)");
  }
  return {
    numChannels: buf.readUInt16LE(22),
    sampleRate: buf.readUInt32LE(24),
    bitsPerSample: buf.readUInt16LE(34),
    dataSize: buf.readUInt32LE(40),
    dataOffset: 44
  };
}

function buildWavBuffer(format: WavInfo, dataParts: readonly Buffer[]): Uint8Array {
  const dataSize = dataParts.reduce((sum, part) => sum + part.length, 0);
  const bytesPerSample = format.bitsPerSample / 8;
  const byteRate = format.sampleRate * format.numChannels * bytesPerSample;
  const blockAlign = format.numChannels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(format.numChannels, 22);
  buffer.writeUInt32LE(format.sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(format.bitsPerSample, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (const part of dataParts) {
    part.copy(buffer, offset);
    offset += part.length;
  }
  return buffer;
}

/** Concatenates PCM WAVs produced by consecutive `synthesizeChunk` calls into a single file. Throws if the engine somehow changed format between chunks (never observed — same engine, same call — but a corrupt/truncated chunk must fail loudly rather than produce garbled audio). */
export function concatWavBuffers(buffers: readonly Uint8Array[]): Uint8Array {
  if (buffers.length === 0) {
    throw new Error("SystemTtsProvider: no audio chunks to concatenate");
  }
  if (buffers.length === 1) {
    return buffers[0]!;
  }
  const headers = buffers.map(parseWavHeader);
  const first = headers[0]!;
  for (const header of headers.slice(1)) {
    if (
      header.sampleRate !== first.sampleRate ||
      header.numChannels !== first.numChannels ||
      header.bitsPerSample !== first.bitsPerSample
    ) {
      throw new Error("SystemTtsProvider: inconsistent WAV format between synthesized chunks");
    }
  }
  const dataParts = buffers.map((buffer, index) => {
    const header = headers[index]!;
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    return buf.subarray(header.dataOffset, header.dataOffset + header.dataSize);
  });
  return buildWavBuffer(first, dataParts);
}

// ---------------------------------------------------------------- chunking

/** Splits `text` on sentence boundaries into pieces no longer than `maxChars`; a single sentence longer than `maxChars` is hard-split on word boundaries. Pure, no I/O. */
export function splitTextForSynthesis(text: string, maxChars: number): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [];
  }
  if (trimmed.length <= maxChars) {
    return [trimmed];
  }
  const sentences = trimmed.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = "";

  const flushHardSplit = (): void => {
    while (current.length > maxChars) {
      let cut = current.lastIndexOf(" ", maxChars);
      if (cut <= 0) {
        cut = maxChars;
      }
      chunks.push(current.slice(0, cut).trim());
      current = current.slice(cut).trim();
    }
  };

  for (const sentence of sentences) {
    const candidate = current.length === 0 ? sentence : `${current} ${sentence}`;
    if (candidate.length > maxChars && current.length > 0) {
      chunks.push(current);
      current = sentence;
      flushHardSplit();
    } else {
      current = candidate;
      flushHardSplit();
    }
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

// ---------------------------------------------------------- invocation builders

export interface EngineInvocationContext {
  text: string;
  outputPath: string;
  language?: string;
  speed?: number;
  voice?: string;
}

/** `espeak-ng -v <voice> -s <wpm> -w <output.wav> -- <text>` — the exact form validated live on this machine (espeak-ng 1.52.0, Fedora 44): produces a canonical 22050Hz mono 16-bit WAV. */
export function buildEspeakInvocation(engine: SystemTtsEngine, ctx: EngineInvocationContext): SystemTtsInvocation {
  const voice = ctx.voice ?? primarySubtag(ctx.language);
  const wpm = clamp(Math.round(DEFAULT_ESPEAK_WPM * (ctx.speed ?? 1)), MIN_ESPEAK_WPM, MAX_ESPEAK_WPM);
  return {
    file: engine.binaryPath,
    args: ["-v", voice, "-s", String(wpm), "-w", ctx.outputPath, "--", ctx.text]
  };
}

/**
 * `piper -m <model.onnx> -f <output.wav> [--length_scale <scale>]`, text on
 * stdin — verified end to end against the real `rhasspy/piper` release
 * binary this class expects `PiperSetup` to install (`piper_linux_x86_64.tar.gz`,
 * `2023.11.14-2`, `./piper --help`): reads plain text from stdin when no
 * `-i`/`--output_dir` is given, `-f -` would mean stdout instead of a file.
 * `--length_scale` (underscore — this C++ binary's flag spelling, *not* the
 * unrelated Python `piper-tts` package's `--length-scale`) is Piper's
 * inverse speed knob (smaller = faster); `speed` is only ever a positive
 * multiplier here (`TtsRequest.speed`), so `1 / speed` is always defined.
 */
export function buildPiperInvocation(engine: SystemTtsEngine, ctx: EngineInvocationContext): SystemTtsInvocation {
  if (engine.voiceModelPath === undefined) {
    throw new Error("SystemTtsProvider: piper engine has no voice model");
  }
  const args = ["-m", engine.voiceModelPath, "-f", ctx.outputPath];
  if (ctx.speed !== undefined && ctx.speed > 0) {
    args.push("--length_scale", (1 / ctx.speed).toFixed(3));
  }
  return { file: engine.binaryPath, args, input: ctx.text };
}

/** macOS `say -v <voice> -r <wpm> -o <output.wav> --file-format=WAVE --data-format=LEI16@22050 <text>` — WAV directly, no AIFF conversion step. Not exercised on this (Linux) test machine; documented as best-effort against Apple's published `say(1)` flags. */
export function buildSayInvocation(engine: SystemTtsEngine, ctx: EngineInvocationContext): SystemTtsInvocation {
  const lang = primarySubtag(ctx.language);
  const voice = ctx.voice ?? (lang === "fr" ? DEFAULT_SAY_VOICE_FR : undefined);
  const wpm = Math.round(DEFAULT_SAY_WPM * (ctx.speed ?? 1));
  const args = [
    ...(voice !== undefined ? ["-v", voice] : []),
    "-r",
    String(wpm),
    "-o",
    ctx.outputPath,
    "--file-format=WAVE",
    "--data-format=LEI16@22050",
    ctx.text
  ];
  return { file: engine.binaryPath, args };
}

/** SAPI rate is an integer in [-10, 10]; `speed` (0.5..2) maps linearly through 1 → 0. */
function sapiRateFor(speed: number | undefined): number {
  return clamp(Math.round(((speed ?? 1) - 1) * 10), -10, 10);
}

/** PowerShell driving `System.Speech.Synthesis.SpeechSynthesizer.SetOutputToWaveFile` — text/voice/output passed as bound script parameters (`-Text`/`-VoiceName`/`-OutputPath`), never interpolated into the script body, so nothing in `ctx.text` is ever parsed as PowerShell syntax. Not exercised on this (Linux) test machine; documented as best-effort against the documented .NET API. */
export function buildSapiInvocation(
  engine: SystemTtsEngine,
  ctx: EngineInvocationContext,
  scriptPath: string
): SystemTtsInvocation {
  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-Text",
    ctx.text,
    "-OutputPath",
    ctx.outputPath,
    "-Rate",
    String(sapiRateFor(ctx.speed)),
    ...(ctx.voice !== undefined ? ["-VoiceName", ctx.voice] : [])
  ];
  return { file: engine.binaryPath, args };
}

/** `-List`: prints one installed SAPI voice name per line, the format `parseSapiVoices` expects. */
function buildSapiListInvocation(engine: SystemTtsEngine, scriptPath: string): SystemTtsInvocation {
  return {
    file: engine.binaryPath,
    args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-List"]
  };
}

const SAPI_SCRIPT = `
param(
  [string]$Text,
  [string]$OutputPath,
  [int]$Rate = 0,
  [string]$VoiceName,
  [switch]$List
)
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
if ($List) {
  foreach ($voice in $synth.GetInstalledVoices()) {
    Write-Output $voice.VoiceInfo.Name
  }
  exit 0
}
if ($VoiceName) {
  $synth.SelectVoice($VoiceName)
}
$synth.Rate = $Rate
$synth.SetOutputToWaveFile($OutputPath)
$synth.Speak($Text)
$synth.Dispose()
`;

// ------------------------------------------------------------- voice parsing

/** `espeak-ng --voices=<lang>` table (header row starts with `Pty`): `Pty Language Age/Gender VoiceName File Other_Languages`. Verified against real output (espeak-ng 1.52.0). */
export function parseEspeakVoices(output: string): Voice[] {
  const voices: Voice[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("Pty")) {
      continue;
    }
    const fields = trimmed.split(/\s+/);
    const language = fields[1];
    const name = fields[3];
    if (language === undefined || name === undefined) {
      continue;
    }
    voices.push({ id: name, label: name.replace(/_/g, " "), language });
  }
  return voices;
}

/** `say -v '?'` lines: `<Name>    <locale>    # <sample text>`. */
export function parseSayVoices(output: string): Voice[] {
  const voices: Voice[] = [];
  for (const line of output.split("\n")) {
    const match = /^(\S+)\s+(\S+)\s+#/.exec(line);
    if (match === null) {
      continue;
    }
    const [, name, locale] = match;
    if (name === undefined || locale === undefined) {
      continue;
    }
    voices.push({ id: name, label: name, language: locale });
  }
  return voices;
}

/** One SAPI voice name per line (`buildSapiListInvocation`'s `-List` output). */
export function parseSapiVoices(output: string): Voice[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((name) => ({ id: name, label: name }));
}

// -------------------------------------------------------------- Flatpak

/** `FLATPAK_ID` is only ever set inside a Flatpak sandbox (linux-first-v1.md §1). */
export function isRunningInFlatpak(): boolean {
  return process.env["FLATPAK_ID"] !== undefined;
}

function wrapForFlatpak(invocation: SystemTtsInvocation, flatpak: boolean): SystemTtsInvocation {
  if (!flatpak) {
    return invocation;
  }
  return {
    file: "flatpak-spawn",
    args: ["--host", invocation.file, ...invocation.args],
    ...(invocation.input !== undefined ? { input: invocation.input } : {})
  };
}

// ------------------------------------------------------------- default runner

function combineSignals(signal: AbortSignal | undefined, timeoutMs: number | undefined): AbortSignal | undefined {
  const signals = [signal, timeoutMs !== undefined && timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined].filter(
    (candidate): candidate is AbortSignal => candidate !== undefined
  );
  if (signals.length === 0) {
    return undefined;
  }
  if (signals.length === 1) {
    return signals[0];
  }
  return AbortSignal.any(signals);
}

function runSpawned(invocation: SystemTtsInvocation, options: RunOptions, captureStdout: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const combined = combineSignals(options.signal, options.timeoutMs);
    const child = spawn(invocation.file, invocation.args, {
      stdio: ["pipe", captureStdout ? "pipe" : "ignore", "pipe"],
      ...(combined !== undefined ? { signal: combined } : {})
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code, signalName) => {
      if (signalName !== null) {
        reject(new Error(`SystemTtsProvider: ${invocation.file} killed by ${signalName}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`SystemTtsProvider: ${invocation.file} exited ${code ?? "null"}: ${stderr.trim()}`));
        return;
      }
      resolve(stdout);
    });
    if (invocation.input !== undefined) {
      child.stdin?.end(invocation.input, "utf8");
    } else {
      child.stdin?.end();
    }
  });
}

async function resolveOnPath(command: string, platform: NodeJS.Platform): Promise<string | undefined> {
  const pathEnv = process.env["PATH"] ?? "";
  const extensions = platform === "win32" ? (process.env["PATHEXT"] ?? ".EXE;.CMD;.BAT").split(";") : [""];
  const dirs = pathEnv.split(path.delimiter).filter((entry) => entry.length > 0);
  for (const dir of dirs) {
    for (const extension of extensions) {
      const candidate = path.join(dir, `${command}${extension}`);
      try {
        await fsp.access(candidate, fsConstants.X_OK);
        return candidate;
      } catch {
        // Not at this PATH entry; keep looking.
      }
    }
  }
  return undefined;
}

/** Real `child_process`/`fs` implementation, Flatpak-aware (`which` is re-routed through `flatpak-spawn --host which` so it resolves *host* binaries, not the sandbox's own near-empty `PATH`). */
function createDefaultRunner(platform: NodeJS.Platform, flatpak: boolean): SystemTtsProcessRunner {
  return {
    async which(command: string): Promise<string | undefined> {
      if (flatpak) {
        try {
          const stdout = await runSpawned({ file: "flatpak-spawn", args: ["--host", "which", command] }, {}, true);
          const resolved = stdout.trim().split("\n")[0];
          return resolved !== undefined && resolved.length > 0 ? resolved : undefined;
        } catch {
          return undefined;
        }
      }
      return resolveOnPath(command, platform);
    },
    async exists(candidate: string): Promise<boolean> {
      try {
        await fsp.access(candidate, fsConstants.F_OK);
        return true;
      } catch {
        return false;
      }
    },
    async writeFile(candidate: string, content: string): Promise<void> {
      await fsp.writeFile(candidate, content, "utf8");
    },
    async readFile(candidate: string): Promise<Buffer> {
      return fsp.readFile(candidate);
    },
    async removeFile(candidate: string): Promise<void> {
      await fsp.rm(candidate, { force: true }).catch(() => {});
    },
    async readdir(dir: string): Promise<string[]> {
      try {
        return await fsp.readdir(dir);
      } catch {
        return [];
      }
    },
    async run(invocation: SystemTtsInvocation, options: RunOptions): Promise<void> {
      await runSpawned(wrapForFlatpak(invocation, flatpak), options, false);
    },
    async capture(invocation: SystemTtsInvocation, options: RunOptions): Promise<string> {
      return runSpawned(wrapForFlatpak(invocation, flatpak), options, true);
    }
  };
}

// ------------------------------------------------------------------- provider

export class SystemTtsProvider implements TtsProvider {
  readonly id: string;

  private readonly piperInstallDir: string | undefined;
  private readonly platform: NodeJS.Platform;
  private readonly timeoutMs: number;
  private readonly runner: SystemTtsProcessRunner;
  private readonly flatpak: boolean;
  private readonly homeDir: string;

  constructor(options: SystemTtsProviderOptions = {}) {
    this.id = options.id ?? DEFAULT_ID;
    this.piperInstallDir = options.piperInstallDir;
    this.platform = options.platform ?? os.platform();
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.flatpak = options.isFlatpak ?? isRunningInFlatpak();
    this.runner = options.runner ?? createDefaultRunner(this.platform, this.flatpak);
    this.homeDir = options.homeDir ?? os.homedir();
  }

  async health(_signal?: AbortSignal): Promise<ProviderHealth> {
    const checkedAt = Date.now();
    const started = Date.now();
    const engine = await this.detectEngine();
    const latencyMs = Date.now() - started;
    if (engine === undefined) {
      return { providerId: this.id, status: "unreachable", checkedAt, latencyMs, detail: this.unavailableMessage() };
    }
    return { providerId: this.id, status: "ok", checkedAt, latencyMs, endpoint: `local:${engine.kind}` };
  }

  async getCapabilities(signal?: AbortSignal): Promise<TtsCapabilities> {
    const voices = await this.listVoices(signal).catch(() => []);
    return { streaming: false, voices, parameters: SPEED_PARAMETER, formats: ["wav"], languages: [] };
  }

  async listVoices(signal?: AbortSignal): Promise<Voice[]> {
    const engine = await this.detectEngine();
    if (engine === undefined) {
      return [];
    }
    const runOptions: RunOptions = { ...(signal !== undefined ? { signal } : {}), timeoutMs: this.timeoutMs };
    switch (engine.kind) {
      case "espeak-ng": {
        const output = await this.runner.capture({ file: engine.binaryPath, args: ["--voices=fr"] }, runOptions);
        return parseEspeakVoices(output);
      }
      case "piper":
        return [{ id: PIPER_VOICE_ID, label: `Piper — ${PIPER_VOICE_ID}`, language: "fr-FR" }];
      case "say": {
        const output = await this.runner.capture({ file: engine.binaryPath, args: ["-v", "?"] }, runOptions);
        return parseSayVoices(output);
      }
      case "sapi": {
        const scriptPath = await this.ensureSapiScript();
        const output = await this.runner.capture(buildSapiListInvocation(engine, scriptPath), runOptions);
        await this.runner.removeFile(scriptPath);
        return parseSapiVoices(output);
      }
    }
  }

  async synthesize(request: TtsRequest, signal?: AbortSignal): Promise<AudioResult> {
    if (request.text.trim().length === 0) {
      throw new Error("SystemTtsProvider: empty text");
    }
    const engine = await this.detectEngine();
    if (engine === undefined) {
      throw new Error(this.unavailableMessage());
    }
    const chunks = splitTextForSynthesis(request.text, MAX_CHARS_PER_CHUNK);
    const buffers: Uint8Array[] = [];
    for (const chunk of chunks) {
      buffers.push(await this.synthesizeChunk(engine, chunk, request, signal));
    }
    return { format: "wav", data: concatWavBuffers(buffers) };
  }

  // --------------------------------------------------------------- internals

  private async synthesizeChunk(
    engine: SystemTtsEngine,
    text: string,
    request: TtsRequest,
    signal?: AbortSignal
  ): Promise<Uint8Array> {
    const outputPath = this.tempPath("wav");
    let scriptPath: string | undefined;
    try {
      const ctx: EngineInvocationContext = {
        text,
        outputPath,
        ...(request.language !== undefined ? { language: request.language } : {}),
        ...(request.speed !== undefined ? { speed: request.speed } : {}),
        ...(request.voice !== undefined ? { voice: request.voice } : {})
      };
      let invocation: SystemTtsInvocation;
      switch (engine.kind) {
        case "espeak-ng":
          invocation = buildEspeakInvocation(engine, ctx);
          break;
        case "piper":
          invocation = buildPiperInvocation(engine, ctx);
          break;
        case "say":
          invocation = buildSayInvocation(engine, ctx);
          break;
        case "sapi":
          scriptPath = await this.ensureSapiScript();
          invocation = buildSapiInvocation(engine, ctx, scriptPath);
          break;
      }
      await this.runner.run(invocation, {
        ...(signal !== undefined ? { signal } : {}),
        timeoutMs: this.timeoutMs
      });
      const buffer = await this.runner.readFile(outputPath);
      if (buffer.byteLength === 0) {
        throw new Error(`SystemTtsProvider: ${engine.kind} produced an empty file`);
      }
      return new Uint8Array(buffer);
    } finally {
      await this.runner.removeFile(outputPath);
      if (scriptPath !== undefined) {
        await this.runner.removeFile(scriptPath);
      }
    }
  }

  private async ensureSapiScript(): Promise<string> {
    const scriptPath = this.tempPath("ps1");
    await this.runner.writeFile(scriptPath, SAPI_SCRIPT);
    return scriptPath;
  }

  private tempPath(extension: string): string {
    return path.join(os.tmpdir(), `llm-voice-system-tts-${randomUUID()}.${extension}`);
  }

  private async detectEngine(): Promise<SystemTtsEngine | undefined> {
    switch (this.platform) {
      case "darwin":
        return this.detectSay();
      case "win32":
        return this.detectSapi();
      default:
        return this.detectLinux();
    }
  }

  private async detectLinux(): Promise<SystemTtsEngine | undefined> {
    const piper = await this.detectPiper();
    if (piper !== undefined) {
      return piper;
    }
    const espeakPath = await this.runner.which("espeak-ng");
    return espeakPath !== undefined ? { kind: "espeak-ng", binaryPath: espeakPath } : undefined;
  }

  /**
   * Bug fix (voice-selection-not-applied, point 1): a Piper install
   * produced by `PiperSetup` (`piperInstallDir`) is still tried first — it
   * is the one install this class fully controls, `PIPER_VOICE_ID`'s exact
   * `.onnx` filename included — but a `piper` binary resolved from `PATH`
   * is now trusted too, provided a French voice model can actually be
   * found alongside it: `~/.llm-voice/voices/`, `~/.local/share/piper-voices/`
   * (the two conventional locations a manually-installed Piper's voices
   * tend to live in) and the resolved binary's own directory. Any one
   * `.onnx` file whose name is French-tagged (`isFrenchPiperVoiceFile`)
   * is enough — this class does not need to know the exact voice id in
   * advance the way the managed install's fixed `PIPER_VOICE_ID` does.
   */
  private async detectPiper(): Promise<SystemTtsEngine | undefined> {
    const managed = await this.detectManagedPiper();
    if (managed !== undefined) {
      return managed;
    }
    const binaryPath = await this.runner.which(this.platform === "win32" ? "piper.exe" : "piper");
    if (binaryPath === undefined) {
      return undefined;
    }
    const voiceModelPath = await this.findFrenchPiperVoiceModel(binaryPath);
    if (voiceModelPath === undefined) {
      return undefined;
    }
    return { kind: "piper", binaryPath, voiceModelPath };
  }

  /** The extension's own managed install (`LLM Voice: Install Local Voice (Piper)`) — unchanged from before this fix. */
  private async detectManagedPiper(): Promise<SystemTtsEngine | undefined> {
    if (this.piperInstallDir === undefined) {
      return undefined;
    }
    const binaryName = this.platform === "win32" ? "piper.exe" : "piper";
    const binaryPath = path.join(this.piperInstallDir, "bin", binaryName);
    const voiceModelPath = path.join(this.piperInstallDir, "voices", `${PIPER_VOICE_ID}.onnx`);
    const [hasBinary, hasVoice] = await Promise.all([
      this.runner.exists(binaryPath),
      this.runner.exists(voiceModelPath)
    ]);
    if (!hasBinary || !hasVoice) {
      return undefined;
    }
    return { kind: "piper", binaryPath, voiceModelPath };
  }

  /** Every directory a manually-installed Piper's voice models might live in, searched in this order. */
  private piperVoiceSearchDirs(binaryPath: string): string[] {
    return [
      path.join(this.homeDir, ".llm-voice", "voices"),
      path.join(this.homeDir, ".local", "share", "piper-voices"),
      path.dirname(binaryPath)
    ];
  }

  private async findFrenchPiperVoiceModel(binaryPath: string): Promise<string | undefined> {
    for (const dir of this.piperVoiceSearchDirs(binaryPath)) {
      const entries = await this.runner.readdir(dir);
      const match = entries.find(isFrenchPiperVoiceFile);
      if (match !== undefined) {
        return path.join(dir, match);
      }
    }
    return undefined;
  }

  private async detectSay(): Promise<SystemTtsEngine | undefined> {
    const binaryPath = await this.runner.which("say");
    return binaryPath !== undefined ? { kind: "say", binaryPath } : undefined;
  }

  private async detectSapi(): Promise<SystemTtsEngine | undefined> {
    const binaryPath = (await this.runner.which("powershell")) ?? (await this.runner.which("pwsh"));
    return binaryPath !== undefined ? { kind: "sapi", binaryPath } : undefined;
  }

  private unavailableMessage(): string {
    if (this.platform === "darwin") {
      return "SystemTtsProvider : commande « say » introuvable (normalement fournie par macOS).";
    }
    if (this.platform === "win32") {
      return "SystemTtsProvider : PowerShell introuvable pour System.Speech.Synthesis (SAPI).";
    }
    return (
      "SystemTtsProvider : aucun moteur trouvé (espeak-ng absent — installez le paquet de votre distribution — " +
      "ou « LLM Voice: Install Local Voice (Piper) » pour une meilleure qualité)."
    );
  }
}
