/**
 * S5.1 vertical slice, AC-12..15 — Claude Code / open inbox, run under the
 * `fake-tts` profile (`LLM_VOICE_TEST_FAKE_TTS=1`, `LLM_VOICE_INBOX` set to a
 * throwaway tmpdir by `.vscode-test.mjs`). `listInboxEntriesForTest()` does a
 * real disk scan — the same one `openInbox()`/the Tree View do (no index,
 * ADR-004) — so these assertions do not depend on `InboxWatcher`'s timing.
 */
import * as assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import type { ExtensionTestApi } from "../../src/extension.js";
import type { FakeTtsProvider } from "../fakes/FakeTtsProvider.js";
import type { InboxEntry } from "../../src/core/inbox.js";

interface TestPipeline {
  listInboxEntriesForTest(): Promise<readonly InboxEntry[]>;
  getCurrentProfileLabelForTest(): string;
  getPlaybackState(): string;
  speakLatestClaudeResponse(): Promise<void>;
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 25
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) {
      throw new Error("waitFor: condition not met before timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function activateExtension(): Promise<{ api: ExtensionTestApi; pipeline: TestPipeline }> {
  const extension = vscode.extensions.getExtension("guilhem-bonnet.llm-voice");
  assert.ok(extension, "extension should be discoverable by id");
  const api = (await extension?.activate()) as ExtensionTestApi;
  assert.ok(api.ttsProvider, "LLM_VOICE_TEST_FAKE_TTS=1 should inject a FakeTtsProvider");
  return { api, pipeline: api.pipeline as unknown as TestPipeline };
}

function inboxDir(): string {
  const fromEnv = process.env.LLM_VOICE_INBOX;
  assert.ok(fromEnv, "LLM_VOICE_INBOX should be set by .vscode-test.mjs for this profile");
  return fromEnv;
}

let counter = 0;

function depositMessage(overrides: Record<string, unknown> = {}): string {
  counter += 1;
  const capturedAt = Date.now();
  const sessionId = `inbox-test-${process.pid}-${counter}`;
  const fileName = `${capturedAt}-${sessionId}-${counter}.json`;
  const fullPath = join(inboxDir(), fileName);
  writeFileSync(
    fullPath,
    JSON.stringify({
      schemaVersion: 1,
      provider: "claude-code",
      sessionId,
      capturedAt,
      cwd: "/home/user/backend-api",
      message: `Message de test n°${counter}.`,
      ...overrides
    })
  );
  return fullPath;
}

async function waitForEntryContaining(pipeline: TestPipeline, message: string): Promise<void> {
  await waitFor(async () => {
    const entries = await pipeline.listInboxEntriesForTest();
    return entries.some((entry) => entry.message.message === message);
  });
}

suite("LLM Voice inbox (S5.1, AC-12..15)", () => {
  const writtenPaths: string[] = [];

  teardown(() => {
    for (const path of writtenPaths.splice(0)) {
      rmSync(path, { force: true });
    }
  });

  test("AC-12: depositing a file makes it appear in a fresh inbox scan", async () => {
    const { pipeline } = await activateExtension();
    const path = depositMessage({ message: "AC-12: réponse capturée." });
    writtenPaths.push(path);

    await waitForEntryContaining(pipeline, "AC-12: réponse capturée.");
  });

  test("AC-13: 4 concurrent deposits -> 4 entries, 0 additional TTS calls", async () => {
    const { api, pipeline } = await activateExtension();
    const tts = api.ttsProvider as FakeTtsProvider;
    const before = tts.requests.length;
    const marker = `ac13-${Date.now()}`;

    const paths = Array.from({ length: 4 }, (_, i) =>
      depositMessage({ sessionId: `${marker}-${i}`, message: `${marker} #${i}` })
    );
    writtenPaths.push(...paths);

    await waitFor(async () => {
      const entries = await pipeline.listInboxEntriesForTest();
      return entries.filter((entry) => entry.message.sessionId.startsWith(marker)).length === 4;
    });

    assert.equal(tts.requests.length, before, "depositing inbox files must never call the TTS provider");
  });

  test("AC-14: 10 concurrent deposits -> 10 entries, 0 additional TTS calls", async () => {
    const { api, pipeline } = await activateExtension();
    const tts = api.ttsProvider as FakeTtsProvider;
    const before = tts.requests.length;
    const marker = `ac14-${Date.now()}`;

    const paths = Array.from({ length: 10 }, (_, i) =>
      depositMessage({ sessionId: `${marker}-${i}`, message: `${marker} #${i}` })
    );
    writtenPaths.push(...paths);

    await waitFor(async () => {
      const entries = await pipeline.listInboxEntriesForTest();
      return entries.filter((entry) => entry.message.sessionId.startsWith(marker)).length === 10;
    });

    assert.equal(tts.requests.length, before, "depositing inbox files must never call the TTS provider");
  });

  test("AC-15: speakLatestClaudeResponse starts the pipeline with the source's default profile", async () => {
    const { pipeline } = await activateExtension();
    const path = depositMessage({ message: "AC-15: dernier message Claude." });
    writtenPaths.push(path);

    await waitForEntryContaining(pipeline, "AC-15: dernier message Claude.");

    await pipeline.speakLatestClaudeResponse();

    await waitFor(() => pipeline.getPlaybackState() === "playing");
    assert.equal(pipeline.getCurrentProfileLabelForTest(), "Résumé LLM");
  });
});
