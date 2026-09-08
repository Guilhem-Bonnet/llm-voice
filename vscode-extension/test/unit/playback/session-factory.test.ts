import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  NarrationRequest,
  NarrationResult,
  NarratorProvider,
  ProviderHealth
} from "../../../src/core/index.js";
import {
  InMemoryAudioCache,
  PlaybackController,
  buildSession,
  type NarrationWarning
} from "../../../src/playback/index.js";
import { FakeAudioSink } from "../../fakes/FakeAudioSink.js";
import { FakeNarratorProvider } from "../../fakes/FakeNarratorProvider.js";
import { FakeTtsProvider } from "../../fakes/FakeTtsProvider.js";
import { makeProfile, makeSourceSegments } from "./helpers.js";

/** Narrator whose calls are resolved by the test, one group at a time. */
class ManualNarrator implements NarratorProvider {
  readonly id = "manual-narrator";
  readonly requests: NarrationRequest[] = [];
  private readonly pending: Array<{
    request: NarrationRequest;
    resolve: (result: NarrationResult) => void;
  }> = [];

  async health(): Promise<ProviderHealth> {
    return { providerId: this.id, status: "ok", checkedAt: 0 };
  }

  transform(request: NarrationRequest): Promise<NarrationResult> {
    this.requests.push(request);
    return new Promise<NarrationResult>((resolve) => {
      this.pending.push({ request, resolve });
    });
  }

  /** Resolves the oldest outstanding call with a 1:1 narrated mapping. */
  resolveNext(): void {
    const next = this.pending.shift();
    if (next === undefined) {
      return;
    }
    const { request, resolve } = next;
    resolve({
      segments: request.segments.map((segment) => ({
        id: `narrated-${segment.id}`,
        spokenText: `[narrated] ${segment.rawText}`,
        sourceSegmentIds: [segment.id],
        sourceRanges: segment.sourceRange ? [segment.sourceRange] : []
      })),
      degraded: false
    });
  }

  get outstanding(): number {
    return this.pending.length;
  }
}

const narratedProfile = makeProfile({
  mode: "narrated",
  narrator: {
    providerId: "fake-narrator",
    baseUrl: "http://127.0.0.1:11434",
    model: "llama"
  }
});

describe("buildSession — faithful mode", () => {
  it("maps source segments 1:1 when narration is disabled", async () => {
    const build = await buildSession(makeSourceSegments(3), makeProfile());

    expect(build.segments).toHaveLength(3);
    expect(build.segments[0]).toEqual({
      id: "faithful-src-0",
      spokenText: "Bloc source 0.",
      sourceSegmentIds: ["src-0"],
      sourceRanges: [{ startLine: 0, startColumn: 0, endLine: 0, endColumn: 12 }]
    });
    expect(build.degraded).toBe(false);
    await expect(build.completion).resolves.toHaveLength(3);
  });

  it("maps 1:1 when the profile is narrated but no narrator is injected", async () => {
    const build = await buildSession(makeSourceSegments(2), narratedProfile);
    expect(build.segments.map((segment) => segment.spokenText)).toEqual([
      "Bloc source 0.",
      "Bloc source 1."
    ]);
  });

  it("prefers the normalised spokenText of a source segment when present", async () => {
    const [segment] = makeSourceSegments(1);
    const build = await buildSession(
      [{ ...segment!, spokenText: "Texte normalise." }],
      makeProfile()
    );
    expect(build.segments[0]?.spokenText).toBe("Texte normalise.");
  });

  it("handles an empty document", async () => {
    const build = await buildSession([], makeProfile());
    expect(build.segments).toEqual([]);
    await expect(build.completion).resolves.toEqual([]);
  });

  it("handles an empty document in narrated mode without calling the narrator", async () => {
    const narrator = new FakeNarratorProvider();
    const build = await buildSession([], narratedProfile, narrator);
    expect(build.segments).toEqual([]);
    expect(narrator.requests).toHaveLength(0);
  });
});

