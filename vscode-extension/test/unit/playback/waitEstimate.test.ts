import { describe, expect, it } from "vitest";
import {
  BAR_CAP_PERCENT,
  DEFAULT_MODEL_LOAD_MS,
  WaitTracker,
  estimateWait,
  recordWaitMeasure,
  sanitizeWaitMeasures
} from "../../../src/playback/waitEstimate.js";

const base = { measures: undefined, modelLoaded: true, narrated: false, narrationChars: 0, firstPassagesChars: 0 };

describe("estimateWait", () => {
  it("counts about 8 s for 8 s of audio at first, 15 characters per spoken second", () => {
    expect(estimateWait({ ...base, firstPassagesChars: 120 }).totalMs).toBeCloseTo(8000);
  });

  it("adds 45 s of loading only when the model is not loaded", () => {
    expect(estimateWait({ ...base, modelLoaded: false }).loadMs).toBe(DEFAULT_MODEL_LOAD_MS);
    expect(estimateWait(base).loadMs).toBe(0);
  });

  it("uses the last measured load, less what the server says has already passed", () => {
    const measures = { loadMs: 30_000 };
    expect(estimateWait({ ...base, measures, modelLoaded: false }).loadMs).toBe(30_000);
    expect(estimateWait({ ...base, measures, modelLoaded: false, loadingSinceMs: 10_000 }).loadMs).toBe(20_000);
    expect(estimateWait({ ...base, measures, modelLoaded: false, loadingSinceMs: 90_000 }).loadMs).toBe(0);
  });

  it("leaves the AI's time out until it is measured, and says so", () => {
    const unmeasured = estimateWait({ ...base, narrated: true, narrationChars: 1000 });
    expect(unmeasured.narrationMs).toBe(0);
    expect(unmeasured.narrationCounted).toBe(false);
    const measured = estimateWait({
      ...base,
      narrated: true,
      narrationChars: 1000,
      measures: { narrationMsPerChar: 5 }
    });
    expect(measured.narrationMs).toBe(5000);
    expect(measured.narrationCounted).toBe(true);
  });

  it("does not count the AI at all for a faithful reading", () => {
    const faithful = estimateWait({ ...base, narrationChars: 1000, measures: { narrationMsPerChar: 5 } });
    expect(faithful.narrationMs).toBe(0);
    expect(faithful.narrationCounted).toBe(true);
  });

  it("adds the phases, and a measured speed replaces the starting one", () => {
    const estimate = estimateWait({
      measures: { loadMs: 40_000, narrationMsPerChar: 2, synthesisMsPerChar: 10 },
      modelLoaded: false,
      narrated: true,
      narrationChars: 500,
      firstPassagesChars: 300
    });
    expect(estimate.totalMs).toBe(40_000 + 1000 + 3000);
  });
});

describe("measures", () => {
  it("are a moving average by engine, reused by the next estimate", () => {
    let store = recordWaitMeasure({}, "kyutai-1-6b", "loadMs", 40_000);
    expect(store["kyutai-1-6b"]?.loadMs).toBe(40_000);
    store = recordWaitMeasure(store, "kyutai-1-6b", "loadMs", 50_000);
    expect(store["kyutai-1-6b"]?.loadMs).toBeCloseTo(43_000);
    store = recordWaitMeasure(store, "piper", "synthesisMsPerChar", 3);
    expect(store["piper"]?.loadMs).toBeUndefined();
    expect(estimateWait({ ...base, measures: store["kyutai-1-6b"], modelLoaded: false }).loadMs).toBeCloseTo(43_000);
  });

  it("refuse a nonsensical value", () => {
    const store = recordWaitMeasure({}, "x", "loadMs", 1000);
    expect(recordWaitMeasure(store, "x", "loadMs", Number.NaN)).toBe(store);
    expect(recordWaitMeasure(store, "x", "loadMs", -1)).toBe(store);
    expect(recordWaitMeasure(store, "x", "loadMs", 0)).toBe(store);
  });

  it("never let anything but numbers of known kinds through from storage", () => {
    const clean = sanitizeWaitMeasures({
      kyutai: { loadMs: 40_000, text: "Le manuscrit", narrationMsPerChar: "2", synthesisMsPerChar: -1 },
      other: "Le manuscrit"
    });
    expect(clean).toEqual({ kyutai: { loadMs: 40_000 } });
    expect(JSON.stringify(clean)).not.toContain("manuscrit");
    expect(sanitizeWaitMeasures(undefined)).toEqual({});
  });
});

