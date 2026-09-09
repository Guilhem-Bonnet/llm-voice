/**
 * Wiring for `contributes.walkthroughs` (`llmVoice.gettingStarted`, S7.2):
 * the "open the shipped example and read it" helper button, and the
 * one-time auto-open on first activation.
 */

import * as vscode from "vscode";

const WALKTHROUGH_ID = "llmVoice.gettingStarted";
/** `globalState` flag: the walkthrough opens automatically once, ever — never again after that. */
const WALKTHROUGH_SHOWN_KEY = "llmVoice.onboarding.walkthroughShown";

function fullWalkthroughId(context: vscode.ExtensionContext): string {
  return `${context.extension.id}#${WALKTHROUGH_ID}`;
}

/**
 * Registered as `llmVoice.walkthroughOpenExample`: opens the bundled
 * `media/walkthrough/exemple.md` and starts reading it, so the walkthrough's
 * "Lire un document" step has something to read without requiring the user
 * to already have a Markdown file open (S7.2 step 2).
 */
export async function openWalkthroughExample(context: vscode.ExtensionContext): Promise<void> {
  const exampleUri = vscode.Uri.joinPath(context.extensionUri, "media", "walkthrough", "exemple.md");
  const document = await vscode.workspace.openTextDocument(exampleUri);
  await vscode.window.showTextDocument(document, { preview: false });
  await vscode.commands.executeCommand("llmVoice.speakDocument");
}

/**
 * Opens `llmVoice.gettingStarted` automatically, but only the very first
 * time the extension ever activates (`globalState`, never reset) — and
 * never under `vscode-test` (`ExtensionMode.Test`), so it cannot steal
 * focus or hang any of the existing xvfb integration suite.
 */
export async function openWalkthroughOnFirstActivation(context: vscode.ExtensionContext): Promise<void> {
  if (context.extensionMode === vscode.ExtensionMode.Test) {
    return;
  }
  if (context.globalState.get<boolean>(WALKTHROUGH_SHOWN_KEY, false)) {
    return;
  }
  await context.globalState.update(WALKTHROUGH_SHOWN_KEY, true);
  try {
    await vscode.commands.executeCommand(
      "workbench.action.openWalkthrough",
      fullWalkthroughId(context),
      false
    );
  } catch {
    // Best-effort (CdC §52-style: onboarding must never block activation).
  }
}
