/**
 * `NativeAudioSink` (ADR-012 §3, GAO-core-rust-mi-001 étape B): the Core v1
 * HTTP+WS mapping to `AudioSink` v2, proven against `FakeCoreServer` (real
 * sockets, no fake timers — the WebSocket handshake needs a real event loop).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NativeAudioSink, decodeSegmentId, encodeSegmentId } from "../../../src/playback/NativeAudioSink.js";
import type { AudioSinkChunk, AudioSinkEvent, AudioSinkEventMap } from "../../../src/playback/AudioSink.js";
import { FakeCoreServer } from "../../fakes/FakeCoreServer.js";

function chunk(id: string, src = `/cache/${id}.wav`): AudioSinkChunk {
  return { chunkId: id, src };
}

describe("NativeAudioSink", () => {
  let server: FakeCoreServer;

  beforeEach(async () => {
    server = new FakeCoreServer();
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  function makeSink(): { sink: NativeAudioSink; events: string[] } {
    const sink = new NativeAudioSink({
      connect: async () => ({ baseUrl: server.baseUrl, wsUrl: server.wsUrl, token: server.token })
    });
    const events: string[] = [];
    const record = <E extends AudioSinkEvent>(event: E) =>
      (payload: AudioSinkEventMap[E]) => events.push(`${event}:${(payload as { chunkId: string }).chunkId}`);
    (["timeupdate", "started", "ended", "underrun", "error"] as const).forEach((event) => {
      sink.on(event, record(event));
    });
    return { sink, events };
  }

  async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) {
        throw new Error("waitFor: timed out");
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  it("encodes pipeline chunk ids into contract-safe segment ids, reversibly", () => {
    for (const id of ["session-4:0", "session-12:7", "a_b", "c1", "é:ü/.x"]) {
      const encoded = encodeSegmentId(id);
      expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeSegmentId(encoded)).toBe(id);
    }
  });

  it("a real pipeline chunk id (session-4:0) is accepted by the Core and events map back to it", async () => {
    const { sink, events } = makeSink();
    await sink.load(chunk("session-4:0"));
    const enqueueBody = server.requests.find((r) => r.path === "enqueue")?.body;
    expect(enqueueBody?.segmentId).toBe("session-4_3a_0");
    sink.play();
    server.emit({ type: "segment_started", segmentId: "session-4_3a_0", positionMs: 0 });
    server.emit({ type: "segment_ended", segmentId: "session-4_3a_0", positionMs: 1000 });
    await waitFor(() => events.includes("ended:session-4:0"));
    expect(events).toContain("started:session-4:0");
    sink.dispose();
  });

  it("load() stops then enqueues the chunk (wav, paused at 0ms)", async () => {
    const { sink } = makeSink();
    await sink.load(chunk("c1"));
    expect(server.requests.map((r) => r.path)).toEqual(["stop", "enqueue"]);
    const enqueueBody = server.requests[1]?.body;
    expect(enqueueBody).toMatchObject({ segmentId: "c1", path: "/cache/c1.wav", format: "wav" });
    sink.dispose();
  });

  it("play() then pause() send play then pause; a second play() sends resume", async () => {
    const { sink } = makeSink();
    await sink.load(chunk("c1"));
    sink.play();
    await waitFor(() => server.requests.some((r) => r.path === "play"));
    sink.pause();
    await waitFor(() => server.requests.some((r) => r.path === "pause"));
    sink.play();
    await waitFor(() => server.requests.some((r) => r.path === "resume"));
    sink.dispose();
  });

  it("translates segment_started/segment_ended/position to started/ended/timeupdate", async () => {
    const { sink, events } = makeSink();
    await sink.load(chunk("c1"));
    sink.play();
    server.emit({ type: "segment_started", segmentId: "c1", positionMs: 0 });
    server.emit({ type: "position", segmentId: "c1", positionMs: 500 });
    server.emit({ type: "segment_ended", segmentId: "c1", positionMs: 3000 });
    await waitFor(() => events.includes("ended:c1"));
    expect(events).toContain("started:c1");
    expect(events).toContain("timeupdate:c1");
    sink.dispose();
  });

  it("underrun marks the sink starved; the next enqueue() is sent immediately", async () => {
    const { sink, events } = makeSink();
    await sink.load(chunk("c1"));
    sink.play();
    server.emit({ type: "segment_started", segmentId: "c1", positionMs: 0 });
    server.emit({ type: "underrun", segmentId: "c1", positionMs: 3000 });
    await waitFor(() => events.includes("underrun:c1"));

    await sink.enqueue(chunk("c2"));
    // Starved: enqueue() must not wait for a `started` event on `c1` — it is
    // POSTed right away (the Core auto-resumes it, `engine.rs`'s `starved`
    // branch).
    expect(server.requests.filter((r) => r.path === "enqueue").map((r) => r.body.segmentId)).toEqual([
      "c1",
      "c2"
    ]);
    sink.dispose();
  });

  it("enqueue() before the current chunk starts is held back, then sent once it does", async () => {
    const { sink } = makeSink();
    await sink.load(chunk("c1"));
    sink.play();
    await sink.enqueue(chunk("c2"));
    // Not started yet: c2 must not have been sent.
    expect(server.requests.filter((r) => r.path === "enqueue")).toHaveLength(1);

    server.emit({ type: "segment_started", segmentId: "c1", positionMs: 0 });
    await waitFor(() => server.requests.filter((r) => r.path === "enqueue").length === 2);
    expect(server.requests.filter((r) => r.path === "enqueue").map((r) => r.body.segmentId)).toEqual([
      "c1",
      "c2"
    ]);

    // The Core's own `segment_started` for c2 (already queued server-side)
    // is what actually promotes it — never re-sent by this class.
    server.emit({ type: "segment_started", segmentId: "c2", positionMs: 3000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.requests.filter((r) => r.path === "enqueue")).toHaveLength(2);
    sink.dispose();
  });

  it("clearQueue() drops a chunk this class never sent to the Core", async () => {
    const { sink } = makeSink();
    await sink.load(chunk("c1"));
    sink.play();
    await sink.enqueue(chunk("c2"));
    sink.clearQueue();
    server.emit({ type: "segment_started", segmentId: "c1", positionMs: 0 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(server.requests.filter((r) => r.path === "enqueue").map((r) => r.body.segmentId)).toEqual(["c1"]);
    sink.dispose();
  });

  it("a chunk with an unsupported format fails fast without calling the Core", async () => {
    const { sink, events } = makeSink();
    await sink.load({ chunkId: "bad", src: "/cache/bad.mp3", format: "mp3" });
    expect(events).toEqual(["error:bad"]);
    expect(server.requests).toHaveLength(0);
    sink.dispose();
  });

  it("relays a Core error event for the affected segment", async () => {
    const { sink, events } = makeSink();
    await sink.load(chunk("c1"));
    server.emit({ type: "error", code: "internal_error", message: "flux cpal interrompu", segmentId: "c1" });
    await waitFor(() => events.includes("error:c1"));
    sink.dispose();
  });

  it("two NativeAudioSink clients against one Core: the second load() replaces the first's queue", async () => {
    const { sink: sinkA } = makeSink();
    const { sink: sinkB } = makeSink();
    await sinkA.load(chunk("a1"));
    sinkA.play();
    await waitFor(() => server.connectedSockets === 1);

    await sinkB.load(chunk("b1"));
    await waitFor(() => server.connectedSockets === 2);

    // Both clients talk to the same Core; B's `load()` issued a `stop` that
    // wipes whatever A had queued (`engine.rs::Command::Stop` clears every
    // segment) before enqueuing its own chunk — never two flows at once.
    const paths = server.requests.map((r) => r.path);
    expect(paths).toEqual(["stop", "enqueue", "play", "stop", "enqueue"]);
    expect(server.requests.at(-1)?.body).toMatchObject({ segmentId: "b1" });
    sinkA.dispose();
    sinkB.dispose();
  });
});