describe("WaitTracker", () => {
  function tracker(totalMs: number, step: "engine" | "first-passage" = "engine") {
    const clock = { at: 1000 };
    const wait = new WaitTracker(step, { totalMs, narrationCounted: true }, () => clock.at);
    return { clock, wait };
  }

  it("fills on the elapsed time and says about how long remains", () => {
    const { clock, wait } = tracker(20_000);
    expect(wait.view().percent).toBe(0);
    clock.at += 8000;
    const view = wait.view();
    expect(view.percent).toBe(40);
    expect(view.text).toBe("Lecture dans environ 12 s");
    expect(view.valueText).toBe("Démarrage du moteur… Lecture dans environ 12 s");
  });

  it("speaks in minutes beyond one", () => {
    const { wait } = tracker(180_000);
    expect(wait.view().text).toBe("Lecture dans environ 3 min");
  });

  it("stops at 95 % before the sound, then says one moment", () => {
    const { clock, wait } = tracker(10_000);
    clock.at += 12_000;
    const view = wait.view();
    expect(view.percent).toBe(BAR_CAP_PERCENT);
    expect(view.text).toBe("Encore un instant…");
  });

  it("past twice the estimate says slower than usual, and stays under the cap", () => {
    const { clock, wait } = tracker(10_000);
    clock.at += 20_500;
    const view = wait.view();
    expect(view.text).toBe("Plus lent que d'habitude");
    expect(view.percent).toBe(BAR_CAP_PERCENT);
  });

  it("never goes back when the estimate is revised upward", () => {
    const { clock, wait } = tracker(10_000);
    clock.at += 6000;
    expect(wait.view().percent).toBe(60);
    wait.revise("first-passage", { totalMs: 100_000, narrationCounted: true });
    expect(wait.view().percent).toBe(60);
    clock.at += 1000;
    expect(wait.view().percent).toBe(60);
    expect(wait.view().step).toBe("first-passage");
    expect(wait.view().elapsedSeconds).toBe(1);
  });

  it("moves forward when a revision shortens what remains", () => {
    const { clock, wait } = tracker(100_000);
    clock.at += 10_000;
    wait.revise("first-passage", { totalMs: 10_000, narrationCounted: true });
    expect(wait.view().percent).toBe(50);
  });

  it("reaches 100 % only at the first real sound", () => {
    const { clock, wait } = tracker(1000);
    clock.at += 60_000;
    expect(wait.view().percent).toBe(BAR_CAP_PERCENT);
    wait.complete();
    expect(wait.view().percent).toBe(100);
    expect(wait.view().text).toBe("");
  });

  it("announces only at thresholds: the same sentence while the count runs", () => {
    const { clock, wait } = tracker(100_000);
    const first = wait.view().announcement;
    clock.at += 30_000;
    expect(wait.view().announcement).toBe(first);
    expect(first).toBe("Démarrage du moteur…");
    clock.at += 70_000;
    expect(wait.view().announcement).toBe("Encore un instant…");
    clock.at += 110_000;
    expect(wait.view().announcement).toBe("Plus lent que d'habitude");
  });

  it("gives a usual duration and a note only when it has them", () => {
    const clock = { at: 0 };
    const none = new WaitTracker("engine", { totalMs: 1000, narrationCounted: true }, () => clock.at);
    expect(none.view().typicalSeconds).toBeUndefined();
    expect(none.view().note).toBeUndefined();
    const some = new WaitTracker("narration", { totalMs: 1000, narrationCounted: false }, () => clock.at, 45_000);
    expect(some.view().typicalSeconds).toBe(45);
    expect(some.view().note).toBe("Temps de l'IA non compté : pas encore mesuré.");
  });
});
