/**
 * Pure state machine behind `LLM Voice: Use My Own Voice` (S8.2, CdC §55).
 * Every side effect (dialogs, clipboard, filesystem, `ffmpeg`, playback) is
 * an injected `UseOwnVoiceActions` method, exactly like
 * `onboarding/handleVoiceTier.ts` — this file imports neither `vscode` nor
 * `node:fs`, so the whole three-step wizard is unit-testable with a stub
 * that records what was called and answers like a real user would.
 *
 * Three steps (story): (a) explicit consent; (b) an existing file *or* a
 * recorded one, located; (c) validated, converted, copied into
 * `globalStorageUri/voices/`, applied to the profile and previewed
 * immediately. "Tout reste local" is true by construction here: nothing in
 * this file or `UseOwnVoiceActions` ever performs a network call — the only
 * things it does are dialogs, clipboard, local file I/O and spawning
 * `ffmpeg` as a local process.
 */

import {
  describeUnverifiedFormat,
  validateWavReferenceAudio,
  type ReferenceAudioValidation
} from "../core/audioValidation.js";
import { platformRecordCommand, RECORD_WAIT_TIMEOUT_MS, type RecordCommandInfo } from "./recordCommand.js";

export interface UseOwnVoiceActions {
  /** Step (a): explains CdC §55's consent requirement, returns `true` only if the user agrees. */
  confirmConsent(): Promise<boolean>;
  /** Step (b): "use an existing file" vs "record now", or `undefined` if the user backs out. */
  chooseSource(): Promise<"file" | "record" | undefined>;
  /** File picker filtered to audio extensions; `undefined` if cancelled. */
  pickExistingFile(): Promise<string | undefined>;
  /** Shows the platform recording command with a "Copier la commande" action; `false` if the user cancels instead. */
  showRecordInstructions(info: RecordCommandInfo, outputPath: string): Promise<boolean>;
  writeClipboardText(text: string): Promise<void>;
  /** Resolves `true` once `path` exists, `false` on timeout/cancellation. */
  waitForRecordedFile(path: string, timeoutMs: number): Promise<boolean>;
  /** Whole file contents, for header validation. */
  readFile(path: string): Promise<Uint8Array>;
  /** Extension of `path`, lower-cased, dot included (e.g. `.wav`). */
  extensionOf(path: string): string;
  ffmpegAvailable(): Promise<boolean>;
  /** Converts `inputPath` to 24kHz mono WAV at `outputPath`; `false` on failure. */
  convertToWavMono24k(inputPath: string, outputPath: string): Promise<boolean>;
  copyFile(inputPath: string, outputPath: string): Promise<void>;
  /** Target `.wav` path for `convertToWavMono24k`, under `globalStorageUri/voices/`. */
  reservedConvertedPath(sourcePath: string): string;
  /** Target path (same extension as `sourcePath`) for a copy-as-is, under `globalStorageUri/voices/`. */
  reservedOriginalCopyPath(sourcePath: string): string;
  /** A fresh path to record into, under a directory this wizard controls. */
  reservedRecordingPath(): string;
  applyReferenceAudio(path: string): Promise<void>;
  previewCurrentProfile(): Promise<void>;
  showInfo(message: string): Promise<void>;
  showError(message: string): Promise<void>;
  /** `true` unless the user declines a non-blocking warning (e.g. unverified format). */
  confirmWarning(message: string): Promise<boolean>;
  platform: NodeJS.Platform;
}

async function locateSample(
  actions: UseOwnVoiceActions
): Promise<{ path: string } | undefined> {
  const source = await actions.chooseSource();
  if (source === undefined) {
    return undefined;
  }
  if (source === "file") {
    const picked = await actions.pickExistingFile();
    return picked !== undefined ? { path: picked } : undefined;
  }
  const outputPath = actions.reservedRecordingPath();
  const info = platformRecordCommand(actions.platform, outputPath);
  const proceed = await actions.showRecordInstructions(info, outputPath);
  if (!proceed) {
    return undefined;
  }
  await actions.writeClipboardText(info.command);
  const appeared = await actions.waitForRecordedFile(outputPath, RECORD_WAIT_TIMEOUT_MS);
  if (!appeared) {
    await actions.showError("LLM Voice : aucun enregistrement détecté (délai dépassé ou annulé).");
    return undefined;
  }
  return { path: outputPath };
}

function rejectionMessage(validation: Extract<ReferenceAudioValidation, { ok: false }>): string {
  return `LLM Voice : échantillon refusé — ${validation.detail}`;
}

/**
 * Runs the whole wizard. Never throws on a user-facing failure (cancel,
 * invalid file, missing ffmpeg) — every branch reports through
 * `actions.showInfo`/`showError` and simply returns.
 */
export async function runUseOwnVoiceFlow(actions: UseOwnVoiceActions): Promise<void> {
  const consented = await actions.confirmConsent();
  if (!consented) {
    return;
  }

  const located = await locateSample(actions);
  if (located === undefined) {
    return;
  }

  const extension = actions.extensionOf(located.path);
  const isWav = extension === ".wav";
  const ffmpegAvailable = await actions.ffmpegAvailable();

  let workingPath = located.path;
  let converted = false;
  if (ffmpegAvailable) {
    const convertedPath = actions.reservedConvertedPath(located.path);
    const ok = await actions.convertToWavMono24k(located.path, convertedPath);
    if (ok) {
      workingPath = convertedPath;
      converted = true;
    }
  }

  if (converted || isWav) {
    const bytes = await actions.readFile(workingPath);
    const validation = validateWavReferenceAudio(bytes);
    if (!validation.ok) {
      await actions.showError(rejectionMessage(validation));
      return;
    }
    for (const warning of validation.warnings) {
      await actions.showInfo(`LLM Voice : ${warning}`);
    }
  } else {
    const proceed = await actions.confirmWarning(describeUnverifiedFormat(extension));
    if (!proceed) {
      return;
    }
  }

  const finalPath = converted ? workingPath : actions.reservedOriginalCopyPath(located.path);
  if (!converted) {
    await actions.copyFile(located.path, finalPath);
  }

  await actions.applyReferenceAudio(finalPath);
  await actions.showInfo("LLM Voice : voix de référence enregistrée localement — aucune donnée envoyée.");
  await actions.previewCurrentProfile();
}
