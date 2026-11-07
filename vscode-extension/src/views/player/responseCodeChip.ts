/**
 * The chip "Code : ignoré / lu" while a reply is read. No `vscode` import. It shows what the
 * next reading will do; a reading under way keeps the text it was given, and the chip says so.
 */

import type { PlaybackState, ResponseCodeChipView } from "../../core/playback.js";

export interface ResponseBeingRead {
  hasCode: boolean;
  /** How this reading was built. */
  codeRead: boolean;
}

const READING_STATES: ReadonlySet<PlaybackState> = new Set<PlaybackState>(["preparing", "buffering", "playing", "paused"]);

export function responseCodeChipOf(
  reading: ResponseBeingRead | undefined,
  nextCodeRead: boolean,
  state: PlaybackState
): ResponseCodeChipView | undefined {
  if (reading === undefined || !reading.hasCode || !READING_STATES.has(state)) {
    return undefined;
  }
  return {
    text: nextCodeRead ? "Code : lu" : "Code : ignoré",
    pressed: nextCodeRead,
    ...(nextCodeRead !== reading.codeRead ? { note: "À la prochaine lecture." } : {})
  };
}
