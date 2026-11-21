/**
 * Repris de la PR #64 (GAO-diagnostic-s-001) : une erreur de lecture n'est
 * jamais une progression. Le moteur webview (`SequencedAudioSink` sur
 * `WebviewAudioSink`) déclare `noProgressTimeoutMs` ; sans `timeupdate` dans
 * ce délai après `play()`, `PlaybackController` remonte une erreur de lecture
 * au lieu de laisser le surlignage courir sur du silence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  InMemoryAudioCache,
  PlaybackController,
  type PlaybackErrorInfo
} from "../../../src/playback/index.js";
import type {
  AudioSinkChunk,
  LegacyAudioSink,
  LegacyAudioSinkEvent,
  LegacyAudioSinkEventMap
} from "../../../src/playback/AudioSink.js";
import { Emitter, type Unsubscribe } from "../../../src/playback/emitter.js";
import { SequencedAudioSink } from "../../../src/playback/SequencedAudioSink.js";
import { FakeTtsProvider } from "../../fakes/FakeTtsProvider.js";
import { makeProfile, makeSegments } from "./helpers.js";

/** A `<audio>` stand-in: silent (never reports progress) unless `ticking`. */
class StubLegacySink implements LegacyAudioSink {
  private readonly emitters = {
    timeupdate: new Emitter<LegacyAudioSinkEventMap["timeupdate"]>(),
    ended: new Emitter<LegacyAudioSinkEventMap["ended"]>(),
    error: new Emitter<LegacyAudioSinkEventMap["error"]>()
  };
  private current: string | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly ticking: boolean) {}

  async load(chunk: AudioSinkChunk): Promise<void> {
    this.current = chunk.chunkId;
  }
  play(): void {
    if (this.ticking && this.current !== undefined && this.timer === undefined) {
      let position = 0;
      this.timer = setInterval(() => {
        position += 250;
        if (this.current !== undefined) {
          this.emitters.timeupdate.emit({ chunkId: this.current, positionMs: position });
        }
      }, 250);
    }
  }
  pause(): void {
    this.halt();
  }
  stop(): void {
    this.halt();
    this.current = undefined;
  }
  seek(): void {}
  on<E extends LegacyAudioSinkEvent>(event: E, handler: (payload: LegacyAudioSinkEventMap[E]) => void): Unsubscribe {
    return (this.emitters[event] as unknown as Emitter<LegacyAudioSinkEventMap[E]>).on(handler);
  }
  private halt(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}

async function startOn(sink: SequencedAudioSink, onChunkError: () => "skip" | "stop" = () => "stop") {
  const errors: PlaybackErrorInfo[] = [];
  const controller = new PlaybackController({
    cache: new InMemoryAudioCache(),
    retryBackoffMs: [0, 0],
    retryJitterMs: 0,
    onChunkError
  });
  controller.onError((info) => errors.push(info));
  const started = controller.start({
    segments: makeSegments(3),
    profile: makeProfile(),
    tts: new FakeTtsProvider({ msPerWord: 1000 }),
    sink,
    sealed: true
  });
  await vi.advanceTimersByTimeAsync(50);
  await started;
  return { controller, errors };
}

describe("PlaybackController — no-progress watchdog (PR #64)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports a silent engine as a playback error and stops", async () => {
    const { controller, errors } = await startOn(new SequencedAudioSink(new StubLegacySink(false), { noProgressTimeoutMs: 4000 }));
    expect(controller.getState()).toBe("playing");
    await vi.advanceTimersByTimeAsync(3900);
    expect(errors).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.origin).toBe("playback");
    expect(errors[0]?.index).toBe(0);
    expect(errors[0]?.message).toContain("aucune progression");
    expect(controller.getState()).toBe("error");
  });

  it("stays quiet while the engine reports progress", async () => {
    const { controller, errors } = await startOn(new SequencedAudioSink(new StubLegacySink(true), { noProgressTimeoutMs: 4000 }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(errors).toHaveLength(0);
    expect(controller.getState()).toBe("playing");
  });

  it("is disarmed by pause and re-armed by resume", async () => {
    const { controller, errors } = await startOn(new SequencedAudioSink(new StubLegacySink(false), { noProgressTimeoutMs: 4000 }));
    controller.pause();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(errors).toHaveLength(0);
    controller.resume();
    await vi.advanceTimersByTimeAsync(4100);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.origin).toBe("playback");
  });

  it("does nothing for a sink that declares no delay", async () => {
    const { controller, errors } = await startOn(new SequencedAudioSink(new StubLegacySink(false)));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(errors).toHaveLength(0);
    expect(controller.getState()).toBe("playing");
  });

  it("is cleared by stop", async () => {
    const { controller, errors } = await startOn(new SequencedAudioSink(new StubLegacySink(false), { noProgressTimeoutMs: 4000 }));
    controller.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(errors).toHaveLength(0);
    expect(controller.getState()).toBe("stopped");
  });
});
