/**
 * S6.1 — Attack tests, axis 4: secrets and the journal (AC-SEC-07,
 * AC-SEC-08, CdC §81).
 *
 * The rule is "no API key reaches the Output Channel, whatever the level".
 * `debug` is the interesting level: it adds fields, it must not remove
 * redaction. Every case below is run at `debug`.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { redactSecretPatterns, redactSecrets } from "../../../src/core/redact.js";
import { Logger, type LogSink } from "../../../src/infrastructure/logger.js";

const KEY = "sk-proj-Ab3xQ9ZmN7pLk2Rt5VwY8HdC1EfG4JiO";

function debugLogger() {
  const lines: string[] = [];
  const sink: LogSink = { appendLine: (value) => lines.push(value) };
  return { logger: new Logger(sink, "debug"), lines };
}

describe("AC-SEC-07 — a key that was never registered", () => {
  it.each([
    ["in a baseUrl's userinfo segment", `TTS unreachable: connect ECONNREFUSED https://svc:${KEY}@api.example.com/v1`],
    ["as a bare userinfo segment", `fetch failed for https://${KEY}@api.example.com/v1/audio/speech`],
    ["in an Authorization header dump", `upstream said: {"authorization":"Bearer ${KEY}"}`],
    ["in a query string", `HTTP 401 from https://api.example.com/v1/models?api_key=${KEY}`],
    ["in a snake_case field", `provider error: {"access_token": "${KEY}", "code": 401}`],
    ["as a bare vendor-prefixed key", `Provider rejected key ${KEY}`],
    ["inside an uncaught exception message", `Error: invalid_api_key: ${KEY} is revoked`]
  ])("is redacted %s", (_label, message) => {
    const { logger, lines } = debugLogger();
    logger.debug(message);

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(KEY);
    expect(lines[0]).toContain("[REDACTED]");
  });

  it("keeps the line diagnosable — the host and the scheme survive", () => {
    const { logger, lines } = debugLogger();
    logger.debug(`HTTP 401 from https://svc:${KEY}@api.example.com/v1/models`);
    expect(lines[0]).toContain("api.example.com");
    expect(lines[0]).toContain("401");
  });

  it("does not eat an ordinary word that merely looks like a token", () => {
    expect(redactSecretPatterns("segmentation terminee, 42 chunks")).toBe("segmentation terminee, 42 chunks");
    expect(redactSecretPatterns("http://127.0.0.1:8004/v1/audio/speech")).toBe(
      "http://127.0.0.1:8004/v1/audio/speech"
    );
  });
});

describe("AC-SEC-07 — a key that was registered", () => {
  it("disappears from the message, from meta, and from an Error", () => {
    const { logger, lines } = debugLogger();
    logger.trackSecret(KEY);

    logger.debug(`raw ${KEY}`, { note: `also ${KEY}`, nested: { deep: KEY } });
    logger.error("provider failed", { cause: new Error(`boom ${KEY}`) });

    expect(lines.join("\n")).not.toContain(KEY);
    expect(lines[0]).toContain("[REDACTED]");
  });

  it("never treats an empty string as 'redact everything'", () => {
    const { logger, lines } = debugLogger();
    logger.trackSecret("");
    logger.debug("hello");
    expect(lines[0]).toContain("hello");
    expect(redactSecrets("hello", [""])).toBe("hello");
  });
});

describe("AC-SEC-07 — banned fields never reach the channel", () => {
  it.each([
    "apiKey",
    "api_key",
    "authorization",
    "text",
    "spokenText",
    "rawText",
    "message",
    "prompt",
    "body",
    "audio",
    "data"
  ])("drops the field %s at debug level", (field) => {
    const { logger, lines } = debugLogger();
    logger.debug("pipeline step", { [field]: "MARQUEUR-SECRET-42", providerId: "chatterbox" });
    expect(lines[0]).not.toContain("MARQUEUR-SECRET-42");
    expect(lines[0]).toContain("chatterbox");
  });

  it("truncates a long remaining field rather than dumping a document", () => {
    const { logger, lines } = debugLogger();
    logger.debug("segment", { title: "x".repeat(5000) });
    expect(lines[0]!.length).toBeLessThan(400);
    expect(lines[0]).toContain("truncated");
  });
});

describe("AC-SEC-08 — no key on any persistent surface", () => {
  const sources = ["src/pipeline/Pipeline.ts", "src/profiles/remoteProviders.ts", "src/commands/index.ts"].map(
    (relative) => readFileSync(resolve(__dirname, "../../../", relative), "utf8")
  );

  it("stores keys only in SecretStorage, never in globalState/workspaceState", () => {
    for (const source of sources) {
      // No `globalState.update(...apiKey...)` anywhere.
      expect(source).not.toMatch(/(global|workspace)State\.update\([^)]*[Aa]pi[Kk]ey/);
      expect(source).not.toMatch(/(global|workspace)State\.get<[^>]*>\([^)]*[Aa]pi[Kk]ey/);
    }
  });

  it("never writes a key into the audio cache or a profile", () => {
    const diskCache = readFileSync(resolve(__dirname, "../../../src/playback/DiskAudioCache.ts"), "utf8");
    expect(diskCache).not.toMatch(/[Aa]pi[Kk]ey/);
    const profileSchema = readFileSync(resolve(__dirname, "../../../src/core/profile.schema.ts"), "utf8");
    // A profile may carry a *reference* to a key, never a value: no field
    // called `apiKey` exists in the schema at all.
    expect(profileSchema).not.toMatch(/^\s*apiKey:/m);
  });

  it("keeps the sidecar metadata free of anything but derived facts", () => {
    const diskCache = readFileSync(resolve(__dirname, "../../../src/playback/DiskAudioCache.ts"), "utf8");
    const sidecar = /interface SidecarMeta \{([\s\S]*?)\}/.exec(diskCache)?.[1] ?? "";
    expect(sidecar).toContain("createdAt");
    for (const forbidden of ["text", "prompt", "apiKey", "baseUrl", "message"]) {
      expect(sidecar).not.toContain(forbidden);
    }
  });
});

describe("AC-SEC-07 — provider errors carry a host, not a baseUrl", () => {
  it.each(["src/tts/OpenAICompatibleTtsProvider.ts", "src/tts/ChatterboxProvider.ts"])(
    "%s never interpolates this.baseUrl into a thrown message",
    (relative) => {
      const source = readFileSync(resolve(__dirname, "../../../", relative), "utf8");
      const throwsWithBaseUrl = /throw new Error\([^;]*\$\{this\.baseUrl\}/.test(source);
      expect(throwsWithBaseUrl).toBe(false);
      expect(source).toContain("endpointLabel(");
    }
  );

  it("endpointLabel keeps only the host and the path", async () => {
    const { OpenAICompatibleTtsProvider } = await import("../../../src/tts/OpenAICompatibleTtsProvider.js");
    class Probe extends OpenAICompatibleTtsProvider {
      label(path: string): string {
        return this.endpointLabel(path);
      }
    }
    const probe = new Probe({
      baseUrl: `https://svc:${KEY}@api.example.com/v1?token=${KEY}`,
      egress: { assertAllowed: async () => undefined, fetch: async () => new Response(), classify: () => "remote" }
    });
    const label = probe.label("/v1/audio/speech");
    expect(label).toBe("api.example.com/v1/audio/speech");
    expect(label).not.toContain(KEY);
  });
});