describe("buildSession — narrated mode", () => {
  it("narrates by groups of the configured size", async () => {
    const narrator = new FakeNarratorProvider();
    const build = await buildSession(makeSourceSegments(5), narratedProfile, narrator, {
      groupSize: 2
    });
    await build.completion;

    expect(narrator.requests.map((request) => request.segments.length)).toEqual([
      2, 2, 1
    ]);
    expect(build.segments).toHaveLength(5);
    expect(build.segments[0]?.spokenText).toBe("[narrated] Bloc source 0.");
  });

  it("passes the profile identity and the narration contract to the narrator", async () => {
    const narrator = new FakeNarratorProvider();
    const build = await buildSession(makeSourceSegments(2), narratedProfile, narrator, {
      groupSize: 2,
      maxOutputTokens: 512,
      timeoutMs: 9000
    });
    await build.completion;

    expect(narrator.requests[0]).toMatchObject({
      profileId: "profile-test",
      language: "fr",
      mode: "narrated",
      outputContract: "narration-segments",
      maxOutputTokens: 512,
      timeoutMs: 9000
    });
  });

  it("returns after the first group only, the rest narrating in background (CdC §63)", async () => {
    const narrator = new ManualNarrator();
    const building = buildSession(makeSourceSegments(4), narratedProfile, narrator, {
      groupSize: 2
    });
    await Promise.resolve();
    narrator.resolveNext();
    const build = await building;

    // Group 1 is available; group 2 is still being narrated.
    expect(build.segments).toHaveLength(2);
    expect(narrator.requests).toHaveLength(2);
    expect(narrator.outstanding).toBe(1);

    narrator.resolveNext();
    await build.completion;
    expect(build.segments).toHaveLength(4);
  });

  it("notifies appended segments as later groups land", async () => {
    const narrator = new FakeNarratorProvider();
    const appended: number[] = [];
    const build = await buildSession(makeSourceSegments(6), narratedProfile, narrator, {
      groupSize: 2
    });
    build.onSegmentsAppended((added) => appended.push(added.length));
    const off = build.onWarning(() => undefined);
    off();
    await build.completion;

    expect(appended).toEqual([2, 2]);
  });

  it("stops narrating remaining groups once cancelled (CdC §62)", async () => {
    const narrator = new ManualNarrator();
    const building = buildSession(makeSourceSegments(6), narratedProfile, narrator, {
      groupSize: 2
    });
    await Promise.resolve();
    narrator.resolveNext();
    const build = await building;

    build.cancel();
    narrator.resolveNext();
    await build.completion;

    // Group 2 was already in flight and lands; group 3 is never requested.
    expect(narrator.requests).toHaveLength(2);
    expect(build.segments).toHaveLength(4);
  });

  it('forceFaithful() ("Read without narration", CdC §52) stops calling the narrator for the rest of the session', async () => {
    const narrator = new ManualNarrator();
    // 4 groups of 2: group 0 resolves before `build` is even returned, group 1
    // is already dispatched by then (see the cancel test above) — forcing
    // after `await building` can therefore only still catch groups 2 and 3.
    const warnings: NarrationWarning[] = [];
    const building = buildSession(makeSourceSegments(8), narratedProfile, narrator, {
      groupSize: 2,
      onWarning: (warning) => warnings.push(warning)
    });
    await Promise.resolve();
    narrator.resolveNext(); // group 0
    const build = await building;

    build.forceFaithful();
    narrator.resolveNext(); // group 1, already in flight before forceFaithful()
    await build.completion;

    // Groups 2 and 3 never reached the narrator at all.
    expect(narrator.requests).toHaveLength(2);
    expect(build.segments.map((segment) => segment.spokenText)).toEqual([
      "[narrated] Bloc source 0.",
      "[narrated] Bloc source 1.",
      "[narrated] Bloc source 2.",
      "[narrated] Bloc source 3.",
      "Bloc source 4.",
      "Bloc source 5.",
      "Bloc source 6.",
      "Bloc source 7."
    ]);
    expect(build.degraded).toBe(true);
    expect(warnings).toEqual([
      { groupIndex: 2, reason: "user-disabled", segmentIds: ["src-4", "src-5"] },
      { groupIndex: 3, reason: "user-disabled", segmentIds: ["src-6", "src-7"] }
    ]);

    // Calling it again is a no-op, and it never un-forces a session.
    build.forceFaithful();
    expect(narrator.requests).toHaveLength(2);
  });

  it("honours an externally supplied AbortSignal", async () => {
    const narrator = new FakeNarratorProvider();
    const controller = new AbortController();
    controller.abort();
    const build = await buildSession(makeSourceSegments(4), narratedProfile, narrator, {
      groupSize: 2,
      signal: controller.signal
    });
    await build.completion;

    expect(build.degraded).toBe(true);
    expect(build.segments.map((segment) => segment.spokenText)).toEqual([
      "Bloc source 0.",
      "Bloc source 1."
    ]);
    expect(narrator.requests).toHaveLength(0);
  });
});

