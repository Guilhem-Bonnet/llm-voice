import { afterEach, describe, expect, it, vi } from "vitest";
import { createEgressGuard, EgressDeniedError, type EgressLogEvent } from "../../../src/net/EgressGuard.js";
import { MockTtsServer } from "../../fakes/mockTtsServer.js";

describe("EgressGuard.assertAllowed", () => {
  it("allows loopback destinations in local mode", async () => {
    const guard = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
    await expect(guard.assertAllowed(new URL("http://127.0.0.1:8004/health"))).resolves.toBeUndefined();
    await expect(guard.assertAllowed(new URL("http://localhost:8004/health"))).resolves.toBeUndefined();
  });

  it("refuses a plain remote host in local mode", async () => {
    const guard = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
    await expect(guard.assertAllowed(new URL("http://example.com/v1/audio/speech"))).rejects.toThrow(
      EgressDeniedError
    );
    try {
      await guard.assertAllowed(new URL("http://example.com/v1/audio/speech"));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EgressDeniedError);
      expect((error as EgressDeniedError).reason).toBe("not-loopback");
      expect((error as EgressDeniedError).host).toBe("example.com");
    }
  });

  it("refuses a hostname that looks local but resolves off loopback (DNS rebinding)", async () => {
    const resolve = vi.fn(async () => ["203.0.113.5"]);
    const guard = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false, resolve });

    await expect(guard.assertAllowed(new URL("http://localhost/v1/audio/speech"))).rejects.toThrow(
      EgressDeniedError
    );
    expect(resolve).toHaveBeenCalledWith("localhost");
    try {
      await guard.assertAllowed(new URL("http://localhost/v1/audio/speech"));
      expect.unreachable();
    } catch (error) {
      expect((error as EgressDeniedError).reason).toBe("dns-rebinding");
      expect((error as EgressDeniedError).resolvedIps).toEqual(["203.0.113.5"]);
    }
  });

  it("never trusts a hostname merely containing 'localhost'", async () => {
    const guard = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
    await expect(guard.assertAllowed(new URL("http://localhost.evil/v1/audio/speech"))).rejects.toThrow(
      EgressDeniedError
    );
  });

  it("allows a trusted host over https, refuses it over http", async () => {
    const guard = createEgressGuard({
      mode: "trusted",
      trustedHosts: ["api.example.com"],
      strictLocal: false
    });

    await expect(guard.assertAllowed(new URL("https://api.example.com/v1"))).resolves.toBeUndefined();

    try {
      await guard.assertAllowed(new URL("http://api.example.com/v1"));
      expect.unreachable();
    } catch (error) {
      expect((error as EgressDeniedError).reason).toBe("tls-required");
    }
  });

  it("refuses a host outside trustedHosts in trusted mode", async () => {
    const guard = createEgressGuard({ mode: "trusted", trustedHosts: ["api.example.com"], strictLocal: false });
    try {
      await guard.assertAllowed(new URL("https://not-trusted.example.com/v1"));
      expect.unreachable();
    } catch (error) {
      expect((error as EgressDeniedError).reason).toBe("untrusted-host");
    }
  });

  it("strictLocal forces local mode and ignores trustedHosts", async () => {
    const guard = createEgressGuard({
      mode: "trusted",
      trustedHosts: ["api.example.com"],
      strictLocal: true
    });

    try {
      await guard.assertAllowed(new URL("https://api.example.com/v1"));
      expect.unreachable();
    } catch (error) {
      expect((error as EgressDeniedError).reason).toBe("strict-local-mode");
    }

    await expect(guard.assertAllowed(new URL("http://127.0.0.1:8004/health"))).resolves.toBeUndefined();
  });
});

describe("EgressGuard.fetch against a real HTTP server", () => {
  let server: MockTtsServer;

  afterEach(async () => {
    await server.close();
  });

  it("refuses a 302 redirect that changes host, even to another loopback-looking name", async () => {
    server = new MockTtsServer({ redirectExternal: true });
    const baseUrl = await server.listen();
    const guard = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });

    await expect(
      guard.fetch(`${baseUrl}/v1/audio/speech`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Bonjour" })
      })
    ).rejects.toThrow(EgressDeniedError);
  });

  it("passes through a real 500 response without interference", async () => {
    server = new MockTtsServer({ fail500: true });
    const baseUrl = await server.listen();
    const guard = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });

    const response = await guard.fetch(`${baseUrl}/v1/audio/speech`, {
      method: "POST",
      body: JSON.stringify({ text: "test" })
    });
    expect(response.status).toBe(500);
  });

  it("propagates an aborted signal", async () => {
    server = new MockTtsServer();
    const baseUrl = await server.listen();
    const guard = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });

    const controller = new AbortController();
    controller.abort();

    await expect(
      guard.fetch(`${baseUrl}/health`, { signal: controller.signal })
    ).rejects.toThrow();
  });

  it("never logs the request body or headers", async () => {
    server = new MockTtsServer();
    const baseUrl = await server.listen();
    const events: EgressLogEvent[] = [];
    const guard = createEgressGuard({
      mode: "local",
      trustedHosts: [],
      strictLocal: false,
      logger: (event) => events.push(event)
    });

    await guard.fetch(`${baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer super-secret" },
      body: JSON.stringify({ text: "ne doit jamais apparaitre dans le journal" })
    });

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(Object.keys(event).sort()).toEqual(["decision", "host", "method", "path"].sort());
      const serialized = JSON.stringify(event);
      expect(serialized).not.toContain("super-secret");
      expect(serialized).not.toContain("ne doit jamais apparaitre");
      expect(serialized).not.toContain("authorization");
    }
  });
});

describe("EgressGuard.classify", () => {
  it("is a lexical, no-DNS classification", () => {
    const guard = createEgressGuard({ mode: "trusted", trustedHosts: ["api.example.com"], strictLocal: false });
    expect(guard.classify(new URL("http://127.0.0.1:8004"))).toBe("loopback");
    expect(guard.classify(new URL("http://localhost:8004"))).toBe("loopback");
    expect(guard.classify(new URL("https://api.example.com"))).toBe("trusted");
    expect(guard.classify(new URL("https://example.com"))).toBe("remote");
    // Never fooled by a name that merely contains "localhost".
    expect(guard.classify(new URL("http://localhost.evil"))).toBe("remote");
  });
});
