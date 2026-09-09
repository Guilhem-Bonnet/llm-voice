/**
 * Single choke point for every outbound HTTP call made by the Extension Host
 * (the Webview never reaches the network: it is already blocked by the CSP
 * `connect-src 'none'`, see ADR-010). No `fetch`/`http.request` should ever
 * be issued outside this module.
 *
 * See ADR-010 ("EgressGuard: garantie « rien ne sort », prouvée") and the
 * `EgressGuard` D10 section of ADR-005. Deliberately has zero dependency on
 * `vscode`: the extension layer reads settings/env and passes them in via
 * `EgressGuardOptions`, so this module stays unit-testable in plain Node.
 */
import dns from "node:dns";

/** Overall network posture requested by the caller. */
export type EgressMode = "local" | "trusted" | "open";

/** How a destination was classified. `classify()` is a lexical, no-DNS,
 *  best-effort read (for UI/badges); `assertAllowed` re-derives this with a
 *  real DNS lookup and is the only classification a security decision may
 *  rely on. */
export type EgressClassification = "loopback" | "trusted" | "remote";

/** Every value here must be safe to show to a user (no secrets). */
export type EgressDenialReason =
  | "not-loopback"
  | "strict-local-mode"
  | "untrusted-host"
  | "tls-required"
  | "dns-resolution-failed"
  | "dns-rebinding"
  | "cross-host-redirect"
  | "unsupported-protocol";

/** Thrown by `assertAllowed`/`fetch` when a destination is refused. Carries
 *  only host-level information — never a URL path, query string, body or
 *  header, which may contain secrets. */
export class EgressDeniedError extends Error {
  readonly reason: EgressDenialReason;
  readonly host: string;
  readonly resolvedIps: readonly string[];

  constructor(reason: EgressDenialReason, host: string, resolvedIps: readonly string[] = []) {
    super(`EgressGuard: denied ${host} (${reason})`);
    this.name = "EgressDeniedError";
    this.reason = reason;
    this.host = host;
    this.resolvedIps = resolvedIps;
  }
}

/** One audit line. Deliberately excludes body and headers (D10): only host,
 *  path and method are ever recorded, and path is stripped of its query
 *  string since query parameters sometimes carry secrets (API keys, etc). */
export interface EgressLogEvent {
  host: string;
  path: string;
  method: string;
  decision: "allow" | "deny";
  reason?: EgressDenialReason;
}

/** Resolves a hostname to the IP addresses it points at. Defaults to
 *  `dns.lookup(..., { all: true })`; injectable so tests can simulate DNS
 *  rebinding without touching a real resolver. */
export type EgressResolver = (host: string) => Promise<string[]>;

export interface EgressGuardOptions {
  mode: EgressMode;
  /** Hostnames allowed in `trusted` mode, matched case-insensitively. */
  trustedHosts: readonly string[];
  /** Forces `local` mode regardless of `mode`/`trustedHosts` (read by the
   *  caller from `LLM_VOICE_STRICT_LOCAL=1`, never a VS Code setting — see
   *  ADR-010's rejected alternative on why a setting is not trusted). */
  strictLocal: boolean;
  resolve?: EgressResolver;
  logger?: (event: EgressLogEvent) => void;
  /** Injectable `fetch` (tests). Defaults to the global one. */
  fetchImpl?: typeof fetch;
}

/** The object returned by `createEgressGuard`. */
export interface EgressGuardHandle {
  /** Throws `EgressDeniedError` if `url` may not be contacted; resolves DNS
   *  for any destination that claims to be loopback and verifies every
   *  resolved address is actually inside 127.0.0.0/8 or `::1` (anti DNS
   *  rebinding, D10) before returning. */
  assertAllowed(url: URL): Promise<void>;
  /** `fetch` guarded by `assertAllowed`. Always issued with
   *  `redirect: 'manual'`; any 3xx response whose `Location` names a
   *  different host is refused, even toward another loopback address. */
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
  /** Lexical, synchronous, no-DNS classification — a UI hint only, never a
   *  security decision (that is `assertAllowed`'s job). */
  classify(url: URL): EgressClassification;
}

const IPV4_LOOPBACK = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
/** IPv4-mapped IPv6 form of a 127.0.0.0/8 address (`::ffff:127.0.0.1`). */
const IPV6_MAPPED_IPV4_LOOPBACK = /^::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
/**
 * Only these two schemes ever leave the Extension Host. Without this
 * allowlist `file://localhost/etc/passwd` passes the loopback branch below
 * (its hostname *is* `localhost`) and `data:`/`blob:` URLs reach `fetch`
 * with an empty hostname — neither is a destination this guard can reason
 * about, so both are refused before anything else happens (S6.1 audit).
 */
const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

function stripBrackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

/** True for the literal hostname `localhost`, an IPv4 literal in
 *  127.0.0.0/8, or the IPv6 loopback `::1` — a purely lexical check that
 *  never resolves DNS. Never treats a hostname that merely *contains*
 *  "localhost" (e.g. `localhost.evil`) as loopback. */
function isLexicallyLoopback(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === "localhost") {
    return true;
  }
  const stripped = stripBrackets(lower);
  if (IPV4_LOOPBACK.test(stripped)) {
    return true;
  }
  return stripped === "::1";
}

/** True for an IP address (as returned by DNS resolution) inside
 *  127.0.0.0/8, `::1`, or the IPv4-mapped form of either. */
function isLoopbackAddress(address: string): boolean {
  const normalized = stripBrackets(address.toLowerCase());
  if (IPV4_LOOPBACK.test(normalized)) {
    return true;
  }
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") {
    return true;
  }
  return IPV6_MAPPED_IPV4_LOOPBACK.test(normalized);
}

