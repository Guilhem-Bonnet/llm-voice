/**
 * Game-mode detection (ADR-015 §8, "Mode jeu"). On this machine a hook
 * suspends GPU work while `$XDG_RUNTIME_DIR/gpu-yield/active` exists; the flag
 * is a local convention of Linux, and its absence (other platforms, no runtime
 * dir) means "GPU available".
 *
 * The probe is synchronous, does one `stat`, never waits and never watches:
 * the pipeline asks it before each model call and acts on the answer, it does
 * not poll for the flag to be lifted. Injectable (`exists`, `runtimeDir`) so a
 * test points it at a temporary directory instead of the real runtime dir.
 */

import { existsSync } from "node:fs";
import * as path from "node:path";

export type GpuYieldProbe = () => boolean;

export interface GpuYieldProbeOptions {
  /** Defaults to `process.env.XDG_RUNTIME_DIR`. An empty value means "no flag possible". */
  readonly runtimeDir?: string | undefined;
  readonly exists?: (file: string) => boolean;
}

export function gpuYieldFlagPath(runtimeDir: string): string {
  return path.join(runtimeDir, "gpu-yield", "active");
}

export function createGpuYieldProbe(options: GpuYieldProbeOptions = {}): GpuYieldProbe {
  const exists = options.exists ?? existsSync;
  return () => {
    const runtimeDir = "runtimeDir" in options ? options.runtimeDir : process.env.XDG_RUNTIME_DIR;
    if (runtimeDir === undefined || runtimeDir.length === 0) {
      return false;
    }
    try {
      return exists(gpuYieldFlagPath(runtimeDir));
    } catch {
      return false;
    }
  };
}
