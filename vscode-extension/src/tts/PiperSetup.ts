/**
 * ADR-009 §3 "Local sans installation" — niveau 1b, palier 2:
 * `LLM Voice: Install Local Voice (Piper)` downloads, verifies and installs
 * the Piper binary + the `fr_FR-siwis-medium` voice into
 * `globalStorageUri/piper/`, entirely behind an explicit consent dialog
 * naming size, source and licence (`PiperInstallPrompt.confirm`) — nothing
 * network-bound here ever runs before that confirmation returns `true`.
 * Once installed, `SystemTtsProvider.detectEngine()` picks it up
 * automatically next call (no restart, no extra setting) ahead of
 * `espeak-ng` (`SystemTtsProvider`'s file header).
 *
 * Every byte comes from `downloadVerifiedAsset` (`src/net/AssetDownloader.ts`)
 * — SHA-256-verified against `piperAssets.json`, host-allowlisted, refused
 * under `LLM_VOICE_STRICT_LOCAL=1`. This module adds the install-specific
 * plumbing on top: consent, progress, extraction (`tar`, real on every
 * platform this ships for — see the file-level note below), and an
 * all-or-nothing install directory swap so a failed or cancelled attempt
 * never corrupts a working install.
 *
 * **Extraction via `tar`, not an npm dependency**: `zod` is this
 * extension's one production dependency (ADR-005), by design — adding a
 * `tar`/`unzip` package for one command would break that invariant for
 * every user, forever, to save one `child_process.spawn` call here. Piper's
 * releases are `.tar.gz` on Linux/macOS and `.zip` on Windows; GNU tar
 * auto-detects gzip (`tar -xf` needs no `-z`, verified: `tar (GNU tar)
 * 1.35`) and Windows ships `tar.exe` (bsdtar via libarchive) since 10
 * 1803+, which extracts `.zip` too — one `tar -xf … --strip-components=1`
 * invocation covers every supported platform.
 *
 * **`--strip-components=1`**: every Piper release archive contains one
 * top-level `piper/` directory holding the executable *and* its shared
 * libraries (`libonnxruntime.so*`, `libespeak-ng.so*`, `libpiper_phonemize.so*`,
 * `espeak-ng-data/`) — confirmed live (`ldd ./piper/piper`): the binary's
 * `RPATH` is `$ORIGIN`-relative, so it only finds those libraries if they
 * stay siblings of the executable. Stripping the archive's one top-level
 * component lands everything directly in `<installDir>/bin/`, which is
 * exactly where `SystemTtsProvider.detectPiper()` looks for both.
 */
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  downloadVerifiedAsset,
  AssetDownloadDeniedError,
  AssetIntegrityError,
  type AssetDownloadLogEvent,
  type HostAllowlist
} from "../net/AssetDownloader.js";
import piperAssetsJson from "./piperAssets.json";

interface PiperAssetEntry {
  url: string;
  sha256: string;
  sizeBytes: number;
}

interface PiperBinaryAssetEntry extends PiperAssetEntry {
  archiveFormat: "tar.gz" | "zip";
  binaryPathInArchive: string;
}

interface PiperAssetsManifest {
  piperVersion: string;
  piperSourceUrl: string;
  piperLicense: string;
  voiceId: string;
  voiceSourceUrl: string;
  voiceLicense: string;
  binaries: Record<string, PiperBinaryAssetEntry>;
  voice: { model: PiperAssetEntry; config: PiperAssetEntry };
}

const PIPER_ASSETS = piperAssetsJson as PiperAssetsManifest;

const GITHUB_ENTRY_HOSTS: HostAllowlist = { exact: new Set(["github.com"]) };
/** GitHub Releases 302s to a region-varying `*.githubusercontent.com` CDN host (verified 2026-09-09: `release-assets.githubusercontent.com`). */
const GITHUB_REDIRECT_HOSTS: HostAllowlist = { suffixes: [".githubusercontent.com"] };
const HUGGINGFACE_ENTRY_HOSTS: HostAllowlist = { exact: new Set(["huggingface.co"]) };
/** Hugging Face resolves small files same-host and large (LFS/Xet) files to a region-varying CDN (verified 2026-09-09: `us.aws.cdn.hf.co`); both `.hf.co` and `.huggingface.co` are documented HF-operated domains. */
const HUGGINGFACE_REDIRECT_HOSTS: HostAllowlist = {
  exact: new Set(["huggingface.co"]),
  suffixes: [".huggingface.co", ".hf.co"]
};