/** Wraps an IPv6 literal in brackets so it can be used as a URL hostname. */
function toUrlHost(address: string): string {
  const bare = stripBrackets(address);
  return bare.includes(":") ? `[${bare}]` : bare;
}

async function defaultResolve(host: string): Promise<string[]> {
  const results = await dns.promises.lookup(stripBrackets(host), { all: true, verbatim: true });
  return results.map((entry) => entry.address);
}

function toPathOnly(url: URL): string {
  return url.pathname;
}

/** Creates an `EgressGuard` bound to a fixed configuration. See the module
 *  doc comment and ADR-010 for the rules enforced. */
export function createEgressGuard(options: EgressGuardOptions): EgressGuardHandle {
  const trustedHosts = new Set(options.trustedHosts.map((host) => host.toLowerCase()));
  const resolve = options.resolve ?? defaultResolve;
  const log = options.logger ?? ((): void => {});
  const doFetch = options.fetchImpl ?? fetch;

  function classify(url: URL): EgressClassification {
    const hostname = url.hostname.toLowerCase();
    if (isLexicallyLoopback(hostname)) {
      return "loopback";
    }
    if (trustedHosts.has(hostname)) {
      return "trusted";
    }
    return "remote";
  }

  function emit(url: URL, method: string, decision: "allow" | "deny", reason?: EgressDenialReason): void {
    const event: EgressLogEvent = { host: url.hostname, path: toPathOnly(url), method, decision };
    if (reason !== undefined) {
      event.reason = reason;
    }
    log(event);
  }

  /** Returns the IP the caller must actually connect to, when the
   *  destination was validated by DNS resolution (loopback branch). */
  async function assertAllowed(url: URL, method = "GET"): Promise<string | undefined> {
    const effectiveMode: EgressMode = options.strictLocal ? "local" : options.mode;
    const hostname = url.hostname.toLowerCase();

    if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
      emit(url, method, "deny", "unsupported-protocol");
      throw new EgressDeniedError("unsupported-protocol", hostname, []);
    }

    if (isLexicallyLoopback(hostname)) {
      // Anti DNS-rebinding (D10): never trust the name, even "localhost" —
      // a poisoned resolver or /etc/hosts entry could point it elsewhere.
      let resolvedIps: string[];
      try {
        resolvedIps = await resolve(hostname);
      } catch {
        emit(url, method, "deny", "dns-resolution-failed");
        throw new EgressDeniedError("dns-resolution-failed", hostname, []);
      }
      if (resolvedIps.length === 0 || !resolvedIps.every(isLoopbackAddress)) {
        emit(url, method, "deny", "dns-rebinding");
        throw new EgressDeniedError("dns-rebinding", hostname, resolvedIps);
      }
      emit(url, method, "allow");
      // Anti-TOCTOU (S6.1 audit): the caller connects to *this* address, not
      // to the name — `fetch` would otherwise resolve `hostname` a second
      // time and a rebinding resolver could answer a public IP in between.
      return resolvedIps[0];
    }

    if (effectiveMode === "local") {
      const reason: EgressDenialReason = options.strictLocal ? "strict-local-mode" : "not-loopback";
      emit(url, method, "deny", reason);
      throw new EgressDeniedError(reason, hostname, []);
    }

    const isTrusted = trustedHosts.has(hostname);

    if (effectiveMode === "trusted") {
      if (!isTrusted) {
        emit(url, method, "deny", "untrusted-host");
        throw new EgressDeniedError("untrusted-host", hostname, []);
      }
      if (url.protocol !== "https:") {
        emit(url, method, "deny", "tls-required");
        throw new EgressDeniedError("tls-required", hostname, []);
      }
      emit(url, method, "allow");
      return undefined;
    }

    // effectiveMode === "open": no host restriction, but a declared trusted
    // host still must use TLS — "open" widens what may be contacted, it
    // does not weaken the transport requirement for hosts we vouch for.
    if (isTrusted && url.protocol !== "https:") {
      emit(url, method, "deny", "tls-required");
      throw new EgressDeniedError("tls-required", hostname, []);
    }
    emit(url, method, "allow");
    return undefined;
  }

  async function guardedFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
    const url = input instanceof URL ? input : new URL(input);
    const method = init.method ?? "GET";
    const pinnedIp = await assertAllowed(url, method);

    // The URL actually dialled. When DNS validated the destination we dial
    // the resolved *address*, never the name again (D10 anti-rebinding: two
    // resolutions are two different answers to an attacker-controlled
    // resolver). Loopback servers do not do virtual hosting, so dropping
    // the name costs nothing here.
    const target = new URL(url.href);
    if (pinnedIp !== undefined) {
      target.hostname = toUrlHost(pinnedIp);
    }

    const response = await doFetch(target, { ...init, redirect: "manual" });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location !== null) {
        let redirectTarget: URL;
        try {
          redirectTarget = new URL(location, url);
        } catch {
          emit(url, method, "deny", "cross-host-redirect");
          throw new EgressDeniedError("cross-host-redirect", "", []);
        }
        if (!ALLOWED_PROTOCOLS.has(redirectTarget.protocol)) {
          emit(url, method, "deny", "unsupported-protocol");
          throw new EgressDeniedError("unsupported-protocol", redirectTarget.hostname, []);
        }
        if (redirectTarget.hostname.toLowerCase() !== url.hostname.toLowerCase()) {
          emit(url, method, "deny", "cross-host-redirect");
          throw new EgressDeniedError("cross-host-redirect", redirectTarget.hostname, []);
        }
      }
    }

    return response;
  }

  return {
    assertAllowed: async (url: URL): Promise<void> => {
      await assertAllowed(url);
    },
    fetch: guardedFetch,
    classify
  };
}
