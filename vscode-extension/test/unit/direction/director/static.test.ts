/**
 * ADR-015 §10 and Tests 8 and 11 (static side): the director modules reach
 * neither the network nor the player, import no `vscode`, and never compare on
 * a genre anywhere under `src/direction/`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DIRECTION = resolve(__dirname, "../../../../src/direction");
const DIRECTOR = join(DIRECTION, "director");

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? tsFiles(full) : name.endsWith(".ts") ? [full] : [];
  });
}

const DIRECTOR_FILES = readdirSync(DIRECTOR).filter((name) => name.endsWith(".ts"));

describe("src/direction/director static rules", () => {
  it("has the modules the design names", () => {
    expect([...DIRECTOR_FILES].sort()).toEqual([
      "Analyst.ts",
      "DirectionPipeline.ts",
      "FakeDirectionLlm.ts",
      "OllamaDirectionLlm.ts",
      "PartitionCache.ts",
      "StageDirector.ts",
      "gpuYield.ts",
      "index.ts",
      "llm.ts"
    ]);
  });

  it.each(DIRECTOR_FILES)("%s imports no `vscode`, does no network I/O and cannot start a reading", (name) => {
    const source = readFileSync(join(DIRECTOR, name), "utf8");
    expect(source).not.toMatch(/from\s+["']vscode["']/);
    expect(source).not.toMatch(/(?<![.\w])fetch\s*\(/);
    expect(source).not.toMatch(/node:(http|https|net|dgram|tls|child_process)/);
    expect(source).not.toMatch(/PlaybackController|CoreClient|AudioQueue|NativeAudioSink/);
    expect(source).not.toMatch(/\.(play|start)\s*\(/);
  });

  it("makes its only network access through an injected EgressGuardHandle (the fake and the Ollama client), never `EgressGuard` internals", () => {
    const users = DIRECTOR_FILES.filter((name) => /from\s+["'][^"']*net\/EgressGuard/.test(readFileSync(join(DIRECTOR, name), "utf8")));
    expect(users.sort()).toEqual(["FakeDirectionLlm.ts", "OllamaDirectionLlm.ts", "llm.ts"]);
  });

  it("never compares on a genre anywhere under src/direction (Test 8)", () => {
    const offenders = tsFiles(DIRECTION).filter((file) => {
      const source = readFileSync(file, "utf8");
      return (
        /\bgenre\b\s*(===|!==|==|!=)/.test(source) ||
        /(===|!==|==|!=)\s*[\w.?]*\bgenre\b/.test(source) ||
        /switch\s*\([^)]*genre/i.test(source) ||
        /(===|!==|==|!=)\s*["'](roman|novel|documentation|doc|ai-reply|reponse-ia)["']/i.test(source)
      );
    });
    expect(offenders).toEqual([]);
  });
});
