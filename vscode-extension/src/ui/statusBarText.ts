/**
 * Pure status bar text formatting (CdC §8, ADR-011). Free of any `vscode`
 * import so it can be unit tested in plain Node; `StatusBar.ts` wires it to
 * a real `StatusBarItem`.
 */

import type { PlaybackState } from "../core/playback.js";

/** Status bar only distinguishes these states; `stopped`/`completed` behave as `idle`. */
export type StatusBarPlaybackState = Extract<
  PlaybackState,
  "idle" | "preparing" | "buffering" | "playing" | "paused" | "stale" | "error"
>;

export interface StatusBarViewModel {
  state: StatusBarPlaybackState;
  /** Label of the active/default profile, e.g. "Professeur technique". */
  profileLabel: string;
  /** Elapsed position in the current chunk, when playing or paused. */
  positionMs?: number;
  /** True when the active profile is verified local-only (ADR-009 niveau 1). */
  isLocalOnly: boolean;
  /**
   * True when the active profile's TTS or narrator endpoint resolves off
   * loopback (`verifyLocalMode`'s checks 1/2) but `isLocalOnly` is false —
   * drives the `$(cloud)` idle badge, additive to ADR-011's original
   * `$(lock)`/`$(unmute)` pair.
   */
  isRemoteProvider?: boolean;
  /**
   * Human-facing TTS provider label (`friendlyTtsProviderLabel`), e.g.
   * "Chatterbox (qualité maximale)". Audit 2026-11-05, P1: before this, no
   * persistent surface showed the active provider/voice, only the profile
   * label — a provider change was invisible outside a transitory toast.
   * Kept out of the main status bar text (already tight on space) and shown
   * in the tooltip instead, per the audit's own minimum recommendation.
   */
  voiceLabel?: string;
  /** The wait before the sound, while there is one: wins over the playback state's text. */
  wait?: { shortLabel: string; elapsedSeconds: number; showElapsed: boolean };
}

export function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Renders the exact texts from ADR-011 for each playback state. */
export function formatStatusBarText(vm: StatusBarViewModel): string {
  if (vm.wait !== undefined) {
    const elapsed = vm.wait.showElapsed ? ` ${vm.wait.elapsedSeconds} s` : "";
    return `$(sync~spin) ${vm.wait.shortLabel}${elapsed}`;
  }
  const time = formatTime(vm.positionMs ?? 0);
  switch (vm.state) {
    case "idle":
      if (vm.isLocalOnly) {
        return `$(lock) ${vm.profileLabel}`;
      }
      return vm.isRemoteProvider === true ? `$(cloud) ${vm.profileLabel}` : `$(unmute) ${vm.profileLabel}`;
    case "preparing":
      return `$(sync~spin) ${vm.profileLabel}`;
    case "buffering":
      return "$(sync~spin) Passage suivant…";
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
  const voiceSuffix = vm.voiceLabel !== undefined && vm.voiceLabel.length > 0 ? ` (${vm.voiceLabel})` : "";
  switch (vm.state) {
    case "error":
      return "LLM Voice : erreur de lecture — cliquer pour reprendre";
    case "preparing":
    case "buffering":
      return vm.wait !== undefined
        ? "LLM Voice — cliquer pour annuler"
        : `LLM Voice — ${vm.profileLabel}${voiceSuffix} — cliquer pour les actions de lecture`;
    default:
      return `LLM Voice — ${vm.profileLabel}${voiceSuffix} — cliquer pour les actions de lecture`;
  }
}
