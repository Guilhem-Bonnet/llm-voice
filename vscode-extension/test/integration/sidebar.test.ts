/**
 * S9 — the dedicated `llmVoice` activity bar container (ADR-011 revision
 * 2026-09-12: `llmVoice.ui.layout` defaults to `"full"`). Covers what only a
 * real extension host can prove: the container/views declared in
 * `package.json` are actually what VS Code registers, the "Profils" Tree
 * View lists the real `profiles.json` content and marks the active one, and
 * the inbox unread badge (`Pipeline.refreshInbox`) updates from a real disk
 * scan — same fixtures/pattern as `test/integration/inbox.test.ts`.
 */
import * as assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import type { ExtensionTestApi } from "../../src/extension.js";
import type { InboxEntry } from "../../src/core/inbox.js";

interface TestPipeline {
  listInboxEntriesForTest(): Promise<readonly InboxEntry[]>;
  getInboxBadgeForTest(): { value: number; tooltip: string } | undefined;
}

interface ViewDescriptor {
  id: string;
  name?: string;
  type?: string;
  when?: string;
}

interface ViewContainerDescriptor {
  id: string;
  title?: string;
  icon?: string;
}

interface PackageJson {
  contributes: {
    viewsContainers?: { activitybar?: ViewContainerDescriptor[]; panel?: ViewContainerDescriptor[] };
    views?: Record<string, ViewDescriptor[]>;
  };
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
  const sessionId = `sidebar-test-${process.pid}-${counter}`;
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

suite("LLM Voice dedicated sidebar (S9, ADR-011 revision 2026-09-12)", () => {
  test("package.json declares the llmVoice activity bar container with the 3 dedicated views, in order", async () => {
    const extension = vscode.extensions.getExtension("guilhem-bonnet.llm-voice");
    assert.ok(extension);
    const packageJson = extension?.packageJSON as PackageJson;

    const container = packageJson.contributes.viewsContainers?.activitybar?.find((c) => c.id === "llmVoice");
    assert.ok(container, "an activitybar container 'llmVoice' should be declared");
    assert.match(container?.icon ?? "", /activity-icon\.svg$/);

    const views = packageJson.contributes.views?.["llmVoice"] ?? [];
    assert.deepEqual(
      views.map((view) => view.id),
      ["llmVoice.playerView", "llmVoice.inboxView", "llmVoice.profilesView"],
      "Lecture en cours, Inbox, Profils, in that order (CdC §6)"
    );
    assert.equal(views[0]?.type, "webview", "the player row is the same webview view type as the Panel one");
  });

  test("every view of the llmVoice container is registered and resolvable/listable", async () => {
    await activateExtension();

    // A Tree View command exists (`<viewId>.focus`) only for a view VS Code
    // actually registered — this fails fast if `llmVoice.profilesView` or
    // `llmVoice.inboxView` were only declared in package.json but never
    // wired to a provider.
    const commands = await vscode.commands.getCommands(true);
    for (const viewId of ["llmVoice.playerView", "llmVoice.inboxView", "llmVoice.profilesView"]) {
      assert.ok(commands.includes(`${viewId}.focus`), `${viewId}.focus should be a registered command`);
    }
  });

  test("llmVoice.ui.layout defaults to 'full' (ADR-011 revision: the dedicated container is now the default)", async () => {
    await activateExtension();
    const value = vscode.workspace.getConfiguration("llmVoice").get<string>("ui.layout");
    assert.equal(value, "full");
  });

  test("the Profils tree lists profiles.json and marks exactly one as active", async () => {
    const { api } = await activateExtension();

    await api.profilesTree.refresh();
    const items = api.profilesTree.currentItems;

    // Not "== the 5 shipped defaults": this suite shares one `--user-data-dir`
    // with every other file in the `fake-tts` profile (`profiles.test.ts`,
    // `voiceBrowserAndProfileEditor.test.ts`…), some of which duplicate/
    // delete/rename profiles as part of their own assertions — so only the
    // structural invariants `ProfileRepository` itself guarantees are safe
    // to assert on here (at least one profile always exists, `getSelected()`
    // always resolves to exactly one of them).
    assert.ok(items.length >= 1, "profiles.json should never be empty (ProfileRepository's own invariant)");
    const activeItems = items.filter((item) => item.isActive);
    assert.equal(activeItems.length, 1, "exactly one profile should be marked active");
    assert.equal(activeItems[0]?.icon, "check");
    assert.ok(
      items.every((item) => item.label.length > 0),
      "every row should carry a non-empty label"
    );
  });

  test("activating a different profile from the tree updates which one is marked active", async () => {
    const { api } = await activateExtension();
    await api.profilesTree.refresh();
    const before = api.profilesTree.currentItems;
    const originalActiveId = before.find((item) => item.isActive)?.id;
    const target = before.find((item) => !item.isActive);
    assert.ok(target, "at least one non-active profile should exist to switch to");
    assert.ok(originalActiveId, "exactly one profile should have been active before this test");

    try {
      await vscode.commands.executeCommand("llmVoice.profilesView.activate", { id: target?.id });

      await waitFor(() => api.profilesTree.currentItems.find((item) => item.id === target?.id)?.isActive === true);
      const activeItems = api.profilesTree.currentItems.filter((item) => item.isActive);
      assert.equal(activeItems.length, 1);
      assert.equal(activeItems[0]?.id, target?.id);
    } finally {
      // Restores the original selection (same hygiene as
      // `profiles.test.ts` deleting what it duplicates/imports) — other
      // integration files sharing this `--user-data-dir` must not see a
      // different "current profile" because this test ran first.
      await vscode.commands.executeCommand("llmVoice.profilesView.activate", { id: originalActiveId });
    }
  });

  test("the inbox unread badge appears after a deposit and matches the unread count", async () => {
    const { pipeline } = await activateExtension();
    const path = depositMessage({ message: "S9: badge non lu." });

    try {
      await waitFor(async () => {
        const entries = await pipeline.listInboxEntriesForTest();
        return entries.some((entry) => entry.message.message === "S9: badge non lu." && !entry.read);
      });
      await waitFor(() => (pipeline.getInboxBadgeForTest()?.value ?? 0) > 0);

      const entries = await pipeline.listInboxEntriesForTest();
      const expectedUnread = entries.filter((entry) => !entry.read).length;
      assert.equal(pipeline.getInboxBadgeForTest()?.value, expectedUnread);
    } finally {
      rmSync(path, { force: true });
    }
  });
});