describe("buildSession — degraded mode (ADR-005)", () => {
  it("falls back to a faithful 1:1 mapping for the degraded group", async () => {
    const narrator = new FakeNarratorProvider({ invalidJsonOnce: true });
    const warnings: NarrationWarning[] = [];
    const build = await buildSession(makeSourceSegments(4), narratedProfile, narrator, {
      groupSize: 2,
      onWarning: (warning) => warnings.push(warning)
    });
    await build.completion;

    expect(warnings).toEqual([
      {
        groupIndex: 0,
        reason: "invalid-structured-output",
        segmentIds: ["src-0", "src-1"]
      }
    ]);
    expect(build.degraded).toBe(true);
    expect(build.segments.map((segment) => segment.spokenText)).toEqual([
      "Bloc source 0.",
      "Bloc source 1.",
      "[narrated] Bloc source 2.",
      "[narrated] Bloc source 3."
    ]);
  });

  it("falls back when the narrator returns no segment at all", async () => {
    const empty: NarratorProvider = {
      id: "empty",
      async health() {
        return { providerId: "empty", status: "ok" as const, checkedAt: 0 };
      },
      async transform() {
        return { segments: [], degraded: false };
      }
    };
    const build = await buildSession(makeSourceSegments(2), narratedProfile, empty, {
      groupSize: 2
    });
    expect(build.degraded).toBe(true);
    expect(build.segments).toHaveLength(2);
  });

  it("falls back when the narrator breaks its contract and rejects", async () => {
    const broken: NarratorProvider = {
      id: "broken",
      async health() {
        return { providerId: "broken", status: "ok" as const, checkedAt: 0 };
      },
      async transform() {
        throw new Error("narrator crashed");
      }
    };
    const warnings: NarrationWarning[] = [];
    const build = await buildSession(makeSourceSegments(2), narratedProfile, broken, {
      groupSize: 1,
      onWarning: (warning) => warnings.push(warning)
    });
    await build.completion;

    expect(build.degraded).toBe(true);
    expect(warnings).toEqual([
      { groupIndex: 0, reason: "provider-unavailable", segmentIds: ["src-0"] },
      { groupIndex: 1, reason: "provider-unavailable", segmentIds: ["src-1"] }
    ]);
  });
});

describe("buildSession + PlaybackController — progressive narration end to end", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts the first audio before the second group finishes narrating (CdC §63)", async () => {
    const narrator = new ManualNarrator();
    const sink = new FakeAudioSink({ tickMs: 250 });
    const controller = new PlaybackController({ cache: new InMemoryAudioCache() });

    const building = buildSession(makeSourceSegments(4), narratedProfile, narrator, {
      groupSize: 2
    });
    await Promise.resolve();
    narrator.resolveNext();
    const build = await building;

    build.onSegmentsAppended((added) => controller.appendSegments(added));
    void build.completion.then(() => controller.sealSegments());

    await controller.start({
      segments: build.segments,
      profile: narratedProfile,
      tts: new FakeTtsProvider({ msPerWord: 1000 }),
      sink,
      sealed: false
    });

    // Audio is running while the narrator still owes us group 2.
    expect(controller.getState()).toBe("playing");
    expect(sink.currentChunkId).toBe("session-1:0");
    expect(narrator.outstanding).toBe(1);
    expect(controller.getChunks()).toHaveLength(2);

    narrator.resolveNext();
    await vi.advanceTimersByTimeAsync(0);

    expect(controller.getChunks()).toHaveLength(4);
    controller.dispose();
  });
});
