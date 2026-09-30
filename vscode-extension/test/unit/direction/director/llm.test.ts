/** The seam: deadlines that do not depend on the client's cooperation, and the classification of failures. */
import { describe, expect, it } from "vitest";

import { EgressDeniedError } from "../../../../src/net/EgressGuard.js";
import {
  DirectionLlmError,
  FakeDirectionLlm,
  callWithDeadline,
  classifyLlmFailure,
  defaultDirection,
  type DirectionLlmRequest
} from "../../../../src/direction/director/index.js";
import { makeBlocks, sleep, timed } from "./support.js";

const abortError = (): Error => Object.assign(new Error("aborted"), { name: "AbortError" });

describe("callWithDeadline", () => {
  it("settles at the deadline even when the call never settles and ignores the signal", async () => {
    const { ms, value } = await timed(() => callWithDeadline(() => new Promise<string>(() => undefined), 40).catch((e: unknown) => e));
    expect(value).toBeInstanceOf(DirectionLlmError);
    expect((value as DirectionLlmError).reason).toBe("timeout");
    expect(ms).toBeLessThan(400);
  });

  it("rejects with `cancelled` when the caller's signal aborts, and hands the call an aborted signal", async () => {
    const controller = new AbortController();
    let inner: AbortSignal | undefined;
    const pending = callWithDeadline((signal) => {
      inner = signal;
      return new Promise<string>(() => undefined);
    }, 5000, controller.signal).catch((e: unknown) => e);
    await sleep(10);
    controller.abort();
    const error = (await pending) as DirectionLlmError;
    expect(error.reason).toBe("cancelled");
    expect(inner?.aborted).toBe(true);
  });

  it("refuses to start when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    const error = await callWithDeadline(async () => {
      called = true;
      return 1;
    }, 100, controller.signal).catch((e: unknown) => e);
    expect((error as DirectionLlmError).reason).toBe("cancelled");
    expect(called).toBe(false);
  });

  it("returns the value and classifies a plain failure as provider-unavailable", async () => {
    await expect(callWithDeadline(async () => 7, 100)).resolves.toBe(7);
    const error = await callWithDeadline(async () => Promise.reject(new Error("boom")), 100).catch((e: unknown) => e);
    expect((error as DirectionLlmError).reason).toBe("provider-unavailable");
  });
});

describe("classifyLlmFailure", () => {
  it("maps each kind of failure to its reason", () => {
    const aborted = new AbortController();
    aborted.abort();
    expect(classifyLlmFailure(new DirectionLlmError("late"))).toBe("late");
    expect(classifyLlmFailure(new EgressDeniedError("not-loopback", "example.com"))).toBe("egress-denied");
    expect(classifyLlmFailure(abortError())).toBe("timeout");
    expect(classifyLlmFailure(abortError(), aborted.signal)).toBe("cancelled");
    expect(classifyLlmFailure(new TypeError("fetch failed"))).toBe("provider-unavailable");
  });
});

describe("FakeDirectionLlm", () => {
  const request = (count = 2): DirectionLlmRequest => ({
    documentKey: "a".repeat(64),
    attempt: 0,
    resend: [],
    bible: {} as never,
    window: makeBlocks(count).map((b) => ({ id: b.id, text: b.rawText })),
    previous: [],
    previousCues: [],
    following: []
  });

  it("answers with one calm narrator cue per window segment by default, and records the call", async () => {
    const fake = new FakeDirectionLlm();
    const answer = (await fake.direct(request())) as { cues: Array<{ cueId: string; speakerId: string }> };
    expect(answer.cues.map((c) => c.cueId)).toEqual(["cue-seg-1", "cue-seg-2"]);
    expect(answer.cues.every((c) => c.speakerId === "narrator")).toBe(true);
    expect(fake.calls).toHaveLength(1);
    expect(fake.callsOf("analyze")).toHaveLength(0);
    expect(defaultDirection(request(1)).cues).toHaveLength(1);
  });

  it("injects scripted answers, latency and failures by call rank", async () => {
    const fake = new FakeDirectionLlm({
      direction: (info) => ({ scripted: info.index }),
      failure: (info) => (info.index === 1 ? "timeout" : info.index === 2 ? new Error("x") : undefined),
      latencyMs: 15
    });
    expect(await fake.direct(request())).toEqual({ scripted: 0 });
    await expect(fake.direct(request())).rejects.toMatchObject({ reason: "timeout" });
    await expect(fake.direct(request())).rejects.toThrow("x");
  });

  it("cuts its simulated latency and its hang when aborted", async () => {
    const fake = new FakeDirectionLlm({ latencyMs: 5000 });
    const controller = new AbortController();
    const slow = fake.direct(request(), controller.signal).catch((e: unknown) => e);
    controller.abort();
    expect(((await slow) as Error).name).toBe("AbortError");
    const hanging = new FakeDirectionLlm({ failure: () => "hang" });
    const other = new AbortController();
    const pending = hanging.direct(request(), other.signal).catch((e: unknown) => e);
    other.abort();
    expect(((await pending) as Error).name).toBe("AbortError");
  });
});
