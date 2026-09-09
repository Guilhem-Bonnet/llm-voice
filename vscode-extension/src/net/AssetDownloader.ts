/**
 * `downloadVerifiedAsset`: the one other legitimate direct-`fetch` call site
 * besides `EgressGuard.ts` itself (ADR-010's "aucun `fetch` hors `net/`"),
 * used exclusively by `PiperSetup` (`src/tts/PiperSetup.ts`, ADR-009 §3) to
 * download the Piper binary and the `fr_FR-siwis-medium` voice — both
 * gated behind an explicit, informed user consent dialog (`PiperSetup`'s
 * `PiperInstallPrompt`) before this module is ever reached.
 *
 * It exists because `EgressGuard.fetch()`'s redirect policy — any redirect
 * that changes host is refused, unconditionally, even toward a
 * `trustedHosts` entry (`EgressGuard.ts`: the check compares against the
 * *original* request's hostname, not against `trustedHosts` membership) —
 * is the right policy for every JSON/API call this extension makes
 * (`TtsProvider`/`NarratorProvider`, ADR-005) and the wrong one for a GitHub
 * Releases / Hugging Face download: both **always** 302 to a signed,
 * single-use CDN host, verified live on 2026-09-09:
 *   `github.com/.../releases/download/...` → `release-assets.githubusercontent.com`
 *   `huggingface.co/.../resolve/...`        → `cdn-lfs*.huggingface.co`
 *
 * What still holds here, deliberately mirroring `EgressGuard`'s guarantees
 * instead of its exact redirect mechanism:
 *  - `strictLocal` (the caller reads `LLM_VOICE_STRICT_LOCAL`, same env var
 *    as `EgressGuard`'s D10 "bunker mode") refuses outright, no exceptions.
 *  - The *entry* URL's host must be in `allowedHosts` (the caller names
 *    exactly the two hosts it trusts — `github.com`/`huggingface.co`);
 *    every redirect hop after that must be HTTPS and in
 *    `allowedRedirectHosts` (the known CDN hosts of those two providers) —
 *    a redirect toward an arbitrary third host is still refused.
 *  - SHA-256 verified against a value the caller already knows ahead of
 *    time (`src/tts/piperAssets.json`, never trust-on-first-use): a
 *    corrupted or substituted byte stream is caught before it ever reaches
 *    `destinationPath` — written to a sibling temp file first, `rename`d
 *    only once the digest matches, so a failed/cancelled download never
 *    leaves a corrupt file at the real path.
 *  - Every hop is logged through a `host`-only shape (no query string —
 *    GitHub/HF signed URLs carry a short-lived token in theirs).
 */
import { createHash } from "node:crypto";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";

export interface AssetDownloadLogEvent {
  host: string;
  decision: "allow" | "deny";
  reason?: string;
}

export class AssetDownloadDeniedError extends Error {
  readonly reason: string;
  readonly host: string;

  constructor(reason: string, host: string) {
    super(`AssetDownloader: denied ${host} (${reason})`);
    this.name = "AssetDownloadDeniedError";
    this.reason = reason;
    this.host = host;
  }
}

export class AssetIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetIntegrityError";
  }
}

/**
 * `exact`: hostnames matched verbatim. `suffixes`: a host is allowed if it
 * *ends with* one of these (each expected to start with `.`, e.g.
 * `.githubusercontent.com`) — needed because both GitHub Releases and
 * Hugging Face resolve through a **region-varying** CDN host (verified live
 * on 2026-09-09: GitHub → `release-assets.githubusercontent.com`, Hugging
 * Face → `us.aws.cdn.hf.co` for this request, documented as varying by
 * region/edge — an exact-hostname allowlist would silently break for a
 * user routed to a different edge).
 */
export interface HostAllowlist {
  exact?: ReadonlySet<string>;
  suffixes?: readonly string[];
}

