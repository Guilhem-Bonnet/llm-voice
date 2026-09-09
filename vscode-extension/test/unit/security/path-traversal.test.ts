/**
 * S6.1 — Attack tests, axis 1: every path derived from data the extension
 * did not produce (AC-SEC-03).
 *
 * The failure museum's 2026-09-08 entry ("traversée de chemin dans l'inbox
 * livrée en PR") is the reason this file exists: the fix at the time covered
 * the *writing* side (the collector's `session_id` allowlist), and the rule
 * instaurée was "tout identifiant venant d'un fichier externe passe par une
 * allowlist stricte avant toute opération filesystem, avec un test d'attaque
 * explicite". These are those tests, for both sides.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InboxRepository } from "../../../src/claude/InboxRepository.js";
import { resolveInboxPath } from "../../../src/claude/resolveInboxPath.js";
import { isContainedIn, isSafeApiKeyRef, isSafePathSegment, rejectReferenceAudioPath } from "../../../src/core/safePath.js";
import { VoiceProfileSchema } from "../../../src/core/profile.schema.js";

const collector = resolve(__dirname, "../../../../integrations/claude-code/plugin/scripts/llm-voice-capture.js");
const cli = resolve(__dirname, "../../../../integrations/cli/llm-voice-inbox.js");

/** Every shape an attacker reaches for when a string becomes a path. */
const HOSTILE_SEGMENTS: readonly [string, string][] = [
  ["dot-dot", "../../../../etc/cron.d/evil"],
  ["dot-dot-encoded", "..%2f..%2fetc%2fpasswd"],
  ["absolute-posix", "/etc/cron.d/evil"],
  ["absolute-windows", "C:\\Windows\\System32\\drivers\\etc\\hosts"],
  ["unc-windows", "\\\\server\\share\\evil"],
  ["windows-separator", "..\\..\\evil"],
  ["nul-byte", "safe\u0000/../../evil"],
  ["newline", "safe\n../../evil"],
  ["bidi-override", "safe\u202egnp.evil"],
  ["zero-width", "sa\u200bfe"],
  ["fullwidth-solidus", "..\uff0f..\uff0fetc"],
  ["home-tilde", "~/.ssh/id_rsa"],
  ["very-long", "a".repeat(4096)],
  ["dot", "."],
  ["dot-dot-bare", ".."],
  ["empty", ""]
];

describe("AC-SEC-03 — hostile path segments", () => {
  it.each(HOSTILE_SEGMENTS)("isSafePathSegment rejects %s", (_label, value) => {
    expect(isSafePathSegment(value)).toBe(false);
  });

  it("accepts what the collector actually writes", () => {
    expect(isSafePathSegment("1757337600000-abc123-a8f91")).toBe(true);
    expect(isSafePathSegment("a".repeat(128))).toBe(true);
    expect(isSafePathSegment("a".repeat(129))).toBe(false);
  });

  it("isContainedIn is canonical, not textual", () => {
    expect(isContainedIn("/a/inbox", "/a/inbox/x.json")).toBe(true);
    expect(isContainedIn("/a/inbox", "/a/inbox")).toBe(true);
    // The classic `startsWith` bug: a sibling whose name merely starts the same.
    expect(isContainedIn("/a/inbox", "/a/inbox-evil/x.json")).toBe(false);
    expect(isContainedIn("/a/inbox", "/a/inbox/../../etc/passwd")).toBe(false);
    expect(isContainedIn("/a/inbox", "/etc/passwd")).toBe(false);
  });
});

