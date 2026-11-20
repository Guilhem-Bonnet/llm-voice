/** GAO-qwen3-dans-l-001: the bar of a whole-reading preparation counts passages, never time. */
import { describe, expect, it } from "vitest";
import { BAR_CAP_PERCENT, WaitTracker } from "../../../src/playback/waitEstimate.js";

describe("the wait of a whole-reading preparation", () => {
  it("shows passages ready out of the total, whatever the clock says", () => {
    let now = 0;
    const wait = new WaitTracker("whole-reading", { totalMs: 1000, narrationCounted: true }, () => now);
    wait.setPassages(0, 8);
    now = 60_000;
    expect(wait.view()).toMatchObject({ step: "whole-reading", label: "Préparation de toute la lecture…", percent: 0, text: "0 passages prêts sur 8" });
    wait.setPassages(4, 8);
    expect(wait.view()).toMatchObject({ percent: 50, text: "4 passages prêts sur 8" });
    expect(wait.view().text).not.toMatch(/lent/);
  });

  it("never reaches 100 before the sound, then does", () => {
    const wait = new WaitTracker("whole-reading", { totalMs: 1000, narrationCounted: true }, () => 0);
    wait.setPassages(8, 8);
    expect(wait.view().percent).toBe(BAR_CAP_PERCENT);
    wait.complete();
    expect(wait.view()).toMatchObject({ percent: 100, text: "" });
  });
});
