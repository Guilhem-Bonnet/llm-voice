import { describe, expect, it } from "vitest";
import { addHookEntry, containsHookEntry, removeHookEntry } from "../../../src/claude/hookEntry.js";

const COMMAND = 'node "/home/user/.llm-voice/hooks/llm-voice-capture.js"';

describe("addHookEntry / removeHookEntry / containsHookEntry", () => {
  it("adds a Stop hook to an empty settings object", () => {
    const next = addHookEntry({}, COMMAND);
    expect(next.hooks?.Stop).toHaveLength(1);
    expect(next.hooks?.Stop?.[0]?.hooks[0]?.command).toBe(COMMAND);
    expect(next.hooks?.Stop?.[0]?.hooks[0]?.type).toBe("command");
    expect(next.hooks?.Stop?.[0]?.hooks[0]?.timeout).toBe(15);
  });

  it("handles a file that was empty (parsed as {})", () => {
    expect(containsHookEntry({})).toBe(false);
    const next = addHookEntry({}, COMMAND);
    expect(containsHookEntry(next)).toBe(true);
  });

  it("preserves unrelated top-level keys, other hook events, and other Stop matcher groups", () => {
    const original = {
      someOtherSetting: true,
      hooks: {
        PreToolUse: [{ hooks: [{ type: "command", command: "rtk" }] }],
        Stop: [{ matcher: "existing", hooks: [{ type: "command", command: "some-other-tool" }] }]
      }
    };

    const next = addHookEntry(original, COMMAND);

    expect(next.someOtherSetting).toBe(true);
    expect(next.hooks?.PreToolUse).toEqual(original.hooks.PreToolUse);
    expect(next.hooks?.Stop).toHaveLength(2);
    expect(next.hooks?.Stop?.[0]).toEqual(original.hooks.Stop[0]);
    expect(next.hooks?.Stop?.[1]?.hooks[0]?.command).toBe(COMMAND);
  });

  it("is idempotent: adding twice yields exactly one recognised entry", () => {
    const once = addHookEntry({}, COMMAND);
    const twice = addHookEntry(once, COMMAND);

    const allCommands = twice.hooks?.Stop?.flatMap((group) => group.hooks.map((hook) => hook.command)) ?? [];
    expect(allCommands.filter((command) => command.includes("llm-voice-capture"))).toHaveLength(1);
  });

  it("recognises an existing entry with a different absolute path (substring match)", () => {
    const existing = addHookEntry({}, "node /different/path/llm-voice-capture.js");
    expect(containsHookEntry(existing)).toBe(true);
    const stillOne = addHookEntry(existing, COMMAND);
    const allCommands = stillOne.hooks?.Stop?.flatMap((group) => group.hooks.map((hook) => hook.command)) ?? [];
    expect(allCommands).toHaveLength(1);
  });

  it("removeHookEntry removes only our entry, keeping every other hook", () => {
    const withBoth = addHookEntry(
      {
        hooks: {
          Stop: [{ matcher: "other", hooks: [{ type: "command", command: "some-other-tool" }] }]
        }
      },
      COMMAND
    );

    const removed = removeHookEntry(withBoth);

    expect(containsHookEntry(removed)).toBe(false);
    expect(removed.hooks?.Stop).toHaveLength(1);
    expect(removed.hooks?.Stop?.[0]?.hooks[0]?.command).toBe("some-other-tool");
  });

  it("removeHookEntry drops hooks.Stop and hooks entirely once nothing is left", () => {
    const onlyOurs = addHookEntry({}, COMMAND);
    const removed = removeHookEntry(onlyOurs);
    expect(removed.hooks).toBeUndefined();
  });

  it("removeHookEntry on settings without our hook is a no-op", () => {
    const original = { hooks: { Stop: [{ hooks: [{ type: "command", command: "unrelated" }] }] } };
    const result = removeHookEntry(original);
    expect(result).toEqual(original);
  });

  it("removeHookEntry on a completely empty settings object is a no-op", () => {
    expect(removeHookEntry({})).toEqual({});
  });
});
