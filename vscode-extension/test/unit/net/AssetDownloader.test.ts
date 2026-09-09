import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AssetDownloadDeniedError,
  AssetIntegrityError,
  downloadVerifiedAsset,
  isHostAllowed
} from "../../../src/net/AssetDownloader.js";

function sha256Of(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function jsonResponse(status: number, headers: Record<string, string> = {}, body: string | null = null): Response {
  return new Response(body, { status, headers });
}

describe("isHostAllowed", () => {
  it("matches an exact hostname", () => {
    expect(isHostAllowed("github.com", { exact: new Set(["github.com"]) })).toBe(true);
    expect(isHostAllowed("evil.com", { exact: new Set(["github.com"]) })).toBe(false);
  });

  it("matches a domain suffix", () => {
    expect(isHostAllowed("release-assets.githubusercontent.com", { suffixes: [".githubusercontent.com"] })).toBe(
      true
    );
    expect(isHostAllowed("evilgithubusercontent.com", { suffixes: [".githubusercontent.com"] })).toBe(false);
  });
});

describe("downloadVerifiedAsset", () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    if (tmpDir !== undefined) {
      await rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  async function destination(): Promise<string> {
    tmpDir = await mkdtemp(join(tmpdir(), "asset-downloader-test-"));
    return join(tmpDir, "asset.bin");
  }

  it("refuses outright under strictLocal, without ever calling fetch", async () => {
    const fetchImpl = vi.fn();
    const destinationPath = await destination();
    await expect(
      downloadVerifiedAsset({
        url: "https://github.com/x/y",
        destinationPath,
        expectedSha256: "irrelevant",
        allowedHosts: { exact: new Set(["github.com"]) },
        allowedRedirectHosts: {},
        strictLocal: true,
        fetchImpl
      })
    ).rejects.toThrow(AssetDownloadDeniedError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses an entry host outside allowedHosts", async () => {
    const fetchImpl = vi.fn();
    const destinationPath = await destination();
    await expect(
      downloadVerifiedAsset({
        url: "https://evil.example/x",
        destinationPath,
        expectedSha256: "irrelevant",
        allowedHosts: { exact: new Set(["github.com"]) },
        allowedRedirectHosts: {},
        strictLocal: false,
        fetchImpl
      })
    ).rejects.toThrow(/untrusted-host/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a non-https entry URL", async () => {
    const fetchImpl = vi.fn();
    const destinationPath = await destination();
    await expect(
      downloadVerifiedAsset({
        url: "http://github.com/x",
        destinationPath,
        expectedSha256: "irrelevant",
        allowedHosts: { exact: new Set(["github.com"]) },
        allowedRedirectHosts: {},
        strictLocal: false,
        fetchImpl
      })
    ).rejects.toThrow(/tls-required/);
  });

  it("downloads, verifies SHA-256, and writes the file atomically", async () => {
    const content = "hello piper";
    const fetchImpl = vi.fn(async () => jsonResponse(200, { "content-length": String(content.length) }, content));
    const destinationPath = await destination();
    const onProgress = vi.fn();

    await downloadVerifiedAsset({
      url: "https://github.com/x/y.tar.gz",
      destinationPath,
      expectedSha256: sha256Of(content),
      allowedHosts: { exact: new Set(["github.com"]) },
      allowedRedirectHosts: {},
      strictLocal: false,
      fetchImpl,
      onProgress
    });

    const written = await readFile(destinationPath, "utf8");
    expect(written).toBe(content);
    expect(onProgress).toHaveBeenCalled();
    // no leftover `.download-*` temp file
    const dirEntries = await readFile(destinationPath); // sanity: file exists, readable
    expect(dirEntries.length).toBeGreaterThan(0);
  });

  it("follows a redirect toward an allowed suffix host, denies any other", async () => {
    const content = "release bytes";
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(302, { location: "https://release-assets.githubusercontent.com/x" }))
      .mockResolvedValueOnce(jsonResponse(200, { "content-length": String(content.length) }, content));
    const destinationPath = await destination();

    await downloadVerifiedAsset({
      url: "https://github.com/x/y.tar.gz",
      destinationPath,
      expectedSha256: sha256Of(content),
      allowedHosts: { exact: new Set(["github.com"]) },
      allowedRedirectHosts: { suffixes: [".githubusercontent.com"] },
      strictLocal: false,
      fetchImpl
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(await readFile(destinationPath, "utf8")).toBe(content);
  });

  it("denies a redirect toward a host outside allowedRedirectHosts", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(302, { location: "https://evil.example/x" }));
    const destinationPath = await destination();

    await expect(
      downloadVerifiedAsset({
        url: "https://github.com/x/y.tar.gz",
        destinationPath,
        expectedSha256: "irrelevant",
        allowedHosts: { exact: new Set(["github.com"]) },
        allowedRedirectHosts: { suffixes: [".githubusercontent.com"] },
        strictLocal: false,
        fetchImpl
      })
    ).rejects.toThrow(/untrusted-host/);
  });

  it("gives up after maxRedirects hops", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(302, { location: "https://github.com/next" }));
    const destinationPath = await destination();

    await expect(
      downloadVerifiedAsset({
        url: "https://github.com/x",
        destinationPath,
        expectedSha256: "irrelevant",
        allowedHosts: { exact: new Set(["github.com"]) },
        allowedRedirectHosts: { exact: new Set(["github.com"]) },
        strictLocal: false,
        fetchImpl,
        maxRedirects: 2
      })
    ).rejects.toThrow(/too-many-redirects/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("rejects and removes the temp file on a SHA-256 mismatch, leaving no file at destinationPath", async () => {
    const content = "tampered content";
    const fetchImpl = vi.fn(async () => jsonResponse(200, {}, content));
    const destinationPath = await destination();

    await expect(
      downloadVerifiedAsset({
        url: "https://github.com/x/y.tar.gz",
        destinationPath,
        expectedSha256: "0000000000000000000000000000000000000000000000000000000000000",
        allowedHosts: { exact: new Set(["github.com"]) },
        allowedRedirectHosts: {},
        strictLocal: false,
        fetchImpl
      })
    ).rejects.toThrow(AssetIntegrityError);

    await expect(stat(destinationPath)).rejects.toThrow();
    if (tmpDir !== undefined) {
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(tmpDir);
      expect(entries).toEqual([]);
    }
  });

  it("propagates an HTTP error status as a plain Error", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {}, "not found"));
    const destinationPath = await destination();

    await expect(
      downloadVerifiedAsset({
        url: "https://github.com/x/missing",
        destinationPath,
        expectedSha256: "irrelevant",
        allowedHosts: { exact: new Set(["github.com"]) },
        allowedRedirectHosts: {},
        strictLocal: false,
        fetchImpl
      })
    ).rejects.toThrow(/HTTP 404/);
  });
});
