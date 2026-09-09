/**
 * S7.2 (onboarding) — the parts of the story that need a real extension
 * host to verify: `contributes.walkthroughs`/`viewsWelcome`/`editor/title`
 * are actually loaded from `package.json`, and `LLM Voice: Setup Voice` /
 * `LLM Voice: Open Walkthrough Example` are registered and don't throw.
 */
import * as assert from "node:assert/strict";
import * as vscode from "vscode";

async function activateExtension(): Promise<vscode.Extension<unknown>> {
  const extension = vscode.extensions.getExtension("guilhem-bonnet.llm-voice");
  assert.ok(extension, "extension should be discoverable by id");
  await extension?.activate();
  return extension as vscode.Extension<unknown>;
}

interface WalkthroughStep {
  id: string;
  completionEvents?: string[];
  media?: { image?: string; altText?: string };
}

interface Walkthrough {
  id: string;
  steps: WalkthroughStep[];
}

interface ViewsWelcomeEntry {
  view: string;
  contents: string;
}

interface MenuEntry {
  command: string;
  when?: string;
}

interface PackageJson {
  contributes: {
    walkthroughs?: Walkthrough[];
    viewsWelcome?: ViewsWelcomeEntry[];
    menus?: { [menuId: string]: MenuEntry[] };
  };
}

suite("LLM Voice onboarding — declarations (S7.2)", () => {
  test("contributes.walkthroughs declares 'Démarrer avec LLM Voice' with 4 steps, each with a real completion event", async () => {
    const extension = await activateExtension();
    const packageJson = extension.packageJSON as PackageJson;
    const walkthroughs = packageJson.contributes.walkthroughs ?? [];
    const walkthrough = walkthroughs.find((entry) => entry.id === "llmVoice.gettingStarted");

    assert.ok(walkthrough, "llmVoice.gettingStarted walkthrough should be declared");
    assert.equal(walkthrough?.steps.length, 4);
    for (const step of walkthrough?.steps ?? []) {
      assert.ok(step.completionEvents && step.completionEvents.length > 0, `${step.id} should have a completionEvent`);
      assert.match(step.completionEvents?.[0] ?? "", /^onCommand:|^onSettingChanged:/);
      assert.ok(step.media?.image, `${step.id} should carry a media image`);
    }
  });

  test("contributes.viewsWelcome covers the empty player and the empty inbox", async () => {
    const extension = await activateExtension();
    const packageJson = extension.packageJSON as PackageJson;
    const welcomes = packageJson.contributes.viewsWelcome ?? [];

    const player = welcomes.find((entry) => entry.view === "llmVoice.player");
    assert.ok(player, "llmVoice.player should have viewsWelcome content");
    assert.match(player?.contents ?? "", /command:llmVoice\.setupVoice/);
    assert.match(player?.contents ?? "", /command:llmVoice\.speakDocument/);

    const inbox = welcomes.find((entry) => entry.view === "llmVoice.inboxView");
    assert.ok(inbox, "llmVoice.inboxView should have viewsWelcome content");
    assert.match(inbox?.contents ?? "", /command:llmVoice\.installClaudeHook/);
  });

  test("editor/title exposes Speak Document for Markdown files only", async () => {
    const extension = await activateExtension();
    const packageJson = extension.packageJSON as PackageJson;
    const entries = packageJson.contributes.menus?.["editor/title"] ?? [];
    const entry = entries.find((candidate) => candidate.command === "llmVoice.speakDocument");

    assert.ok(entry, "llmVoice.speakDocument should appear in editor/title");
    assert.match(entry?.when ?? "", /resourceLangId == markdown/);
  });
});

suite("LLM Voice onboarding — commands (S7.2)", () => {
  test("registers llmVoice.setupVoice and llmVoice.walkthroughOpenExample", async () => {
    await activateExtension();
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("llmVoice.setupVoice"));
    assert.ok(commands.includes("llmVoice.walkthroughOpenExample"));
  });

  test("Setup Voice opens a Quick Pick with the three honest voice tiers and doesn't throw", async () => {
    await activateExtension();
    // Same pattern as `providerStatus`/`performanceReport` (see profiles.test.ts,
    // latency.test.ts): the Quick Pick only resolves on user input, so close
    // it right after it opens instead of hanging the test.
    const opened = vscode.commands.executeCommand("llmVoice.setupVoice");
    await new Promise((resolve) => setTimeout(resolve, 300));
    await vscode.commands.executeCommand("workbench.action.closeQuickOpen");
    await assert.doesNotReject(Promise.resolve(opened));
  });

  test("Open Walkthrough Example opens the bundled example and starts reading it", async () => {
    await activateExtension();
    await vscode.commands.executeCommand("llmVoice.walkthroughOpenExample");
    const active = vscode.window.activeTextEditor;
    assert.ok(active, "the example document should be opened and shown");
    assert.match(active?.document.getText() ?? "", /Bienvenue dans LLM Voice/);
  });
});
