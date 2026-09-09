import { describe, expect, it } from "vitest";
import { decidePlay, decidePlayPause, type PlayDecisionInput } from "../../../src/commands/playDecision.js";
import type { PlaybackState } from "../../../src/core/playback.js";

function input(overrides: Partial<PlayDecisionInput> = {}): PlayDecisionInput {
  return {
    state: "idle",
    hasActiveEditor: true,
    hasNonEmptySelection: false,
    ...overrides
  };
}

describe("decidePlay (S7.3, field bug: 'Play' used to no-op without a session)", () => {
  it("starts the active document when there is no session (idle) and no selection", () => {
    expect(decidePlay(input({ state: "idle" }))).toEqual({ kind: "startDocument" });
  });

  it("starts the selection instead of the whole document when one is non-empty", () => {
    expect(decidePlay(input({ state: "idle", hasNonEmptySelection: true }))).toEqual({
      kind: "startSelection"
    });
  });

  it("reports 'noEditor' when there is no session and no active editor to read from", () => {
    expect(decidePlay(input({ state: "idle", hasActiveEditor: false }))).toEqual({ kind: "noEditor" });
  });

  it("resumes a paused session instead of starting a new one", () => {
    expect(decidePlay(input({ state: "paused" }))).toEqual({ kind: "resume" });
  });

  it("does nothing while already playing", () => {
    expect(decidePlay(input({ state: "playing" }))).toEqual({ kind: "noop" });
  });

  it.each<PlaybackState>(["stopped", "completed", "error", "stale"])(
    "starts a fresh capture from a finished/stopped/errored session (%s)",
    (state) => {
      expect(decidePlay(input({ state }))).toEqual({ kind: "startDocument" });
    }
  );

  it.each<PlaybackState>(["preparing", "buffering"])(
    "does nothing while a session is already loading (%s), to avoid racing it",
    (state) => {
      expect(decidePlay(input({ state }))).toEqual({ kind: "noop" });
    }
  );
});

describe("decidePlayPause (Ctrl+Alt+V Space, ADR-011 'ctrl+alt+v space = Play/Pause')", () => {
  it("pauses instead of no-op'ing while playing", () => {
    expect(decidePlayPause(input({ state: "playing" }))).toEqual({ kind: "pause" });
  });

  it("resumes a paused session, same as decidePlay", () => {
    expect(decidePlayPause(input({ state: "paused" }))).toEqual({ kind: "resume" });
  });

  it("starts the active document when there is no session", () => {
    expect(decidePlayPause(input({ state: "idle" }))).toEqual({ kind: "startDocument" });
  });

  it("starts the selection when there is no session and one is non-empty", () => {
    expect(decidePlayPause(input({ state: "stopped", hasNonEmptySelection: true }))).toEqual({
      kind: "startSelection"
    });
  });

  it("reports 'noEditor' when there is no session and no active editor", () => {
    expect(decidePlayPause(input({ state: "idle", hasActiveEditor: false }))).toEqual({ kind: "noEditor" });
  });

  it.each<PlaybackState>(["preparing", "buffering"])(
    "does nothing while a session is already loading (%s)",
    (state) => {
      expect(decidePlayPause(input({ state }))).toEqual({ kind: "noop" });
    }
  );
});
