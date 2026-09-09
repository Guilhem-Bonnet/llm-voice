import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claudeSettingsFiles,
  findExistingHook,
  writeHookInstalled,
  writeHookUninstalled
} from "../../../src/claude/hookInstallerIO.js";
import { containsHookEntry } from "../../../src/claude/hookEntry.js";

const COMMAND = 'node "/opt/llm-voice/llm-voice-capture.js"';

describe("hookInstallerIO", () => {
  let home: string;
  let workspace: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "llm-voice-home-"));
    workspace = mkdtempSync(join(tmpdir(), "llm-voice-workspace-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  });

  it("claudeSettingsFiles lists the three files: project, project-local, user", () => {
    const files = claudeSettingsFiles(home, workspace);
    expect(files).toHaveLength(3);
    expect(files.map((f) => f.path)).toEqual([
      join(workspace, ".claude", "settings.json"),
      join(workspace, ".claude", "settings.local.json"),
      join(home, ".claude", "settings.json")
    ]);
  });

  it("claudeSettingsFiles lists only the user file without a workspace", () => {
    const files = claudeSettingsFiles(home);
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe(join(home, ".claude", "settings.json"));
  });

  it("findExistingHook returns undefined when none of the files exist yet", async () => {
    const files = claudeSettingsFiles(home, workspace);
    expect(await findExistingHook(files)).toBeUndefined();
  });

  it("findExistingHook treats an empty file as absent (no hook)", async () => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(home, ".claude", "settings.json"), "");
    const files = claudeSettingsFiles(home, workspace);
    expect(await findExistingHook(files)).toBeUndefined();
  });

  it("findExistingHook finds the hook in the project settings before touching the user one", async () => {
    mkdirSync(join(workspace, ".claude"), { recursive: true });
    writeFileSync(
      join(workspace, ".claude", "settings.json"),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: COMMAND }] }] } })
    );
    const files = claudeSettingsFiles(home, workspace);

    const found = await findExistingHook(files);

    expect(found?.path).toBe(join(workspace, ".claude", "settings.json"));
  });

  it("writeHookInstalled writes the entry, atomically, with a .bak of the previous content", async () => {
    const target = join(home, ".claude", "settings.json");
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(target, JSON.stringify({ existing: "value" }));

    await writeHookInstalled(target, COMMAND);

    const written = JSON.parse(readFileSync(target, "utf8"));
    expect(written.existing).toBe("value");
    expect(containsHookEntry(written)).toBe(true);
    expect(existsSync(`${target}.bak`)).toBe(true);
    expect(JSON.parse(readFileSync(`${target}.bak`, "utf8")).existing).toBe("value");
    expect(existsSync(`${target}.tmp-${process.pid}`)).toBe(false);
  });

  it("writeHookInstalled creates the file (and parent dirs) when none exists yet, no .bak written", async () => {
    const target = join(home, "does", "not", "exist", "settings.json");

    await writeHookInstalled(target, COMMAND);

    const written = JSON.parse(readFileSync(target, "utf8"));
    expect(containsHookEntry(written)).toBe(true);
    expect(existsSync(`${target}.bak`)).toBe(false);
  });

  it("writeHookInstalled is idempotent when called twice on the same file", async () => {
    const target = join(home, ".claude", "settings.json");

    await writeHookInstalled(target, COMMAND);
    await writeHookInstalled(target, COMMAND);

    const written = JSON.parse(readFileSync(target, "utf8"));
    const allCommands = (written.hooks?.Stop ?? []).flatMap((group: { hooks: { command: string }[] }) =>
      group.hooks.map((hook) => hook.command)
    );
    expect(allCommands).toEqual([COMMAND]);
    expect(containsHookEntry(written)).toBe(true);
    expect((written.hooks?.Stop ?? []).length).toBe(1);
  });

  it("writeHookUninstalled removes only our entry", async () => {
    const target = join(home, ".claude", "settings.json");
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(
      target,
      JSON.stringify({
        hooks: {
          Stop: [
            { hooks: [{ type: "command", command: COMMAND }] },
            { hooks: [{ type: "command", command: "some-other-tool" }] }
          ]
        }
      })
    );

    await writeHookUninstalled(target);

    const written = JSON.parse(readFileSync(target, "utf8"));
    expect(containsHookEntry(written)).toBe(false);
    expect(written.hooks.Stop).toHaveLength(1);
    expect(written.hooks.Stop[0].hooks[0].command).toBe("some-other-tool");
    expect(existsSync(`${target}.bak`)).toBe(true);
  });
});
