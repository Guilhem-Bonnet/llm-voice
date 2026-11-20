/**
 * Start-up of a directed reading (card 5b-bis, `latency-diagnosis.md`): the
 * first segment is read neutrally at once, the model is preloaded when the
 * reading is opened, the first directed window is short, and the directed
 * cues take over without any gap once they exist. Fake model, real timers.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import {
  DEFAULT_FIRST_WINDOW_SIZE,
  DEFAULT_LEAD_SEGMENTS,
  DEFAULT_STARTUP_GRACE_MS,
  DIRECTION_PROMPT_VERSION,
  type DirectionLlmRequest,
  type FakeCallInfo
} from "../../../../src/direction/director/index.js";
import { makeBlocks, makeRig, recordingGuard, sleep, timed, type Rig } from "./support.js";

const START = { leadSegments: 1, startupGraceMs: 100, firstWindowSize: 2, windowSize: 4, lookahead: 8, firstSoundBudgetMs: 2000, steadyBudgetMs: 2000 } as const;

const windowsAsked = (rig: Rig): string[][] =>
  rig.llm.callsOf("direct").map((call) => (call.request as DirectionLlmRequest).window.map((b) => b.id));

describe("start-up: neutral first, then relay", () => {
  it("reads the lead segment and the segment of the pending window neutrally with no wait, then relays to the directed cues", async () => {
    const rig = await makeRig({
      pipeline: { ...START, startupGraceMs: 20 },
      llm: { latencyMs: (i: FakeCallInfo) => (i.kind === "direct" ? 250 : 0) }
    });
    const session = rig.open({ source: makeBlocks(9) });

    const one = await timed(() => session.cuesFor("seg-1"));
    const two = await timed(() => session.cuesFor("seg-2"));
    expect(one.ms).toBeLessThan(150);
    expect(two.ms).toBeLessThan(150);
    for (const answer of [one.value, two.value]) {
      expect(answer).toMatchObject({ directed: false, source: "neutral", degradedReason: "late" });
      expect(answer.cues).toHaveLength(1);
    }

    await session.idle();
    const three = await session.cuesFor("seg-3");
    expect(three).toMatchObject({ directed: true, source: "llm" });
    expect((await session.cuesFor("seg-4")).directed).toBe(true);
    // The relay goes on with the next windows, without a wait when they are ready.
    const later = await timed(() => session.cuesFor("seg-7"));
    expect(later.value.directed).toBe(true);
    expect(later.ms).toBeLessThan(150);
  });

  it("directs a first window of two segments after the lead, then windows of the normal size", async () => {
    const rig = await makeRig({ pipeline: START });
    const session = rig.open({ source: makeBlocks(12) });
    await session.cuesFor("seg-1");
    await session.idle();
    expect(windowsAsked(rig)).toEqual([
      ["seg-2", "seg-3"],
      ["seg-4", "seg-5", "seg-6", "seg-7"],
      ["seg-8", "seg-9", "seg-10", "seg-11"]
    ]);
  });

  it("the lead segment is never sent to the model as a window, only as context", async () => {
    const rig = await makeRig({ pipeline: START });
    const session = rig.open({ source: makeBlocks(6) });
    await session.cuesFor("seg-1");
    await session.idle();
    const first = rig.llm.callsOf("direct")[0]?.request as DirectionLlmRequest;
    expect(first.window.map((b) => b.id)).toEqual(["seg-2", "seg-3"]);
    expect(first.previous.map((b) => b.id)).toEqual(["seg-1"]);
  });

  it("once the first window has settled, a later window not ready waits the steady budget, not the start-up one", async () => {
    const rig = await makeRig({
      pipeline: { ...START, lookahead: 0, steadyBudgetMs: 60 },
      llm: { latencyMs: (i: FakeCallInfo) => (i.kind === "direct" && i.index >= 1 ? 400 : 0) }
    });
    const session = rig.open({ source: makeBlocks(9) });
    await session.cuesFor("seg-1");
    await session.idle();
    expect((await session.cuesFor("seg-3")).directed).toBe(true);
    const slow = await timed(() => session.cuesFor("seg-4"));
    expect(slow.value).toMatchObject({ directed: false, degradedReason: "late" });
    expect(slow.ms).toBeGreaterThanOrEqual(50);
    expect(slow.ms).toBeLessThan(300);
  });

  it("a cue of the first window that also covers the segment read neutrally is not handed out late", async () => {
    const rig = await makeRig({
      pipeline: START,
      llm: {
        latencyMs: (i: FakeCallInfo) => (i.kind === "direct" ? 150 : 0),
        direction: (_i: FakeCallInfo, r: DirectionLlmRequest) => ({
          cues: [{ cueId: "both", sourceIds: r.window.map((b) => b.id), speakerId: "narrator", spokenText: r.window.map((b) => b.text).join(" ") }]
        })
      }
    });
    const session = rig.open({ source: makeBlocks(4) });
    await session.cuesFor("seg-1");
    const two = await session.cuesFor("seg-2");
    await session.idle();
    const three = await session.cuesFor("seg-3");
    expect(two.directed).toBe(false);
    expect(three.directed).toBe(false);
    expect(three.cues.map((c) => c.spokenText)).toEqual([makeBlocks(3)[2]?.rawText]);
  });

  it("the default start-up leaves two segments to the neutral reading and waits no more than the grace for a pending window", async () => {
    const rig = await makeRig({
      pipeline: { leadSegments: DEFAULT_LEAD_SEGMENTS, firstWindowSize: DEFAULT_FIRST_WINDOW_SIZE, startupGraceMs: DEFAULT_STARTUP_GRACE_MS, lookahead: 8, windowSize: 4 },
      llm: { latencyMs: (i: FakeCallInfo) => (i.kind === "direct" ? 400 : 0) }
    });
    expect([DEFAULT_LEAD_SEGMENTS, DEFAULT_FIRST_WINDOW_SIZE, DEFAULT_STARTUP_GRACE_MS]).toEqual([2, 2, 150]);
    const session = rig.open({ source: makeBlocks(9) });
    await session.cuesFor("seg-1");
    const waited = await timed(() => session.cuesFor("seg-3"));
    expect(waited.value.directed).toBe(false);
    expect(waited.ms).toBeLessThan(300);
    await session.idle();
    expect(windowsAsked(rig)[0]).toEqual(["seg-3", "seg-4"]);
  });

  it("a document no longer than the lead is still directed", async () => {
    const rig = await makeRig({ pipeline: START });
    const session = rig.open({ source: makeBlocks(1) });
    expect(await session.cuesFor("seg-1")).toMatchObject({ directed: true, source: "llm" });
  });

  it("a re-read finds every window already directed in the cache: no model call for them", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "llm-voice-startup-"));
    try {
      const first = await makeRig({ directory, pipeline: START });
      const s1 = first.open({ source: makeBlocks(8) });
      await s1.cuesFor("seg-1");
      await s1.idle();
      const before = first.llm.callsOf("direct").length;
      expect(before).toBeGreaterThan(0);
      const second = await makeRig({ directory, pipeline: START });
      const s2 = second.open({ source: makeBlocks(8) });
      // No idle(): the cached window comes back within the start-up grace, so the reading is directed from its first window.
      expect((await s2.cuesFor("seg-1")).directed).toBe(false);
      expect(await s2.cuesFor("seg-2")).toMatchObject({ directed: true, source: "cache" });
      expect((await s2.cuesFor("seg-3")).source).toBe("cache");
      expect(second.llm.callsOf("direct")).toHaveLength(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("start-up: model preload", () => {
  it("preloads the model when the reading is opened, before any segment is asked for, and does not wait for it", async () => {
    const rig = await makeRig({ pipeline: { ...START, warmup: true }, llm: { warmup: { latencyMs: 300 } } });
    const session = rig.open({ source: makeBlocks(6) });
    expect(rig.llm.warmups).toBe(1);
    expect(rig.llm.calls).toEqual([]);
    const first = await timed(() => session.cuesFor("seg-1"));
    expect(first.ms).toBeLessThan(150);
    await sleep(350);
    expect(rig.trace).toContainEqual({ type: "warmup", ok: true });
  });

  it("makes no call for the preload when it is switched off, when there is nothing to read, or in game mode", async () => {
    const off = await makeRig({ pipeline: { ...START, warmup: false } });
    off.open({ source: makeBlocks(3) });
    const empty = await makeRig({ pipeline: { ...START, warmup: true } });
    empty.open({ source: [] });
    const game = await makeRig({ pipeline: { ...START, warmup: true }, gpuYield: () => true });
    game.open({ source: makeBlocks(3) });
    expect([off.llm.warmups, empty.llm.warmups, game.llm.warmups]).toEqual([0, 0, 0]);
  });

  it("a failed preload does not stop the reading or count as a window failure", async () => {
    const rig = await makeRig({ pipeline: { ...START, warmup: true }, llm: { warmup: { failure: "provider-unavailable" } } });
    const session = rig.open({ source: makeBlocks(6) });
    await session.cuesFor("seg-1");
    await session.idle();
    expect((await session.cuesFor("seg-3")).directed).toBe(true);
    expect(rig.trace).toContainEqual({ type: "warmup", ok: false, degradedReason: "provider-unavailable" });
    expect(session.stats().suspended).toBeUndefined();
  });

  it("a preload refused by the egress guard suspends direction at once", async () => {
    const { guard } = recordingGuard();
    const rig = await makeRig({
      pipeline: { ...START, warmup: true },
      egress: { guard, baseUrl: "http://203.0.113.9:11434" }
    });
    const session = rig.open({ source: makeBlocks(6) });
    await sleep(50);
    expect(session.stats().suspended).toBe("egress-denied");
    await session.cuesFor("seg-1");
    expect(rig.llm.callsOf("direct")).toHaveLength(0);
  });

  it("skips the preload of a session cancelled before it starts", async () => {
    const rig = await makeRig({ pipeline: { ...START, warmup: true }, llm: { warmup: { failure: "hang" } } });
    const session = rig.open({ source: makeBlocks(3) });
    session.dispose();
    await sleep(20);
    expect(rig.trace).toContainEqual({ type: "warmup", ok: false, degradedReason: "cancelled" });
  });
});

describe("prompt version in the cache key", () => {
  it("names both prompt versions", () => {
    expect(DIRECTION_PROMPT_VERSION).toBe("analyst-2.director-3");
  });

  it("a partition directed under another prompt version is not served from the cache", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "llm-voice-version-"));
    mkdirSync(directory, { recursive: true });
    try {
      const run = async (promptVersion: string): Promise<number> => {
        const rig = await makeRig({ directory, pipeline: START, llm: { promptVersion } });
        const session = rig.open({ source: makeBlocks(6) });
        await session.cuesFor("seg-1");
        await session.idle();
        return rig.llm.callsOf("direct").length;
      };
      expect(await run("analyst-2.director-2")).toBeGreaterThan(0);
      expect(await run("analyst-2.director-2")).toBe(0);
      expect(await run(DIRECTION_PROMPT_VERSION)).toBeGreaterThan(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});
