/**
 * Pure status bar text formatting (CdC §8, ADR-011). Free of any `vscode`
 * import so it can be unit tested in plain Node; `StatusBar.ts` wires it to
 * a real `StatusBarItem`.
 */

import type { PlaybackState } from "../core/playback.js";

/** Status bar only distinguishes these states; `stopped`/`completed` behave as `idle`. */
export type StatusBarPlaybackState = Extract<
  PlaybackState,
  "idle" | "preparing" | "playing" | "paused" | "stale" | "error"
>;

export interface StatusBarViewModel {
  state: StatusBarPlaybackState;
  /** Label of the active/default profile, e.g. "Professeur technique". */
  profileLabel: string;
  /** Elapsed position in the current chunk, when playing or paused. */
  positionMs?: number;
  /** True when the active profile is verified local-only (ADR-009 niveau 1). */
  isLocalOnly: boolean;
}

export function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Renders the exact texts from ADR-011 for each playback state. */
export function formatStatusBarText(vm: StatusBarViewModel): string {
  const time = formatTime(vm.positionMs ?? 0);
  switch (vm.state) {
    case "idle":
      return vm.isLocalOnly ? `$(lock) ${vm.profileLabel}` : `$(unmute) ${vm.profileLabel}`;
    case "preparing":
      return `$(sync~spin) ${vm.profileLabel}`;
    case "playing":
      return `$(debug-pause) ${time} • ${vm.profileLabel}`;
    case "paused":
      return `$(play) ${time} • ${vm.profileLabel}`;
    case "stale":
      return "$(warning) Document modifié";
    case "error":
      return "$(error) Erreur de lecture";
    default: {
      const exhaustive: never = vm.state;
      return exhaustive;
    }
  }
}

export function formatStatusBarTooltip(vm: StatusBarViewModel): string {
  switch (vm.state) {
    case "error":
      return "LLM Voice : erreur de lecture — cliquer pour reprendre";
    default:
      return "LLM Voice — cliquer pour les actions de lecture";
  }
}