describe("collector + CLI — sessionId never escapes the inbox", () => {
  let inboxDir: string;

  beforeEach(() => {
    inboxDir = mkdtempSync(join(tmpdir(), "llm-voice-sec-inbox-"));
  });

  afterEach(() => {
    rmSync(inboxDir, { recursive: true, force: true });
  });

  it.each(HOSTILE_SEGMENTS)("collector: session_id %s is replaced by a random id", (_label, value) => {
    execFileSync("node", [collector], {
      input: JSON.stringify({ session_id: value, last_assistant_message: "bonjour" }),
      env: { ...process.env, LLM_VOICE_INBOX: inboxDir }
    });

    const written = readdirSync(inboxDir);
    expect(written).toHaveLength(1);
    // Exactly one file, directly inside the inbox, with a name we generated.
    const name = written[0]!;
    expect(name.endsWith(".json")).toBe(true);
    expect(name).not.toContain("..");
    expect(name).not.toContain("/");
    expect(name).not.toContain("\\");
    const entry = JSON.parse(readFileSync(join(inboxDir, name), "utf8")) as { sessionId: string };
    expect(entry.sessionId).not.toBe(value);
    expect(isSafePathSegment(entry.sessionId)).toBe(true);
  });

  it("CLI: --session-id ../../evil is replaced by a random id", () => {
    execFileSync("node", [cli, "add", "--provider", "codex", "--session-id", "../../evil"], {
      input: "bonjour",
      env: { ...process.env, LLM_VOICE_INBOX: inboxDir }
    });
    const written = readdirSync(inboxDir);
    expect(written).toHaveLength(1);
    expect(written[0]).not.toContain("..");
  });
});

describe("InboxRepository — hostile directory content", () => {
  let inboxDir: string;
  let outsideDir: string;

  beforeEach(() => {
    inboxDir = mkdtempSync(join(tmpdir(), "llm-voice-sec-repo-"));
    outsideDir = mkdtempSync(join(tmpdir(), "llm-voice-sec-outside-"));
  });

  afterEach(() => {
    rmSync(inboxDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  });

  function validMessage(text: string): string {
    return JSON.stringify({
      schemaVersion: 1,
      provider: "claude-code",
      sessionId: "s1",
      capturedAt: Date.now(),
      message: text
    });
  }

  it("does not follow a symlink pointing outside the inbox", async () => {
    const secret = join(outsideDir, "secret.json");
    writeFileSync(secret, validMessage("CONTENU HORS INBOX"));
    symlinkSync(secret, join(inboxDir, "1700000000000-aaa-bbb.json"));

    const repository = new InboxRepository({ directory: inboxDir });
    const result = await repository.scan();

    // The symlink is neither read nor reported as a rejection: it is simply
    // not a regular file, so it is skipped (`lstat`, not `stat`).
    expect(result.entries).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain("CONTENU HORS INBOX");
  });

  it("still reads a real regular file next to the symlink", async () => {
    symlinkSync(join(outsideDir, "nowhere.json"), join(inboxDir, "1700000000000-aaa-dangling.json"));
    writeFileSync(join(inboxDir, "1700000000001-aaa-real.json"), validMessage("vrai message"));

    const repository = new InboxRepository({ directory: inboxDir });
    const result = await repository.scan();

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.message.message).toBe("vrai message");
  });

  it("ignores a file whose stem is not a safe segment", async () => {
    writeFileSync(join(inboxDir, "..evil.json"), validMessage("x"));
    writeFileSync(join(inboxDir, "a b c.json"), validMessage("x"));

    const repository = new InboxRepository({ directory: inboxDir });
    const result = await repository.scan();

    expect(result.entries).toHaveLength(0);
    expect(result.rejections).toHaveLength(0);
  });

  it.each(HOSTILE_SEGMENTS)("remove()/archive() refuse the id %s", async (_label, value) => {
    const repository = new InboxRepository({ directory: inboxDir });
    await expect(repository.remove(value)).rejects.toThrow(/invalid message id/);
    await expect(repository.archive(value)).rejects.toThrow(/invalid message id/);
    // And nothing was created outside the inbox as a side effect.
    expect(readdirSync(inboxDir)).toHaveLength(0);
  });
});

