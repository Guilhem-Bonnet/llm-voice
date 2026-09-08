/**
 * Pure throttle predicate for the `timeupdate` webview -> extension message
 * (ADR-001, D4: throttled to 250 ms). Free of any `vscode` import so it can
 * be unit tested in plain Node; `media/player/player.js` implements the same
 * rule in the webview sandbox (no bundler wires it to this module, so keep
 * both in sync — see the comment there).
 */

/** Interval enforced between two `timeupdate` messages, in milliseconds. */
export const TIMEUPDATE_THROTTLE_MS = 250;

/**
 * Whether enough time elapsed since the last emitted `timeupdate` to emit a
 * new one. `lastEmitMs` of `undefined`/`null` (no prior emission) always
 * allows immediate emission.
 */
export function shouldEmitTimeUpdate(
  nowMs: number,
  lastEmitMs: number | undefined,
  intervalMs: number = TIMEUPDATE_THROTTLE_MS
): boolean {
  if (lastEmitMs === undefined) {
    return true;
  }
  return nowMs - lastEmitMs >= intervalMs;
}
