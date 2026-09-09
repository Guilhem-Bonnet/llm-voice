/**
 * S7.2's three Setup Voice branches, plain-Node testable because
 * `handleVoiceTier` takes every `vscode` call as an injected
 * `VoiceTierActions` (see that file's header) — no `vscode` import needed
 * here at all.
 */
import { describe, expect, it, vi } from "vitest";
import { handleVoiceTier, type VoiceTierActions } from "../../../src/onboarding/handleVoiceTier.js";
import {
  CHATTERBOX_COMPOSE_COMMAND,
  CHATTERBOX_DOCS_URL,
  INSTALL_PIPER_VOICE_COMMAND,
  SYSTEM_VOICE_READY_MESSAGE
} from "../../../src/onboarding/voiceTiers.js";

function fakeActions(showMessageReturns: string | undefined = undefined): VoiceTierActions & {
  calls: { showMessage: unknown[][]; executeCommand: unknown[][]; openExternal: unknown[][]; writeClipboardText: unknown[][] };
} {
  const calls = {
    showMessage: [] as unknown[][],
    executeCommand: [] as unknown[][],
    openExternal: [] as unknown[][],
    writeClipboardText: [] as unknown[][]
  };
  return {
    calls,
    showMessage: vi.fn((...args: unknown[]) => {
      calls.showMessage.push(args);
      return Promise.resolve(showMessageReturns);
    }) as VoiceTierActions["showMessage"],
    executeCommand: vi.fn((...args: unknown[]) => {
      calls.executeCommand.push(args);
      return Promise.resolve(undefined);
    }) as VoiceTierActions["executeCommand"],
    openExternal: vi.fn((...args: unknown[]) => {
      calls.openExternal.push(args);
      return Promise.resolve(undefined);
    }) as VoiceTierActions["openExternal"],
    writeClipboardText: vi.fn((...args: unknown[]) => {
      calls.writeClipboardText.push(args);
      return Promise.resolve(undefined);
    }) as VoiceTierActions["writeClipboardText"]
  };
}

describe("handleVoiceTier", () => {
  it("'system': shows the 'nothing to install' message and never touches a command or the network (S7.1's installPiperVoice must not fire)", async () => {
    const actions = fakeActions();

    await handleVoiceTier("system", actions);

    expect(actions.calls.showMessage).toEqual([[SYSTEM_VOICE_READY_MESSAGE, {}]]);
    expect(actions.calls.executeCommand).toEqual([]);
    expect(actions.calls.openExternal).toEqual([]);
  });

  it("'piper': calls the real S7.1 command directly, no registry probe, no fallback message", async () => {
    const actions = fakeActions();

    await handleVoiceTier("piper", actions);

    expect(actions.calls.executeCommand).toEqual([[INSTALL_PIPER_VOICE_COMMAND]]);
    expect(actions.calls.showMessage).toEqual([]);
  });

  it("'chatterbox': shows the modal instructions naming the real compose command", async () => {
    const actions = fakeActions(undefined);

    await handleVoiceTier("chatterbox", actions);

    expect(actions.calls.showMessage).toHaveLength(1);
    const [message, options, ...buttons] = actions.calls.showMessage[0] as [string, { modal?: boolean }, ...string[]];
    expect(message).toContain(CHATTERBOX_COMPOSE_COMMAND);
    expect(options).toEqual({ modal: true });
    expect(buttons).toEqual(["Copier la commande", "Ouvrir la documentation"]);
    expect(actions.calls.writeClipboardText).toEqual([]);
    expect(actions.calls.openExternal).toEqual([]);
  });

  it("'chatterbox' + 'Copier la commande': copies the compose command and confirms", async () => {
    const actions = fakeActions("Copier la commande");

    await handleVoiceTier("chatterbox", actions);

    expect(actions.calls.writeClipboardText).toEqual([[CHATTERBOX_COMPOSE_COMMAND]]);
    expect(actions.calls.openExternal).toEqual([]);
    // The modal prompt, then a plain confirmation — never modal twice.
    expect(actions.calls.showMessage).toHaveLength(2);
    expect(actions.calls.showMessage[1]?.[1]).toEqual({});
  });

  it("'chatterbox' + 'Ouvrir la documentation': opens the real docs URL", async () => {
    const actions = fakeActions("Ouvrir la documentation");

    await handleVoiceTier("chatterbox", actions);

    expect(actions.calls.openExternal).toEqual([[CHATTERBOX_DOCS_URL]]);
    expect(actions.calls.writeClipboardText).toEqual([]);
  });

  it("'chatterbox' dismissed (no button clicked): no clipboard write, no external open", async () => {
    const actions = fakeActions(undefined);

    await handleVoiceTier("chatterbox", actions);

    expect(actions.calls.writeClipboardText).toEqual([]);
    expect(actions.calls.openExternal).toEqual([]);
  });
});
