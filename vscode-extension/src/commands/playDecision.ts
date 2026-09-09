/**
 * S7.3: the decision logic behind `llmVoice.play`/`llmVoice.playPause`,
 * factored out of `Pipeline` (like `src/ui/notifications.ts`) so it is
 * unit-testable in plain Node instead of only through `xvfb` integration
 * tests — `Pipeline.ts` imports `vscode` directly and is excluded from
 * `vitest.config.ts`'s coverage (see that file's comment).
 *
 * Bug this fixes (0.1.0 field report): `Ctrl+Alt+V Space`/`LLM Voice: Play`
 * used to call `PlaybackController.resume()` unconditionally, which is a
 * silent no-op whenever `state !== "paused"` — most commonly *no session was
 * ever started*, so the very first press of the shortcut did nothing at all.
 * `decidePlay`/`decidePlayPause` make every one of those cases produce an
 * observable decision instead.
 */

import type { PlaybackState } from "../core/playback.js";

export interface PlayDecisionInput {
  /** `PlaybackController.getState()` at the moment the command runs. */
  state: PlaybackState;
  /** `vscode.window.activeTextEditor !== undefined`. */
  hasActiveEditor: boolean;
  /** `!activeTextEditor.selection.isEmpty`; irrelevant when `hasActiveEditor` is `false`. */
  hasNonEmptySelection: boolean;
}

export type PlayDecision =
  /** Nothing to do: already playing (or a session is actively preparing/buffering). */
  | { kind: "noop" }
  /** `PlaybackController.pause()`. Only ever returned by `decidePlayPause`. */
  | { kind: "pause" }
  /** `PlaybackController.resume()`: a paused session exists. */
  | { kind: "resume" }
  /** No session (or a finished/stopped/errored one): start reading the selection. */
  | { kind: "startSelection" }
  /** No session (or a finished/stopped/errored one): start reading the whole document. */
  | { kind: "startDocument" }
  /** No session and no editor to read from: nothing to start. */
  | { kind: "noEditor" };

/**
 * A session is actively under way — not paused, not idle/finished. Starting
 * a *new* capture on top of `preparing`/`buffering` would race the one
 * already loading, so both those states resolve to `noop` here, exactly
 * like `playing`.
 */
function isActive(state: PlaybackState): boolean {
  return state === "playing" || state === "preparing" || state === "buffering";
}

/**
 * No usable session right now — `PlaybackController` was never `start()`ed,
 * or the last one finished/stopped/errored. `Play` should not "resume"
 * these; it should start a fresh capture from the active editor.
 */
function isInactive(state: PlaybackState): boolean {
  return !isActive(state) && state !== "paused";
}

function startDecision(input: PlayDecisionInput): PlayDecision {
  if (!input.hasActiveEditor) {
    return { kind: "noEditor" };
  }
  return input.hasNonEmptySelection ? { kind: "startSelection" } : { kind: "startDocument" };
}

/**
 * `LLM Voice: Play` (palette): resumes a paused session, starts a fresh one
 * when idle/stopped/completed/error, and — deliberately — does nothing while
 * already playing (use `Pause`/`Play-Pause` to interrupt).
 */
export function decidePlay(input: PlayDecisionInput): PlayDecision {
  if (isActive(input.state)) {
    return { kind: "noop" };
  }
  if (input.state === "paused") {
    return { kind: "resume" };
  }
  return startDecision(input);
}

/**
 * `Ctrl+Alt+V Space` (ADR-011 "ex. ctrl+alt+v space = Play/Pause"): a genuine
 * toggle — pauses a playing session instead of no-op'ing like `decidePlay`.
 * Every other state resolves exactly like `decidePlay`.
 */
export function decidePlayPause(input: PlayDecisionInput): PlayDecision {
  if (input.state === "playing") {
    return { kind: "pause" };
  }
  if (isActive(input.state)) {
    // preparing/buffering: a session is already loading; let it land instead
    // of racing it with a pause or a brand new capture.
    return { kind: "noop" };
  }
  if (input.state === "paused") {
    return { kind: "resume" };
  }
  return startDecision(input);
}

/** `isInactive` is exported for tests documenting the state grouping directly. */
export { isActive, isInactive };