export function resolvePlatformKey(platform: NodeJS.Platform, arch: string): string | undefined {
  const normalizedArch = arch === "x64" || arch === "arm64" ? arch : undefined;
  if (normalizedArch === undefined) {
    return undefined;
  }
  const key = `${platform}-${normalizedArch}`;
  return key in PIPER_ASSETS.binaries ? key : undefined;
}

export function getPiperBinaryAsset(platform: NodeJS.Platform, arch: string): PiperBinaryAssetEntry | undefined {
  const key = resolvePlatformKey(platform, arch);
  return key !== undefined ? PIPER_ASSETS.binaries[key] : undefined;
}

export interface PiperInstallConsentDetails {
  totalBytes: number;
  binaryUrl: string;
  binarySizeBytes: number;
  voiceUrl: string;
  voiceSizeBytes: number;
  piperLicense: string;
  piperSourceUrl: string;
  voiceLicense: string;
  voiceSourceUrl: string;
  voiceId: string;
}

/** The one gate every network call in this module is behind. */
export interface PiperInstallPrompt {
  confirm(details: PiperInstallConsentDetails): Promise<boolean>;
}

export interface PiperInstallProgressReporter {
  /** `fraction` in `[0, 1]`. */
  report(info: { fraction: number; message: string }): void;
}

export interface PiperInstallOptions {
  /** `globalStorageUri/piper`. */
  installDir: string;
  platform?: NodeJS.Platform;
  arch?: string;
  /** Defaults to `process.env["LLM_VOICE_STRICT_LOCAL"] === "1"` (D10 bunker mode). */
  strictLocal?: boolean;
  prompt: PiperInstallPrompt;
  progress?: PiperInstallProgressReporter;
  signal?: AbortSignal;
  onLog?: (event: AssetDownloadLogEvent) => void;
  /** Injectable for tests. */
  download?: typeof downloadVerifiedAsset;
  extract?: (archivePath: string, destDir: string) => Promise<void>;
}

export type PiperInstallOutcome =
  | { status: "installed"; binaryPath: string; voiceModelPath: string }
  | { status: "declined" }
  | { status: "unsupported-platform" }
  | { status: "failed"; message: string };

/** `tar -xf <archive> -C <destDir> --strip-components=1` — see the file header for why `tar` and why `--strip-components`. */
export async function extractPiperArchive(archivePath: string, destDir: string): Promise<void> {
  await fsp.mkdir(destDir, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn("tar", ["-xf", archivePath, "-C", destDir, "--strip-components=1"], { stdio: "pipe" });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`PiperSetup: tar exited ${code ?? "null"}: ${stderr.trim()}`));
      }
    });
  });
}

function fileNameOf(url: string): string {
  return path.basename(new URL(url).pathname);
}

