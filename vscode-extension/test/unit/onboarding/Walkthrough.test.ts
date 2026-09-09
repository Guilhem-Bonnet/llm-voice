/**
 * S7.2: the walkthrough must auto-open exactly once, ever — never under
 * `ExtensionMode.Test`. `shouldOpenWalkthroughOnActivation` is the pure
 * decision `openWalkthroughOnFirstActivation` (`Walkthrough.ts`) wraps
 * around `context.globalState`/`context.extensionMode`, factored out so
 * the "once, never again" flag logic is plain-Node testable.
 */
import { describe, expect, it } from "vitest";
import { shouldOpenWalkthroughOnActivation } from "../../../src/onboarding/shouldOpenWalkthrough.js";

describe("shouldOpenWalkthroughOnActivation", () => {
  it("opens on a genuine first activation (not test mode, globalState flag unset)", () => {
    expect(shouldOpenWalkthroughOnActivation({ isTestMode: false, alreadyShown: false })).toBe(true);
  });

  it("never opens again once the globalState flag is set (S7.2's 'once, ever')", () => {
    expect(shouldOpenWalkthroughOnActivation({ isTestMode: false, alreadyShown: true })).toBe(false);
  });

  it("never opens under ExtensionMode.Test, flag unset or not (would hang/steal focus in the xvfb integration suite)", () => {
    expect(shouldOpenWalkthroughOnActivation({ isTestMode: true, alreadyShown: false })).toBe(false);
    expect(shouldOpenWalkthroughOnActivation({ isTestMode: true, alreadyShown: true })).toBe(false);
  });
});
