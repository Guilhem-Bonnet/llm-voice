/**
 * `LLM Voice: Use My Own Voice` (S8.2, CdC §55): the `vscode`/`node:*`
 * wiring layer around `useOwnVoiceFlow.ts`'s pure state machine — same split
 * as `SetupVoice.ts`/`handleVoiceTier.ts`.
 */

import { spawn, spawnSync } from "node:child_process";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import type { RecordCommandInfo } from "./recordCommand.js";
import { RECORD_POLL_INTERVAL_MS } from "./recordCommand.js";
import { runUseOwnVoiceFlow, type UseOwnVoiceActions } from "./useOwnVoiceFlow.js";

const REFERENCE_AUDIO_EXTENSIONS_FILTER: Record<string, string[]> = {
  Audio: ["wav", "mp3", "flac", "ogg", "opus", "m4a"]
};

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fsp.stat(candidate);
    return true;
  } catch {
    return false;
  }
}

/** Polls for `path` to appear, cancellable through VS Code's own progress UI (CdC §55's "surveille l'apparition du fichier"). */
async function waitForFile(filePath: string, timeoutMs: number): Promise<boolean> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "LLM Voice : en attente de l'enregistrement…",
      cancellable: true
    },
    async (_progress, cancellation) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (cancellation.isCancellationRequested) {
          return false;
        }
        if (await pathExists(filePath)) {
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, RECORD_POLL_INTERVAL_MS));
      }
      return false;
    }
  );
}

function ffmpegAvailable(): boolean {
  try {
    const result = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return result.status === 0;
  } catch {
    return false;
  }
}

/** `ffmpeg -y -i <in> -ar 24000 -ac 1 <out>` — local process only, no network (docs/security). */
function convertWithFfmpeg(inputPath: string, outputPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(
      "ffmpeg",
      ["-y", "-i", inputPath, "-ar", "24000", "-ac", "1", outputPath],
      { stdio: "ignore" }
    );
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

export interface UseOwnVoiceHost {
  extensionContext: vscode.ExtensionContext;
  /** Sets `profile.tts.referenceAudio` on the currently selected profile and saves it. */
  applyReferenceAudio(absolutePath: string): Promise<void>;
  /** Plays the current profile's test text with the newly applied reference. */
  previewCurrentProfile(): Promise<void>;
}

function voicesDir(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, "voices");
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "voice"
  );
}

function buildActions(host: UseOwnVoiceHost): UseOwnVoiceActions {
  const dir = voicesDir(host.extensionContext);
  return {
    platform: os.platform(),

    async confirmConsent() {
      const choice = await vscode.window.showWarningMessage(
        "LLM Voice : utiliser votre propre voix comme référence de clonage (CdC §55). " +
          "N'utilisez que votre propre voix, ou une voix pour laquelle vous avez un accord explicite. " +
          "Le fichier reste entièrement local : il n'est jamais envoyé ailleurs que vers le serveur TTS " +
          "que vous avez vous-même configuré sur cette machine.",
        { modal: true },
        "Continuer"
      );
      return choice === "Continuer";
    },

    async chooseSource() {
      const picked = await vscode.window.showQuickPick(
        [
          { label: "$(file-media) Choisir un fichier existant", value: "file" as const },
          { label: "$(mic) Enregistrer maintenant", value: "record" as const }
        ],
        { title: "LLM Voice : votre voix", placeHolder: "Comment voulez-vous fournir l'échantillon ?" }
      );
      return picked?.value;
    },

    async pickExistingFile() {
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: REFERENCE_AUDIO_EXTENSIONS_FILTER,
        openLabel: "Utiliser ce fichier"
      });
      return uris?.[0]?.fsPath;
    },

    async showRecordInstructions(info: RecordCommandInfo, outputPath: string) {
      const fallbackNote = info.fallback !== undefined ? `\n\nAlternative : ${info.fallback}` : "";
      const choice = await vscode.window.showInformationMessage(
        `LLM Voice : lancez cette commande dans un terminal (15 à 20 secondes de parole), ` +
          `puis Ctrl-C pour arrêter :\n\n${info.command}${fallbackNote}\n\n` +
          `L'enregistrement est attendu ici : ${outputPath}`,
        { modal: true },
        "Copier la commande"
      );
      return choice === "Copier la commande";
    },

    async writeClipboardText(text: string) {
      await vscode.env.clipboard.writeText(text);
    },

    async waitForRecordedFile(filePath: string, timeoutMs: number) {
      return waitForFile(filePath, timeoutMs);
    },

    async readFile(filePath: string) {
      const buffer = await fsp.readFile(filePath);
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    },

    extensionOf(filePath: string) {
      return path.extname(filePath).toLowerCase();
    },

    async ffmpegAvailable() {
      return ffmpegAvailable();
    },

    async convertToWavMono24k(inputPath: string, outputPath: string) {
      await fsp.mkdir(path.dirname(outputPath), { recursive: true });
      return convertWithFfmpeg(inputPath, outputPath);
    },

    async copyFile(inputPath: string, outputPath: string) {
      await fsp.mkdir(path.dirname(outputPath), { recursive: true });
      await fsp.copyFile(inputPath, outputPath);
    },

    reservedConvertedPath(sourcePath: string) {
      const base = slugify(path.basename(sourcePath, path.extname(sourcePath)));
      return path.join(dir, `${base}-${Date.now()}.wav`);
    },

    reservedOriginalCopyPath(sourcePath: string) {
      const extension = path.extname(sourcePath);
      const base = slugify(path.basename(sourcePath, extension));
      return path.join(dir, `${base}-${Date.now()}${extension}`);
    },

    reservedRecordingPath() {
      return path.join(os.tmpdir(), `llm-voice-recording-${Date.now()}.wav`);
    },

    async applyReferenceAudio(absolutePath: string) {
      await host.applyReferenceAudio(absolutePath);
    },

    async previewCurrentProfile() {
      await host.previewCurrentProfile();
    },

    async showInfo(message: string) {
      void vscode.window.showInformationMessage(message);
    },

    async showError(message: string) {
      void vscode.window.showErrorMessage(message);
    },

    async confirmWarning(message: string) {
      const choice = await vscode.window.showWarningMessage(message, { modal: true }, "Continuer");
      return choice === "Continuer";
    }
  };
}

/** Registered as `llmVoice.useOwnVoice`. */
export async function useOwnVoice(host: UseOwnVoiceHost): Promise<void> {
  await fsp.mkdir(voicesDir(host.extensionContext), { recursive: true });
  await runUseOwnVoiceFlow(buildActions(host));
}
