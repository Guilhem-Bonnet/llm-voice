import { describe, expect, it } from "vitest";
import { TIMEUPDATE_THROTTLE_MS, shouldEmitTimeUpdate } from "../../../src/views/player/timeupdate.js";

describe("shouldEmitTimeUpdate", () => {
  it("always allows the first emission", () => {
    expect(shouldEmitTimeUpdate(1000, undefined)).toBe(true);
  });

  it("blocks emission strictly inside the throttle window", () => {
    expect(shouldEmitTimeUpdate(1100, 1000, 250)).toBe(false);
  });

  it("allows emission exactly at the throttle boundary", () => {
    expect(shouldEmitTimeUpdate(1250, 1000, 250)).toBe(true);
  });

  it("allows emission past the throttle boundary", () => {
    expect(shouldEmitTimeUpdate(2000, 1000, 250)).toBe(true);
  });

  it("defaults to the D4 250ms interval", () => {
    expect(TIMEUPDATE_THROTTLE_MS).toBe(250);
    expect(shouldEmitTimeUpdate(1249, 1000)).toBe(false);
    expect(shouldEmitTimeUpdate(1250, 1000)).toBe(true);
  });
});
