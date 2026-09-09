/**
 * The one-time-ever decision behind `openWalkthroughOnFirstActivation`
 * (`Walkthrough.ts`), in its own `vscode`-free module — not just
 * `import type`, a real module boundary — so it is unit-testable in plain
 * Node under vitest (which loads the *runtime* JS: a file that still has
 * a top-level `import * as vscode from "vscode"`, even unused by this
 * function, fails to load outside the extension host). Same idea as
 * `src/ui/notifications.ts`/`handleVoiceTier.ts`.
 *
 * Never opens under `ExtensionMode.Test` (would steal focus/hang the xvfb
 * integration suite), and never opens a second time once `globalState`
 * already recorded a first activation.
 */
export function shouldOpenWalkthroughOnActivation(inputs: { isTestMode: boolean; alreadyShown: boolean }): boolean {
  return !inputs.isTestMode && !inputs.alreadyShown;
}
