import { describe, expect, it } from "vitest";
import {
  formatStatusBarText,
  formatTime,
  type StatusBarViewModel
} from "../../../src/ui/statusBarText.js";

const base: StatusBarViewModel = {
  state: "idle",
  profileLabel: "Professeur technique",
  isLocalOnly: false
};

describe("formatTime", () => {
  it("formats milliseconds as mm:ss", () => {
    expect(formatTime(192000)).toBe("03:12");
  });

  it("clamps negative durations to zero", () => {
    expect(formatTime(-500)).toBe("00:00");
  });
});

describe("formatStatusBarText", () => {
  it("renders the idle text (ADR-011)", () => {
    expect(formatStatusBarText(base)).toBe("$(unmute) Professeur technique");
  });

  it("renders $(lock) instead of $(unmute) when local mode is verified", () => {
    expect(formatStatusBarText({ ...base, isLocalOnly: true })).toBe(
      "$(lock) Professeur technique"
    );
  });

  it("renders the playing text with elapsed time (ADR-011)", () => {
    expect(
      formatStatusBarText({ ...base, state: "playing", positionMs: 192000 })
    ).toBe("$(debug-pause) 03:12 • Professeur technique");
  });

  it("renders the paused text with elapsed time (ADR-011)", () => {
    expect(
      formatStatusBarText({ ...base, state: "paused", positionMs: 192000 })
    ).toBe("$(play) 03:12 • Professeur technique");
  });

  it("renders the buffering text (ADR-005's reported-to-phase-4 gap, S4.2)", () => {
    expect(formatStatusBarText({ ...base, state: "buffering" })).toBe("⏳ Buffering…");
  });

  it("renders the stale text regardless of profile (D6, ADR-011)", () => {
    expect(formatStatusBarText({ ...base, state: "stale" })).toBe(
      "$(warning) Document modifié"
    );
  });

  it("renders an error text", () => {
    expect(formatStatusBarText({ ...base, state: "error" })).toBe(
      "$(error) Erreur de lecture"
    );
  });
});
