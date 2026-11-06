import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInstallFreshnessCheck,
  installedBundlePath,
  RELOAD_WINDOW_ACTION
} from "../../../src/pipeline/installFreshness.js";

const ACTIVATED_AT_MS = Date.parse("2026-11-05T10:00:00.000Z");

describe("createInstallFreshnessCheck", () => {
  let dir: string;
  let bundlePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "llm-voice-install-"));
    bundlePath = join(dir, "extension.js");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeBundle(modifiedAtMs: number): Promise<void> {
    await writeFile(bundlePath, "// bundle");
    await utimes(bundlePath, new Date(modifiedAtMs), new Date(modifiedAtMs));
  }

  function setup(choice: string | undefined = undefined) {
    const showWarning = vi.fn(async (_message: string, _action: string) => choice);
    const reloadWindow = vi.fn(async () => undefined);
    const check = createInstallFreshnessCheck({
      bundlePath,
      activatedAtMs: ACTIVATED_AT_MS,
      showWarning,
      reloadWindow
    });
    return { check, showWarning, reloadWindow };
  }

  it("offers to reload the window when the installed bundle is newer than the activation", async () => {
    await writeBundle(ACTIVATED_AT_MS + 60_000);
    const { check, showWarning, reloadWindow } = setup();

    await check();

    expect(showWarning).toHaveBeenCalledTimes(1);
    expect(showWarning.mock.calls[0]?.[0]).toContain("nouvelle version");
    expect(showWarning.mock.calls[0]?.[1]).toBe("Recharger la fenêtre");
    expect(reloadWindow).not.toHaveBeenCalled();
  });

  it("reloads the window only when the user picks the action", async () => {
    await writeBundle(ACTIVATED_AT_MS + 60_000);
    const { check, reloadWindow } = setup(RELOAD_WINDOW_ACTION);

    await check();

    expect(reloadWindow).toHaveBeenCalledTimes(1);
  });

  it("stays silent when the bundle has exactly the activation date", async () => {
    await writeBundle(ACTIVATED_AT_MS);
    const { check, showWarning } = setup();

    await check();

    expect(showWarning).not.toHaveBeenCalled();
  });

  it("stays silent when the bundle is older than the activation", async () => {
    await writeBundle(ACTIVATED_AT_MS - 60_000);
    const { check, showWarning } = setup();

    await check();

    expect(showWarning).not.toHaveBeenCalled();
  });

  it("stays silent and does not throw when the bundle file is absent", async () => {
    const { check, showWarning } = setup();

    await expect(check()).resolves.toBeUndefined();

    expect(showWarning).not.toHaveBeenCalled();
  });

  it("warns once, however many readings follow and even after the user dismissed it", async () => {
    await writeBundle(ACTIVATED_AT_MS + 60_000);
    const { check, showWarning } = setup(undefined);

    await check();
    await check();
    await check();

    expect(showWarning).toHaveBeenCalledTimes(1);
  });

  it("warns once when two readings check at the same time", async () => {
    await writeBundle(ACTIVATED_AT_MS + 60_000);
    const { check, showWarning } = setup();

    await Promise.all([check(), check()]);

    expect(showWarning).toHaveBeenCalledTimes(1);
  });

  it("a check that found nothing does not use up the warning: a later install still warns", async () => {
    const { check, showWarning } = setup();

    await check();
    await writeBundle(ACTIVATED_AT_MS);
    await check();
    expect(showWarning).not.toHaveBeenCalled();

    await writeBundle(ACTIVATED_AT_MS + 60_000);
    await check();
    expect(showWarning).toHaveBeenCalledTimes(1);
  });
});

describe("installedBundlePath", () => {
  it("is the file package.json declares as the extension's entry point", () => {
    const root = resolve(__dirname, "../../..");
    const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { main: string };

    expect(installedBundlePath(root)).toBe(resolve(root, manifest.main));
  });
});
