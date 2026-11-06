/**
 * `PiperSetup` orchestration, with `download`/`extract` injected (no real
 * network call, no real `tar`) — the real download path is proven live by
 * `docs/providers.md`'s regeneration note and by `test/integration-real/`
 * (gated), and was exercised manually end to end against the real GitHub
 * Releases + Hugging Face endpoints while building this feature (see the
 * PR description).
 */
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetDownloadDeniedError } from "../../../src/net/AssetDownloader.js";
import {
  getPiperBinaryAsset,
  installPiperVoice,
  isPiperAlreadyInstalled,
  resolvePlatformKey
} from "../../../src/tts/PiperSetup.js";

describe("resolvePlatformKey / getPiperBinaryAsset", () => {
  it("resolves every supported platform/arch pair from piperAssets.json", () => {
    expect(resolvePlatformKey("linux", "x64")).toBe("linux-x64");
    expect(resolvePlatformKey("linux", "arm64")).toBe("linux-arm64");
    expect(resolvePlatformKey("darwin", "x64")).toBe("darwin-x64");
    expect(resolvePlatformKey("darwin", "arm64")).toBe("darwin-arm64");
    expect(resolvePlatformKey("win32", "x64")).toBe("win32-x64");
  });

  it("returns undefined for an unsupported arch or platform", () => {
    expect(resolvePlatformKey("linux", "ia32")).toBeUndefined();
    expect(resolvePlatformKey("freebsd", "x64")).toBeUndefined();
    expect(getPiperBinaryAsset("freebsd", "x64")).toBeUndefined();
  });

  it("every binary asset carries a 64-hex-char SHA-256 and an https URL", () => {
    for (const key of ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64"]) {
      const [platform, arch] = key.split("-") as [NodeJS.Platform, string];
      const asset = getPiperBinaryAsset(platform, arch);
      expect(asset).toBeDefined();
      expect(asset?.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(asset?.url.startsWith("https://github.com/")).toBe(true);
      expect(asset?.sizeBytes).toBeGreaterThan(0);
    }
  });
});

describe("isPiperAlreadyInstalled", () => {
  let installDir: string | undefined;

  afterEach(async () => {
    if (installDir !== undefined) {
      await rm(installDir, { recursive: true, force: true });
      installDir = undefined;
    }
  });

  it("returns undefined on a fresh/empty directory", async () => {
    installDir = await mkdtemp(join(tmpdir(), "piper-already-test-"));
    expect(await isPiperAlreadyInstalled(installDir, "linux")).toBeUndefined();
  });

  it("returns the binary/voice paths once both files exist", async () => {
    installDir = await mkdtemp(join(tmpdir(), "piper-already-test-"));
    await mkdir(join(installDir, "bin"), { recursive: true });
    await mkdir(join(installDir, "voices"), { recursive: true });
    await writeFile(join(installDir, "bin", "piper"), "x");
    await writeFile(join(installDir, "voices", "fr_FR-siwis-medium.onnx"), "x");

    const result = await isPiperAlreadyInstalled(installDir, "linux");

    expect(result).toEqual({
      binaryPath: join(installDir, "bin", "piper"),
      voiceModelPath: join(installDir, "voices", "fr_FR-siwis-medium.onnx")
    });
  });
});

describe("installPiperVoice", () => {
  let installDir: string | undefined;

  afterEach(async () => {
    if (installDir !== undefined) {
      await rm(installDir, { recursive: true, force: true });
      installDir = undefined;
    }
  });

  async function freshInstallDir(): Promise<string> {
    installDir = await mkdtemp(join(tmpdir(), "piper-setup-test-"));
    return installDir;
  }

  it("never downloads anything before the user confirms", async () => {
    const dir = await freshInstallDir();
    const download = vi.fn();
    const confirm = vi.fn().mockResolvedValue(false);

    const outcome = await installPiperVoice({
      installDir: dir,
      platform: "linux",
      arch: "x64",
      prompt: { confirm },
      download
    });

    expect(outcome).toEqual({ status: "declined" });
    expect(download).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledTimes(1);
    const details = confirm.mock.calls[0]?.[0];
    expect(details.voiceId).toBe("fr_FR-siwis-medium");
    expect(details.totalBytes).toBeGreaterThan(0);
    expect(details.piperLicense).toBeTruthy();
    expect(details.voiceLicense).toBeTruthy();
  });

  it("reports already-installed without prompting or downloading — real-user infinite-reinstall-loop bug fix (2026-11-05)", async () => {
    const dir = await freshInstallDir();
    await mkdir(join(dir, "bin"), { recursive: true });
    await mkdir(join(dir, "voices"), { recursive: true });
    await writeFile(join(dir, "bin", "piper"), "fake binary");
    await writeFile(join(dir, "voices", "fr_FR-siwis-medium.onnx"), "fake model");
    const confirm = vi.fn();
    const download = vi.fn();

    const outcome = await installPiperVoice({
      installDir: dir,
      platform: "linux",
      arch: "x64",
      prompt: { confirm },
      download
    });

    expect(outcome).toEqual({
      status: "already-installed",
      binaryPath: join(dir, "bin", "piper"),
      voiceModelPath: join(dir, "voices", "fr_FR-siwis-medium.onnx")
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it("reports already-installed on win32 with the .exe binary name", async () => {
    const dir = await freshInstallDir();
    await mkdir(join(dir, "bin"), { recursive: true });
    await mkdir(join(dir, "voices"), { recursive: true });
    await writeFile(join(dir, "bin", "piper.exe"), "fake binary");
    await writeFile(join(dir, "voices", "fr_FR-siwis-medium.onnx"), "fake model");

    const outcome = await installPiperVoice({
      installDir: dir,
      platform: "win32",
      arch: "x64",
      prompt: { confirm: vi.fn() }
    });

    expect(outcome.status).toBe("already-installed");
  });

  it("still prompts and installs when only one of the two expected files is present (a partial/corrupt install)", async () => {
    const dir = await freshInstallDir();
    await mkdir(join(dir, "bin"), { recursive: true });
    await writeFile(join(dir, "bin", "piper"), "fake binary");
    // No `voices/fr_FR-siwis-medium.onnx` — incomplete.
    const confirm = vi.fn().mockResolvedValue(false);

    const outcome = await installPiperVoice({
      installDir: dir,
      platform: "linux",
      arch: "x64",
      prompt: { confirm }
    });

    expect(outcome).toEqual({ status: "declined" });
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("reports unsupported-platform without prompting", async () => {
    const dir = await freshInstallDir();
    const confirm = vi.fn();
    const outcome = await installPiperVoice({
      installDir: dir,
      platform: "linux",
      arch: "ia32",
      prompt: { confirm }
    });
    expect(outcome).toEqual({ status: "unsupported-platform" });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("refuses under strictLocal even after consent (real downloadVerifiedAsset, no network reached)", async () => {
    const dir = await freshInstallDir();
    // No `download` override here: exercises the *real* `downloadVerifiedAsset`,
    // whose own `strictLocal` check throws before any `fetch` is attempted.
    const outcome = await installPiperVoice({
      installDir: dir,
      platform: "linux",
      arch: "x64",
      strictLocal: true,
      prompt: { confirm: async () => true }
    });
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") {
      expect(outcome.message).toMatch(/strict-local-mode/);
    }
  });

  it("downloads binary + voice, extracts, and swaps into installDir/{bin,voices} atomically", async () => {
    const dir = await freshInstallDir();
    const extract = vi.fn(async (_archivePath: string, destDir: string) => {
      await mkdir(destDir, { recursive: true });
      await writeFile(join(destDir, "piper"), "fake-binary");
    });
    const download = vi.fn(
      async (options: {
        destinationPath: string;
        onProgress?: (received: number, total: number | undefined) => void;
      }) => {
        await mkdir(join(options.destinationPath, ".."), { recursive: true });
        await writeFile(options.destinationPath, "fake-bytes");
        options.onProgress?.(11, 11);
      }
    );
    const progressEvents: { fraction: number; message: string }[] = [];

    const outcome = await installPiperVoice({
      installDir: dir,
      platform: "linux",
      arch: "x64",
      prompt: { confirm: async () => true },
      progress: { report: (info) => progressEvents.push(info) },
      download,
      extract
    });

    expect(outcome.status).toBe("installed");
    if (outcome.status === "installed") {
      expect(outcome.binaryPath).toBe(join(dir, "bin", "piper"));
      expect(await readFile(outcome.binaryPath, "utf8")).toBe("fake-binary");
      expect(await readFile(outcome.voiceModelPath, "utf8")).toBe("fake-bytes");
    }
    expect(download).toHaveBeenCalledTimes(3); // archive + model + config
    expect(extract).toHaveBeenCalledTimes(1);
    expect(progressEvents.length).toBeGreaterThan(0);
    expect(progressEvents.at(-1)?.fraction).toBeCloseTo(1, 1);
  });

  it("leaves a partial prior attempt's files untouched when a retry fails (a complete prior install now short-circuits to already-installed instead, see above)", async () => {
    const dir = await freshInstallDir();
    // Deliberately a *partial* prior attempt — the binary landed, the voice
    // model didn't — not a complete install (`isPiperAlreadyInstalled`
    // requires both), so this still reaches the download/swap path below.
    await mkdir(join(dir, "bin"), { recursive: true });
    await writeFile(join(dir, "bin", "piper"), "previous-good-binary");

    const download = vi.fn(async () => {
      throw new AssetDownloadDeniedError("untrusted-host", "evil.example");
    });

    const outcome = await installPiperVoice({
      installDir: dir,
      platform: "linux",
      arch: "x64",
      prompt: { confirm: async () => true },
      download
    });

    expect(outcome.status).toBe("failed");
    // The atomic swap (`fsp.rename(stagingBin, binDir)`) only runs once
    // every download succeeds — a failed attempt never touches `binDir` at
    // all, so the leftover file from the partial prior attempt survives.
    expect(await readFile(join(dir, "bin", "piper"), "utf8")).toBe("previous-good-binary");
  });

  it("leaves no staging directory behind after a failed attempt", async () => {
    const dir = await freshInstallDir();
    const download = vi.fn(async () => {
      throw new Error("network error");
    });
    await installPiperVoice({
      installDir: dir,
      platform: "linux",
      arch: "x64",
      prompt: { confirm: async () => true },
      download
    });
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(dir);
    expect(entries.filter((entry) => entry.startsWith(".staging-"))).toEqual([]);
  });
});