/** Downloads (binary archive + voice model + voice config), extracts, and atomically swaps them into `installDir/{bin,voices}` — never before `prompt.confirm()` returns `true`. */
export async function installPiperVoice(options: PiperInstallOptions): Promise<PiperInstallOutcome> {
  const platform = options.platform ?? os.platform();
  const arch = options.arch ?? os.arch();
  const binaryAsset = getPiperBinaryAsset(platform, arch);
  if (binaryAsset === undefined) {
    return { status: "unsupported-platform" };
  }
  const voiceAsset = PIPER_ASSETS.voice;
  const voiceSizeBytes = voiceAsset.model.sizeBytes + voiceAsset.config.sizeBytes;
  const totalBytes = binaryAsset.sizeBytes + voiceSizeBytes;

  const consented = await options.prompt.confirm({
    totalBytes,
    binaryUrl: binaryAsset.url,
    binarySizeBytes: binaryAsset.sizeBytes,
    voiceUrl: voiceAsset.model.url,
    voiceSizeBytes,
    piperLicense: PIPER_ASSETS.piperLicense,
    piperSourceUrl: PIPER_ASSETS.piperSourceUrl,
    voiceLicense: PIPER_ASSETS.voiceLicense,
    voiceSourceUrl: PIPER_ASSETS.voiceSourceUrl,
    voiceId: PIPER_ASSETS.voiceId
  });
  if (!consented) {
    return { status: "declined" };
  }

  const strictLocal = options.strictLocal ?? process.env["LLM_VOICE_STRICT_LOCAL"] === "1";
  const download = options.download ?? downloadVerifiedAsset;
  const extract = options.extract ?? extractPiperArchive;

  const stagingRoot = path.join(options.installDir, `.staging-${process.pid}-${Date.now()}`);
  const stagingBin = path.join(stagingRoot, "bin");
  const stagingVoices = path.join(stagingRoot, "voices");
  const binDir = path.join(options.installDir, "bin");
  const voicesDir = path.join(options.installDir, "voices");
  const binaryName = platform === "win32" ? "piper.exe" : "piper";

  let bytesDoneBeforeCurrent = 0;
  const progressFor =
    (fileTotal: number, message: string) =>
    (received: number): void => {
      const fraction = totalBytes > 0 ? (bytesDoneBeforeCurrent + Math.min(received, fileTotal)) / totalBytes : 0;
      options.progress?.report({ fraction, message });
    };

  try {
    const archivePath = path.join(stagingRoot, fileNameOf(binaryAsset.url));
    await download({
      url: binaryAsset.url,
      destinationPath: archivePath,
      expectedSha256: binaryAsset.sha256,
      allowedHosts: GITHUB_ENTRY_HOSTS,
      allowedRedirectHosts: GITHUB_REDIRECT_HOSTS,
      strictLocal,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.onLog !== undefined ? { onLog: options.onLog } : {}),
      onProgress: progressFor(binaryAsset.sizeBytes, "Téléchargement du moteur Piper…")
    });
    bytesDoneBeforeCurrent += binaryAsset.sizeBytes;
    options.progress?.report({ fraction: bytesDoneBeforeCurrent / totalBytes, message: "Extraction du moteur Piper…" });
    await extract(archivePath, stagingBin);
    await fsp.rm(archivePath, { force: true }).catch(() => {});

    const modelPath = path.join(stagingVoices, `${PIPER_ASSETS.voiceId}.onnx`);
    await download({
      url: voiceAsset.model.url,
      destinationPath: modelPath,
      expectedSha256: voiceAsset.model.sha256,
      allowedHosts: HUGGINGFACE_ENTRY_HOSTS,
      allowedRedirectHosts: HUGGINGFACE_REDIRECT_HOSTS,
      strictLocal,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.onLog !== undefined ? { onLog: options.onLog } : {}),
      onProgress: progressFor(voiceAsset.model.sizeBytes, "Téléchargement de la voix française (fr_FR-siwis-medium)…")
    });
    bytesDoneBeforeCurrent += voiceAsset.model.sizeBytes;

    const configPath = path.join(stagingVoices, `${PIPER_ASSETS.voiceId}.onnx.json`);
    await download({
      url: voiceAsset.config.url,
      destinationPath: configPath,
      expectedSha256: voiceAsset.config.sha256,
      allowedHosts: HUGGINGFACE_ENTRY_HOSTS,
      allowedRedirectHosts: HUGGINGFACE_REDIRECT_HOSTS,
      strictLocal,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.onLog !== undefined ? { onLog: options.onLog } : {}),
      onProgress: progressFor(voiceAsset.config.sizeBytes, "Téléchargement de la configuration de la voix…")
    });

    // All three downloads + extraction succeeded: swap into place. A
    // previously-working install (if any) is only ever removed here, after
    // everything new is already verified and staged — never before.
    await fsp.mkdir(options.installDir, { recursive: true });
    await fsp.rm(binDir, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(voicesDir, { recursive: true, force: true }).catch(() => {});
    await fsp.rename(stagingBin, binDir);
    await fsp.rename(stagingVoices, voicesDir);

    return { status: "installed", binaryPath: path.join(binDir, binaryName), voiceModelPath: path.join(voicesDir, `${PIPER_ASSETS.voiceId}.onnx`) };
  } catch (error) {
    // Nothing swapped in yet: only the staging directory can be dirty. A
    // previously-working install (if this is a retry) is left untouched.
    const message =
      error instanceof AssetDownloadDeniedError || error instanceof AssetIntegrityError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    return { status: "failed", message };
  } finally {
    await fsp.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
  }
}
