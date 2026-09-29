import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach } from "vitest";

import { checkBible, parseBible, type Bible } from "../../../../src/core/direction.js";
import {
  applyEntry,
  initialState,
  type ApplyOutcome,
  type BibleEvent,
  type BibleState,
  type EventOrigin
} from "../../../../src/direction/bible/index.js";

export const DOC = "d".repeat(64);
export const T0 = "2026-09-29T10:00:00.000Z";

/** mulberry32: tiny, deterministic PRNG; a failure is reproducible from the seed in the test name. */
export function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T;
}

export class Sim {
  state: BibleState;
  seq = 0;
  constructor(scope: "document" | "series" | "user" = "document") {
    this.state = initialState(scope, scope === "document" ? DOC : scope === "series" ? "saga" : "user");
  }
  apply(origin: EventOrigin, event: BibleEvent): ApplyOutcome {
    this.seq += 1;
    const result = applyEntry(this.state, { seq: this.seq, at: T0, origin, event });
    this.state = result.state;
    return result.outcome;
  }
  get bible(): Bible {
    return this.state.bible;
  }
}

/** The projection must stay a valid bible of its scope, with no cross-role issue. */
export function expectValidBible(bible: Bible): string | undefined {
  const parsed = parseBible(bible);
  if (!parsed.ok) {
    return `schema: ${parsed.error.message.slice(0, 200)}`;
  }
  const issues = checkBible(bible);
  return issues.length > 0 ? `check: ${issues.map((i) => i.code).join(",")}` : undefined;
}

export function tempDirs(): () => Promise<string> {
  const created: string[] = [];
  afterEach(async () => {
    await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });
  return async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "llm-voice-bible-"));
    created.push(dir);
    return path.join(dir, "direction");
  };
}