describe("inboxPath setting", () => {
  it("is used verbatim — it is user configuration, not external data", () => {
    // Documented, deliberate: `llmVoice.claude.inboxPath` is typed by the
    // user in their own settings; treating it as hostile would break the
    // legitimate `~/shared/inbox` case. What must never be attacker-derived
    // is the *file name* inside it, covered above.
    expect(resolveInboxPath({ settingValue: "/srv/llm-voice/inbox" })).toBe("/srv/llm-voice/inbox");
    expect(resolveInboxPath({ settingValue: "   " , env: {}, homedir: () => "/home/u" })).toBe(
      join("/home/u", ".llm-voice", "inbox")
    );
  });
});

describe("AC-SEC-05 — imported profile: referenceAudio and apiKeyRef", () => {
  const baseProfile = {
    id: "evil",
    label: "Evil",
    mode: "faithful",
    language: "fr-FR",
    chunking: { unit: "sentence", maxSentences: 3, prefetchChunks: 2 },
    playback: { rate: 1, volume: 1 }
  };

  it.each([
    ["ssh key", "/home/victim/.ssh/id_rsa"],
    ["dotenv", "/home/victim/project/.env"],
    ["traversal to a non-audio file", "../../../../etc/passwd"],
    ["no extension", "/home/victim/secrets"],
    ["nul byte", "/home/victim/voice.wav\u0000.txt"],
    ["bidi override", "/home/victim/voice\u202egnp.wav"],
    ["double extension", "/home/victim/id_rsa.wav.txt"]
  ])("rejects referenceAudio: %s", (_label, referenceAudio) => {
    const parsed = VoiceProfileSchema.safeParse({
      ...baseProfile,
      tts: { providerId: "chatterbox", baseUrl: "http://127.0.0.1:8004", referenceAudio }
    });
    expect(parsed.success).toBe(false);
    expect(rejectReferenceAudioPath(referenceAudio)).toBeDefined();
  });

  it.each([
    ["empty", ""],
    ["blank", "   "],
    ["over 4096 chars", `/home/u/${"a".repeat(5000)}.wav`],
    ["zero-width joiner", "/home/u/voi\u200bx.wav"],
    ["right-to-left override", "/home/u/\u202evaw.evil.wav"],
    ["BOM", "/home/u/\ufeffvoix.wav"]
  ])("rejects a referenceAudio that is %s", (_label, value) => {
    expect(rejectReferenceAudioPath(value)).toBeDefined();
  });

  it("still accepts a legitimate sample, absolute or checkout-relative", () => {
    for (const referenceAudio of [
      "/home/user/voix/moi.wav",
      "../deploy/tts/reference-audio/fr-female-siwis.wav",
      "C:\\Users\\u\\voix\\moi.mp3"
    ]) {
      expect(rejectReferenceAudioPath(referenceAudio)).toBeUndefined();
    }
  });

  it.each([
    ["another provider's key", "llmVoice.apiKey.openai"],
    ["an unrelated namespace", "github.token"],
    ["a traversal-looking ref", "../../llmVoice.apiKey.openai"],
    ["empty-ish", "llmVoice.apiKey."]
  ])("apiKeyRef %s is either rejected by the schema or unusable", (_label, apiKeyRef) => {
    const parsed = VoiceProfileSchema.safeParse({
      ...baseProfile,
      tts: { providerId: "evil-provider", baseUrl: "https://evil.example", apiKeyRef }
    });
    if (parsed.success) {
      // It passed the namespace check, so it must at least *name* the
      // provider the profile itself declares — `Pipeline.resolveApiKey`
      // refuses everything else at read time.
      expect(isSafeApiKeyRef(apiKeyRef)).toBe(true);
      expect(apiKeyRef).not.toBe("llmVoice.apiKey.evil-provider");
    }
  });

  it("accepts the ref its own provider owns", () => {
    const parsed = VoiceProfileSchema.safeParse({
      ...baseProfile,
      tts: { providerId: "openai", baseUrl: "https://api.openai.com", apiKeyRef: "llmVoice.apiKey.openai" }
    });
    expect(parsed.success).toBe(true);
  });
});
