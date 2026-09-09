/**
 * S6.1 — Attack tests, axis 3: `EgressGuard` bypass attempts (AC-SEC-01,
 * ADR-010).
 *
 * Every case here is an *attempt to make the guard say yes* to something
 * that leaves the machine, or to make the connection go somewhere other
 * than the address the guard validated. Two of them were real holes before
 * this audit and are marked as such.
 */

import { describe, expect, it, vi } from "vitest";

import { EgressDeniedError, createEgressGuard, type EgressLogEvent } from "../../../src/net/EgressGuard.js";

/** A guard in the default (local-only) posture. */
function localGuard(overrides: Partial<Parameters<typeof createEgressGuard>[0]> = {}) {
  const events: EgressLogEvent[] = [];
  const guard = createEgressGuard({
    mode: "local",
    trustedHosts: [],
    strictLocal: false,
    resolve: async () => ["127.0.0.1"],
    logger: (event) => events.push(event),
    ...overrides
  });
  return { guard, events };
}

async function denialReason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof EgressDeniedError) {
      return error.reason;
    }
    throw error;
  }
  throw new Error("expected the destination to be denied, it was allowed");
}

describe("AC-SEC-01 — host-notation bypasses", () => {
  it.each([
    ["userinfo pointing at a remote host", "http://127.0.0.1@evil.example/x"],
    ["userinfo with a password", "http://user:pw@evil.example/x"],
    ["userinfo that looks like localhost", "http://localhost@evil.example/x"],
    ["decimal IPv4 of a public address", "http://16843009/x"],
    ["IPv4-mapped IPv6 of a public address", "http://[::ffff:1.2.3.4]/x"],
    ["unspecified IPv4", "http://0.0.0.0/x"],
    ["unspecified IPv6", "http://[::]/x"],
    ["hostname that merely contains localhost", "http://localhost.evil.example/x"],
    ["hostname that ends in localhost", "http://evil-localhost/x"],
    ["trailing-dot localhost", "http://localhost./x"],
    ["uppercase remote host", "http://EVIL.EXAMPLE/x"]
  ])("denies %s in local mode", async (_label, url) => {
    const { guard } = localGuard();
    const reason = await denialReason(guard.assertAllowed(new URL(url)));
    expect(reason).toBe("not-loopback");
  });

  it("still allows the real loopback forms", async () => {
    const { guard } = localGuard();
    for (const url of ["http://localhost:11434/api/tags", "http://127.0.0.1:8004/health", "http://[::1]:8880/v1"]) {
      await expect(guard.assertAllowed(new URL(url))).resolves.toBeUndefined();
    }
  });

  it("classify() agrees with the decision for these forms", () => {
    const { guard } = localGuard();
    expect(guard.classify(new URL("http://16843009/x"))).toBe("remote");
    expect(guard.classify(new URL("http://0.0.0.0/x"))).toBe("remote");
    expect(guard.classify(new URL("http://localhost.evil.example/x"))).toBe("remote");
    expect(guard.classify(new URL("http://127.0.0.1/x"))).toBe("loopback");
  });
});

/**
 * Alternative IPv4 notations (decimal, octal, hex, short form) are the
 * classic SSRF filter-evasion trick, but they cannot evade *this* filter:
 * the guard only ever inspects `URL.hostname`, and the WHATWG URL parser
 * has already canonicalised every one of those forms to dotted-quad before
 * the guard sees it. Pinned here so a future refactor that starts parsing
 * the raw string itself fails loudly.
 */
describe("AC-SEC-01 — alternative IPv4 notations are canonicalised, not smuggled", () => {
  it.each([
    ["decimal", "http://2130706433/x"],
    ["octal", "http://0177.0.0.1/x"],
    ["hex", "http://0x7f000001/x"],
    ["short form", "http://127.1/x"]
  ])("%s form of 127.0.0.1 is seen as 127.0.0.1", async (_label, url) => {
    expect(new URL(url).hostname).toBe("127.0.0.1");
    const { guard } = localGuard();
    // Correctly *allowed*: it really is loopback, however it was spelled.
    await expect(guard.assertAllowed(new URL(url))).resolves.toBeUndefined();
  });

  it("the same notation for a public address is denied", async () => {
    expect(new URL("http://16843009/x").hostname).toBe("1.1.1.1");
    const { guard } = localGuard();
    expect(await denialReason(guard.assertAllowed(new URL("http://16843009/x")))).toBe("not-loopback");
  });
});

describe("AC-SEC-01 — non-HTTP schemes", () => {
  it.each([
    ["file with a loopback authority", "file://localhost/etc/passwd"],
    ["file with no authority", "file:///etc/passwd"],
    ["data", "data:text/plain;base64,aGk="],
    ["ws", "ws://localhost:8080/socket"],
    ["ftp", "ftp://localhost/x"]
  ])("denies %s", async (_label, url) => {
    const { guard } = localGuard();
    expect(await denialReason(guard.assertAllowed(new URL(url)))).toBe("unsupported-protocol");
  });

  it("denies them in open mode too — the scheme is not a locality question", async () => {
    const { guard } = localGuard({ mode: "open" });
    expect(await denialReason(guard.assertAllowed(new URL("file://localhost/etc/passwd")))).toBe(
      "unsupported-protocol"
    );
  });
});

