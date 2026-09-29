/**
 * ADR-015 test 15: Previous / Next never stop on a silence and skip the `-pre` of
 * the target cue; the highlight follows §5.4 (during `-post` it stays on the cue
 * just said, during `-pre` it is already on the next one). Driven against
 * `FakeAudioSink`, with silence segments handed to the sink like any chunk.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  PlanCursor,
  highlightOf,
  nextTarget,
  previousTarget,
  translateCues,
  type HighlightState,
  type PlanItem
} from "../../../../src/direction/translator/index.js";
import type { AudioSinkChunk } from "../../../../src/playback/index.js";
import { FakeAudioSink } from "../../../fakes/FakeAudioSink.js";
import { cue } from "./support.js";

// A(post 300) | B(pre 500) | C(pre 200, post 400) | D
const CUES = [
  cue("A", { pauseAfterMs: 300 }),
  cue("B", { pauseBeforeMs: 500 }),
  cue("C", { pauseBeforeMs: 200, pauseAfterMs: 400 }),
  cue("D")
];
const PLAN = translateCues(CUES, { binding: {} });
const IDS = PLAN.items.map((item) => item.segmentId);

function chunkOf(item: PlanItem): AudioSinkChunk {
  return { chunkId: item.segmentId, src: `/cache/${item.segmentId}.wav`, durationMs: item.kind === "silence" ? item.durationMs : 1000 };
}

describe("test 15: navigation and highlight skip the silences", () => {
  const sinks: FakeAudioSink[] = [];
  afterEach(() => {
    for (const sink of sinks.splice(0)) {
      sink.stop();
    }
  });

  it("the plan interleaves silences the way the sink will play them", () => {
    expect(IDS).toEqual(["A", "A-post", "B-pre", "B", "C-pre", "C", "C-post", "D"]);
  });

  it("highlight during a normal read: one change per cue, none on -post, the -pre moves ahead of its cue", async () => {
    const sink = new FakeAudioSink();
    sinks.push(sink);
    const cursor = new PlanCursor(PLAN.items);
    const timeline: string[] = [];
    const highlights: HighlightState[] = [];
    sink.on("started", ({ chunkId }) => {
      const change = cursor.onStarted(chunkId);
      timeline.push(`${chunkId}=>${change?.cueId ?? "-"}`);
      if (change !== undefined) {
        highlights.push(change);
      }
    });

    await sink.load(chunkOf(PLAN.items[0] as PlanItem));
    for (const item of PLAN.items.slice(1)) {
      await sink.enqueue(chunkOf(item));
    }
    sink.play();
    for (const id of IDS) {
      expect(sink.currentChunkId).toBe(id);
      sink.emitEnded(id);
    }

    expect(timeline).toEqual([
      "A=>A",
      "A-post=>-",
      "B-pre=>B",
      "B=>-",
      "C-pre=>C",
      "C=>-",
      "C-post=>-",
      "D=>D"
    ]);
    expect(highlights.map((change) => change.sourceIds)).toEqual([["src-A"], ["src-B"], ["src-C"], ["src-D"]]);
  });

  it("a silence has no highlight of its own: it resolves to the owning cue", () => {
    const indexOf = (id: string) => IDS.indexOf(id);
    expect(highlightOf(PLAN.items, indexOf("A-post"))?.cueId).toBe("A");
    expect(highlightOf(PLAN.items, indexOf("B-pre"))?.cueId).toBe("B");
    expect(highlightOf(PLAN.items, indexOf("C-post"))?.sourceIds).toEqual(["src-C"]);
    expect(highlightOf(PLAN.items, 99)).toBeUndefined();
  });

  it("Next: never a silence, always the speech of the following cue (the -pre is skipped)", () => {
    const target = (from: string) => IDS[nextTarget(PLAN.items, IDS.indexOf(from)) ?? -1];
    expect(target("A")).toBe("B");
    expect(target("A-post")).toBe("B");
    expect(target("B-pre")).toBe("C");
    expect(target("B")).toBe("C");
    expect(target("C-pre")).toBe("D");
    expect(target("C-post")).toBe("D");
    expect(nextTarget(PLAN.items, IDS.indexOf("D"))).toBeUndefined();
  });

  it("Previous: media-player rule on a cue, restart on a -post, back one cue on a -pre", () => {
    const target = (from: string, positionMs: number) => IDS[previousTarget(PLAN.items, IDS.indexOf(from), positionMs) ?? -1];
    expect(target("C", 500)).toBe("B");
    expect(target("C", 2500)).toBe("C");
    expect(target("C-post", 0)).toBe("C");
    expect(target("C-pre", 0)).toBe("B");
    expect(target("B-pre", 0)).toBe("A");
    expect(target("A", 100)).toBe("A");
    expect(target("A-post", 0)).toBe("A");
    expect(target("A", 3000)).toBe("A");
  });

  it("property: from every item and position, both jumps land on a speech item that starts at its audio", () => {
    for (let index = 0; index < PLAN.items.length; index += 1) {
      for (const positionMs of [0, 1999, 2000, 60_000]) {
        for (const target of [nextTarget(PLAN.items, index), previousTarget(PLAN.items, index, positionMs)]) {
          if (target !== undefined) {
            expect(PLAN.items[target]?.kind).toBe("speech");
            expect(PLAN.items[target]?.navigable).toBe(true);
          }
        }
      }
    }
  });

  it("a jump loaded into the sink starts at the target's speech and moves the highlight, silences never highlighted", async () => {
    const sink = new FakeAudioSink();
    sinks.push(sink);
    const cursor = new PlanCursor(PLAN.items);
    const changes: string[] = [];
    sink.on("started", ({ chunkId }) => {
      const change = cursor.onStarted(chunkId);
      if (change !== undefined) {
        changes.push(change.cueId);
      }
    });

    await sink.load(chunkOf(PLAN.items[0] as PlanItem));
    sink.play();
    // Skip forward twice from A, then back once.
    for (const step of ["next", "next", "previous"] as const) {
      const item = step === "next" ? cursor.next() : cursor.previous(0);
      expect(item?.kind).toBe("speech");
      await sink.load(chunkOf(item as PlanItem));
      sink.play();
      expect(sink.currentChunkId).toBe(item?.segmentId);
    }
    expect(sink.loads.map((chunk) => chunk.chunkId)).toEqual(["A", "B", "C", "B"]);
    expect(changes).toEqual(["A", "B", "C", "B"]);
    expect(sink.loads.some((chunk) => chunk.chunkId.endsWith("-pre") || chunk.chunkId.endsWith("-post"))).toBe(false);
  });

  it("Next from the last cue reports the end instead of stopping on its -post", () => {
    const withTail = translateCues([cue("A"), cue("B", { pauseAfterMs: 900 })], { binding: {} });
    const cursor = new PlanCursor(withTail.items);
    cursor.onStarted("B-post");
    expect(cursor.next()).toBeUndefined();
  });
});
