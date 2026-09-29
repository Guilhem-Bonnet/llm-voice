/**
 * Navigation and highlight over a translation plan (ADR-015 §5.4, test 15).
 *
 * Silences are not cues: "Previous" / "Next" never stop on one, a jump starts at
 * the audio of the target cue (skipping its `-pre`), and a silence has no source
 * of its own. While a `-post` plays the highlight stays on the cue just said;
 * while a `-pre` plays it is already on the cue about to be said. Both are the
 * *owning* cue: `highlightOf` answers with it.
 *
 * `PlaybackController` maps chunks 1:1 to segments and does not know silences
 * yet; this module is the rule it has to apply (see the evidence pack), kept
 * pure so it can be proved against `FakeAudioSink` without touching the player.
 */

import type { PlanItem } from "./translate.js";

/** Same rewind rule as `PlaybackController` (CdC §9): past this offset, "Previous" restarts the cue. */
export const DEFAULT_PREVIOUS_THRESHOLD_MS = 2000;

export interface HighlightState {
  readonly cueIndex: number;
  readonly cueId: string;
  readonly sourceIds: readonly string[];
}

type NavItem = Pick<PlanItem, "kind" | "cueIndex">;

/** Index of the speech item of `cueIndex`: the target of every jump. */
export function speechIndexOfCue(items: readonly NavItem[], cueIndex: number): number | undefined {
  const index = items.findIndex((item) => item.kind === "speech" && item.cueIndex === cueIndex);
  return index === -1 ? undefined : index;
}

/** The cue whose source is highlighted while `index` plays; a silence resolves to its owning cue. */
export function highlightOf(items: readonly PlanItem[], index: number): HighlightState | undefined {
  const item = items[index];
  if (item === undefined) {
    return undefined;
  }
  const speech = items.find((candidate) => candidate.kind === "speech" && candidate.cueIndex === item.cueIndex);
  if (speech === undefined) {
    return undefined;
  }
  return { cueIndex: item.cueIndex, cueId: speech.cueId, sourceIds: speech.sourceIds };
}

/** "Next": the speech of the following cue, never a silence; `undefined` past the last cue. */
export function nextTarget(items: readonly NavItem[], index: number): number | undefined {
  const current = items[index];
  if (current === undefined) {
    return undefined;
  }
  return speechIndexOfCue(items, current.cueIndex + 1);
}

/**
 * "Previous", media-player rule. Playing a cue: within `thresholdMs` go back one
 * cue, later restart this one. On a `-post` the cue was heard: restart it. On a
 * `-pre` it was not heard yet: go back one cue. The first cue restarts itself.
 * Always a speech item, so the `-pre` of the target is skipped.
 */
export function previousTarget(
  items: readonly PlanItem[],
  index: number,
  positionMs: number,
  thresholdMs: number = DEFAULT_PREVIOUS_THRESHOLD_MS
): number | undefined {
  const current = items[index];
  if (current === undefined) {
    return undefined;
  }
  const heard = current.kind === "silence" ? current.position === "post" : positionMs >= thresholdMs;
  const targetCue = heard ? current.cueIndex : current.cueIndex - 1;
  return speechIndexOfCue(items, Math.max(0, targetCue)) ?? speechIndexOfCue(items, current.cueIndex);
}

/**
 * Cursor over a plan, fed by the sink's `started` events. It reports a highlight
 * change only when the owning cue changes, so a `-post` (same cue) emits nothing
 * and a `-pre` moves the highlight ahead of the audio of its cue.
 */
export class PlanCursor {
  private index = 0;
  private highlighted: number | undefined;

  constructor(
    private readonly items: readonly PlanItem[],
    private readonly thresholdMs: number = DEFAULT_PREVIOUS_THRESHOLD_MS
  ) {}

  get currentIndex(): number {
    return this.index;
  }

  get currentItem(): PlanItem | undefined {
    return this.items[this.index];
  }

  /** The sink reports `segmentId` as playing. Returns the new highlight, or `undefined` when it does not move. */
  onStarted(segmentId: string): HighlightState | undefined {
    const index = this.items.findIndex((item) => item.segmentId === segmentId);
    if (index === -1) {
      return undefined;
    }
    this.index = index;
    const cueIndex = this.items[index]?.cueIndex;
    if (cueIndex === undefined || cueIndex === this.highlighted) {
      return undefined;
    }
    this.highlighted = cueIndex;
    return highlightOf(this.items, index);
  }

  next(): PlanItem | undefined {
    const target = nextTarget(this.items, this.index);
    return target === undefined ? undefined : this.items[target];
  }

  previous(positionMs: number): PlanItem | undefined {
    const target = previousTarget(this.items, this.index, positionMs, this.thresholdMs);
    return target === undefined ? undefined : this.items[target];
  }
}