export interface DownloadVerifiedAssetOptions {
  url: string;
  /** Absolute destination path; written atomically (temp file + rename). */
  destinationPath: string;
  /** Hex-encoded, case-insensitive. */
  expectedSha256: string;
  /** Hosts the *entry* `url` may target. */
  allowedHosts: HostAllowlist;
  /** Hosts any redirect hop may target. */
  allowedRedirectHosts: HostAllowlist;
  /** `process.env.LLM_VOICE_STRICT_LOCAL === "1"`, read by the caller (D10 bunker mode). */
  strictLocal: boolean;
  onProgress?: (receivedBytes: number, totalBytes: number | undefined) => void;
  onLog?: (event: AssetDownloadLogEvent) => void;
  signal?: AbortSignal;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  maxRedirects?: number;
}

const DEFAULT_MAX_REDIRECTS = 5;

/** True if `host` is in `allowlist.exact`, or ends with one of `allowlist.suffixes`. */
export function isHostAllowed(host: string, allowlist: HostAllowlist): boolean {
  if (allowlist.exact?.has(host) === true) {
    return true;
  }
  return (allowlist.suffixes ?? []).some((suffix) => host.endsWith(suffix));
}

export async function downloadVerifiedAsset(options: DownloadVerifiedAssetOptions): Promise<void> {
  const log = options.onLog ?? ((): void => {});
  const doFetch = options.fetchImpl ?? fetch;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  if (options.strictLocal) {
    const host = safeHostname(options.url);
    log({ host, decision: "deny", reason: "strict-local-mode" });
    throw new AssetDownloadDeniedError("strict-local-mode", host);
  }

  let currentUrl = new URL(options.url);
  let response: Response | undefined;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const hopHost = currentUrl.hostname.toLowerCase();
    const allowlist = hop === 0 ? options.allowedHosts : options.allowedRedirectHosts;
    if (currentUrl.protocol !== "https:") {
      log({ host: hopHost, decision: "deny", reason: "tls-required" });
      throw new AssetDownloadDeniedError("tls-required", hopHost);
    }
    if (!isHostAllowed(hopHost, allowlist)) {
      log({ host: hopHost, decision: "deny", reason: "untrusted-host" });
      throw new AssetDownloadDeniedError("untrusted-host", hopHost);
    }
    log({ host: hopHost, decision: "allow" });

    const candidate = await doFetch(currentUrl, {
      redirect: "manual",
      ...(options.signal !== undefined ? { signal: options.signal } : {})
    });

    if (candidate.status >= 300 && candidate.status < 400) {
      const location = candidate.headers.get("location");
      if (location === null) {
        throw new AssetDownloadDeniedError("cross-host-redirect", hopHost);
      }
      currentUrl = new URL(location, currentUrl);
      continue;
    }
    if (!candidate.ok) {
      throw new Error(`AssetDownloader: HTTP ${candidate.status} from ${hopHost}`);
    }
    response = candidate;
    break;
  }

  if (response === undefined) {
    throw new AssetDownloadDeniedError("too-many-redirects", currentUrl.hostname.toLowerCase());
  }
  const body = response.body;
  if (body === null) {
    throw new Error("AssetDownloader: response has no body");
  }

  const totalBytes = parseContentLength(response.headers.get("content-length"));
  await fsp.mkdir(path.dirname(options.destinationPath), { recursive: true });
  const tempPath = `${options.destinationPath}.download-${process.pid}-${Date.now()}`;
  const hash = createHash("sha256");
  let received = 0;

  const fileHandle = await fsp.open(tempPath, "w");
  try {
    for await (const chunk of Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>)) {
      const buffer = chunk as Buffer;
      hash.update(buffer);
      received += buffer.byteLength;
      await fileHandle.write(buffer);
      options.onProgress?.(received, totalBytes);
    }
  } catch (error) {
    await fileHandle.close();
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
  await fileHandle.close();

  const digest = hash.digest("hex");
  if (digest !== options.expectedSha256.toLowerCase()) {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    throw new AssetIntegrityError(
      `AssetDownloader: SHA-256 mismatch for ${path.basename(options.destinationPath)} ` +
        `(expected ${options.expectedSha256}, got ${digest})`
    );
  }
  await fsp.rename(tempPath, options.destinationPath);
}

function parseContentLength(header: string | null): number | undefined {
  if (header === null) {
    return undefined;
  }
  const parsed = Number.parseInt(header, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}
