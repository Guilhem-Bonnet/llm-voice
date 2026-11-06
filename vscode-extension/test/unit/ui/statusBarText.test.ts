import { describe, expect, it } from "vitest";
import {
  formatStatusBarText,
  formatStatusBarTooltip,
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

  it("renders $(cloud) when a remote provider is active and local mode isn't verified", () => {
    expect(formatStatusBarText({ ...base, isLocalOnly: false, isRemoteProvider: true })).toBe(
      "$(cloud) Professeur technique"
    );
  });

  it("prefers $(lock) over $(cloud) when both are somehow true", () => {
    expect(formatStatusBarText({ ...base, isLocalOnly: true, isRemoteProvider: true })).toBe(
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
    expect(formatStatusBarText({ ...base, state: "buffering" })).toBe("$(sync~spin) Passage suivant…");
  });

  it("shows the step and its seconds during a wait, in place of the state's text", () => {
    const wait = { shortLabel: "Moteur en démarrage…", elapsedSeconds: 12, showElapsed: true };
    expect(formatStatusBarText({ ...base, state: "preparing", wait })).toBe("$(sync~spin) Moteur en démarrage… 12 s");
    expect(formatStatusBarText({ ...base, state: "buffering", wait: { ...wait, shortLabel: "Passage suivant…", showElapsed: false } })).toBe(
      "$(sync~spin) Passage suivant…"
    );
    expect(formatStatusBarTooltip({ ...base, state: "preparing", wait })).toBe("LLM Voice — cliquer pour annuler");
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

describe("formatStatusBarTooltip", () => {
  it("includes the profile label without a voice when none is given (audit 2026-11-05 P1)", () => {
    expect(formatStatusBarTooltip(base)).toBe(
      "LLM Voice — Professeur technique — cliquer pour les actions de lecture"
    );
  });

  it("appends the voice label in parentheses when present — the only persistent confirmation of a voice choice", () => {
    expect(formatStatusBarTooltip({ ...base, voiceLabel: "Chatterbox (qualité maximale)" })).toBe(
      "LLM Voice — Professeur technique (Chatterbox (qualité maximale)) — cliquer pour les actions de lecture"
    );
  });

  it("stays on the dedicated error tooltip, ignoring profile/voice, when state is error", () => {
    expect(formatStatusBarTooltip({ ...base, state: "error", voiceLabel: "Kokoro" })).toBe(
      "LLM Voice : erreur de lecture — cliquer pour reprendre"
    );
  });
});