describe("AC-SEC-01 — DNS rebinding", () => {
  it("denies a name that resolves anywhere but loopback", async () => {
    const { guard } = localGuard({ resolve: async () => ["1.2.3.4"] });
    expect(await denialReason(guard.assertAllowed(new URL("http://localhost:8004/x")))).toBe("dns-rebinding");
  });

  it("denies a mixed answer — one public address is enough", async () => {
    const { guard } = localGuard({ resolve: async () => ["127.0.0.1", "1.2.3.4"] });
    expect(await denialReason(guard.assertAllowed(new URL("http://localhost:8004/x")))).toBe("dns-rebinding");
  });

  it("denies an empty answer rather than assuming loopback", async () => {
    const { guard } = localGuard({ resolve: async () => [] });
    expect(await denialReason(guard.assertAllowed(new URL("http://localhost:8004/x")))).toBe("dns-rebinding");
  });

  /**
   * The TOCTOU hole this audit closed. The guard resolved the name, saw
   * loopback, then handed the *name* to `fetch`, which resolved it a second
   * time — and a rebinding resolver answers differently the second time.
   * The fix is to dial the address the guard validated.
   */
  it("connects to the validated address, never to the name a second time", async () => {
    let call = 0;
    const dialled: string[] = [];
    const guard = createEgressGuard({
      mode: "local",
      trustedHosts: [],
      strictLocal: false,
      // First answer: loopback (passes the check). Second: a public address.
      resolve: async () => (++call === 1 ? ["127.0.0.1"] : ["203.0.113.7"]),
      fetchImpl: (async (input: string | URL) => {
        dialled.push(new URL(input as URL).href);
        return new Response("ok", { status: 200 });
      }) as typeof fetch
    });

    await guard.fetch("http://localhost:8004/v1/audio/speech", { method: "POST" });

    expect(dialled).toEqual(["http://127.0.0.1:8004/v1/audio/speech"]);
    // The resolver was consulted exactly once: there is no second window.
    expect(call).toBe(1);
  });

  it("pins an IPv6 loopback answer with brackets", async () => {
    const dialled: string[] = [];
    const guard = createEgressGuard({
      mode: "local",
      trustedHosts: [],
      strictLocal: false,
      resolve: async () => ["::1"],
      fetchImpl: (async (input: string | URL) => {
        dialled.push(new URL(input as URL).href);
        return new Response("ok");
      }) as typeof fetch
    });
    await guard.fetch("http://localhost:8880/health");
    expect(dialled).toEqual(["http://[::1]:8880/health"]);
  });
});

describe("AC-SEC-01 — redirects", () => {
  function redirectingGuard(location: string) {
    const dialled: string[] = [];
    const guard = createEgressGuard({
      mode: "local",
      trustedHosts: [],
      strictLocal: false,
      resolve: async () => ["127.0.0.1"],
      fetchImpl: (async (input: string | URL) => {
        dialled.push(new URL(input as URL).href);
        return new Response(null, { status: 302, headers: { location } });
      }) as typeof fetch
    });
    return { guard, dialled };
  }

  it.each([
    ["absolute cross-host", "http://evil.example/x"],
    ["protocol-relative", "//evil.example/x"],
    ["userinfo smuggling", "http://127.0.0.1@evil.example/x"],
    ["uppercase host", "http://EVIL.EXAMPLE/x"]
  ])("refuses a %s redirect", async (_label, location) => {
    const { guard, dialled } = redirectingGuard(location);
    expect(await denialReason(guard.fetch("http://127.0.0.1:8004/tts"))).toBe("cross-host-redirect");
    // One hop only: the redirect was never followed, so no chain is possible.
    expect(dialled).toHaveLength(1);
  });

  it.each([
    ["file", "file:///etc/passwd"],
    ["data", "data:text/html,<script>x</script>"]
  ])("refuses a redirect to a %s URL", async (_label, location) => {
    const { guard } = redirectingGuard(location);
    expect(await denialReason(guard.fetch("http://127.0.0.1:8004/tts"))).toBe("unsupported-protocol");
  });

  it("allows a same-host relative redirect and never follows it itself", async () => {
    const { guard, dialled } = redirectingGuard("/v2/tts");
    const response = await guard.fetch("http://127.0.0.1:8004/tts");
    expect(response.status).toBe(302);
    expect(dialled).toHaveLength(1);
  });
});

describe("AC-SEC-01 — modes", () => {
  it("strictLocal wins over an explicitly trusted host", async () => {
    const guard = createEgressGuard({
      mode: "trusted",
      trustedHosts: ["api.example.com"],
      strictLocal: true,
      resolve: async () => ["127.0.0.1"]
    });
    expect(await denialReason(guard.assertAllowed(new URL("https://api.example.com/v1")))).toBe("strict-local-mode");
  });

  it("a trusted host still has to use TLS", async () => {
    const guard = createEgressGuard({
      mode: "trusted",
      trustedHosts: ["api.example.com"],
      strictLocal: false,
      resolve: async () => ["127.0.0.1"]
    });
    expect(await denialReason(guard.assertAllowed(new URL("http://api.example.com/v1")))).toBe("tls-required");
  });

  it("never logs a query string, a body or a header", async () => {
    const { guard, events } = localGuard();
    const fetchSpy = vi.fn();
    await guard
      .assertAllowed(new URL("http://localhost:8004/v1/audio/speech?api_key=sk-super-secret-value-1234"))
      .catch(() => undefined);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
    const serialised = JSON.stringify(events[0]);
    expect(serialised).not.toContain("sk-super-secret-value-1234");
    expect(serialised).not.toContain("api_key");
    expect(events[0]?.path).toBe("/v1/audio/speech");
  });
});
