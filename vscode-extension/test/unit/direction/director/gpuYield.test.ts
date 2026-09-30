/** ADR-015 §8: the game-mode flag is `$XDG_RUNTIME_DIR/gpu-yield/active`; absence means "GPU available". */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createGpuYieldProbe, gpuYieldFlagPath } from "../../../../src/direction/director/index.js";

const created: string[] = [];
afterEach(() => {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});
const runtimeDir = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "llm-voice-runtime-"));
  created.push(dir);
  return dir;
};

describe("createGpuYieldProbe", () => {
  it("follows the flag file in the given runtime dir, appearing and disappearing without any watcher", () => {
    const dir = runtimeDir();
    const probe = createGpuYieldProbe({ runtimeDir: dir });
    expect(probe()).toBe(false);
    mkdirSync(path.join(dir, "gpu-yield"));
    expect(probe()).toBe(false);
    writeFileSync(gpuYieldFlagPath(dir), "");
    expect(probe()).toBe(true);
    rmSync(gpuYieldFlagPath(dir));
    expect(probe()).toBe(false);
  });

  it("reads XDG_RUNTIME_DIR by default and treats a missing or empty value as GPU available", () => {
    const dir = runtimeDir();
    mkdirSync(path.join(dir, "gpu-yield"));
    writeFileSync(gpuYieldFlagPath(dir), "");
    const previous = process.env.XDG_RUNTIME_DIR;
    try {
      process.env.XDG_RUNTIME_DIR = dir;
      expect(createGpuYieldProbe()()).toBe(true);
      process.env.XDG_RUNTIME_DIR = "";
      expect(createGpuYieldProbe()()).toBe(false);
      delete process.env.XDG_RUNTIME_DIR;
      expect(createGpuYieldProbe()()).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.XDG_RUNTIME_DIR;
      } else {
        process.env.XDG_RUNTIME_DIR = previous;
      }
    }
  });

  it("is injectable (`exists`) and an error while probing means GPU available", () => {
    const seen: string[] = [];
    expect(createGpuYieldProbe({ runtimeDir: "/run/user/1000", exists: (file) => (seen.push(file), true) })()).toBe(true);
    expect(seen).toEqual(["/run/user/1000/gpu-yield/active"]);
    expect(
      createGpuYieldProbe({
        runtimeDir: "/x",
        exists: () => {
          throw new Error("EACCES");
        }
      })()
    ).toBe(false);
    expect(createGpuYieldProbe({ runtimeDir: undefined, exists: () => true })()).toBe(false);
  });
});
