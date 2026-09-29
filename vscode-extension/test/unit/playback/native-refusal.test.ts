/**
 * Bogue terrain (GAO-tests-int-gr-001, GAO-bogue-un-seg-001): when the Core
 * refuses a segment (`enqueue` acked `ok:false`, HTTP 400), the
 * `PlaybackController` used to stay in `preparing` forever — `NativeAudioSink.load`
 * rejected instead of emitting `error`, so neither the failure policy (CdC §52)
 * nor the user notification ever ran. Real `NativeAudioSink` + real
 * `PlaybackController` against `FakeCoreServer`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlaybackState } from "../../../src/core/index.js";
import { InMemoryAudioCache, PlaybackController, type PlaybackErrorInfo } from "../../../src/playback/index.js";
import { NativeAudioSink } from "../../../src/playback/NativeAudioSink.js";
import { FakeCoreServer } from "../../fakes/FakeCoreServer.js";
import { FakeTtsProvider } from "../../fakes/FakeTtsProvider.js";
import { makeProfile, makeSegments } from "./helpers.js";

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("waitFor: timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("PlaybackController + NativeAudioSink — Core refuses a segment", () => {
  let server: FakeCoreServer;
  let sink: NativeAudioSink;

  beforeEach(async () => {
    server = new FakeCoreServer();
    await server.start();
    sink = new NativeAudioSink({
      connect: async () => ({ baseUrl: server.baseUrl, wsUrl: server.wsUrl, token: server.token })
    });
  });

  afterEach(async () => {
    sink.dispose();
    await server.stop();
  });

  function makeController(decision: "skip" | "stop", answerAfterMs = 0) {
    const controller = new PlaybackController({
      cache: new InMemoryAudioCache(),
      retryBackoffMs: [0, 0],
      retryJitterMs: 0,
      onChunkError: () =>
        answerAfterMs === 0
          ? decision
          : new Promise<"skip" | "stop">((resolve) => setTimeout(() => resolve(decision), answerAfterMs))
    });
    const states: PlaybackState[] = [];
    const errors: PlaybackErrorInfo[] = [];
    controller.onStateChange((change) => states.push(change.state));
    controller.onError((info) => errors.push(info));
    return { controller, states, errors };
  }

  it("policy stop: the refusal surfaces with the Core's message and the state ends `error`, never stuck in `preparing`", async () => {
    server.failNextOn("enqueue", { code: "invalid_request", message: "segmentId hors contrat" });
    const { controller, states, errors } = makeController("stop");
    await controller.start({
      segments: makeSegments(2),
      profile: makeProfile(),
      tts: new FakeTtsProvider({ msPerWord: 100 }),
      sink
    });
    await waitFor(() => controller.getState() === "error");

    expect(errors).toHaveLength(1);
    expect(errors[0]?.origin).toBe("playback");
    expect(errors[0]?.message).toContain("segmentId hors contrat");
    expect(controller.getState()).not.toBe("preparing");
    expect(states.at(-1)).toBe("error");
    // The refused segment never reaches `playing`, not even transiently.
    expect(states).not.toContain("playing");
    controller.dispose();
  });

  it("a slow user decision (notification still open) leaves the refused segment out of `playing`", async () => {
    server.failNextOn("enqueue", { code: "invalid_request", message: "refusé" });
    const { controller, states, errors } = makeController("stop", 60);
    await controller.start({
      segments: makeSegments(2),
      profile: makeProfile(),
      tts: new FakeTtsProvider({ msPerWord: 100 }),
      sink
    });
    await waitFor(() => errors.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Decision still pending: the machine must not have started "playing" the failed chunk.
    expect(states).not.toContain("playing");
    expect(server.requests.map((request) => request.path)).not.toContain("play");
    await waitFor(() => controller.getState() === "error");
    controller.dispose();
  });

  it("policy skip: the refused segment is skipped and the next one is loaded and played", async () => {
    server.failNextOn("enqueue", { code: "invalid_request", message: "refusé" });
    const { controller, errors } = makeController("skip");
    await controller.start({
      segments: makeSegments(2),
      profile: makeProfile(),
      tts: new FakeTtsProvider({ msPerWord: 100 }),
      sink
    });
    await waitFor(() => controller.getState() === "playing" && controller.getCurrentIndex() === 1);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.index).toBe(0);
    const enqueues = server.requests.filter((request) => request.path === "enqueue");
    expect(enqueues.map((request) => request.body.segmentId)).toEqual(["session-1_3a_0", "session-1_3a_1"]);
    controller.dispose();
  });

  it("a network failure on load() is handled the same way: `error`, not `preparing`", async () => {
    const failing = new NativeAudioSink({
      connect: async () => ({ baseUrl: server.baseUrl, wsUrl: server.wsUrl, token: server.token }),
      fetchImpl: async () => {
        throw new Error("fetch failed");
      }
    });
    const { controller, errors } = makeController("stop");
    await controller.start({
      segments: makeSegments(1),
      profile: makeProfile(),
      tts: new FakeTtsProvider({ msPerWord: 100 }),
      sink: failing
    });
    await waitFor(() => controller.getState() === "error");

    expect(errors[0]?.message).toContain("fetch failed");
    controller.dispose();
    failing.dispose();
  });
});
