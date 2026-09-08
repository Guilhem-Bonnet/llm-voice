/**
 * `SessionFactory`: turns source segments into the narration segments the
 * player reads.
 *
 * Two modes. Faithful reading (no narrator, or `mode: "faithful"`) maps source
 * segments 1:1 and resolves immediately. Narrated reading calls the narrator by
 * groups of blocks: `buildSession` awaits the *first* group only and returns,
 * so playback starts while the rest is still being rewritten (CdC §63). Later
 * groups are appended through `onSegmentsAppended`, which is what
 * `PlaybackController.appendSegments()` consumes.
 *
 * Per ADR-005 the narrator never rejects: it reports `degraded: true`. When it
 * does — or returns nothing usable — this factory ignores its output for that
 * group and falls back to the faithful 1:1 mapping, emitting `onWarning`.
 * Narration failure must never stop the audio.
 */

import type {
  NarrationDegradedReason,
  NarrationRequest,
  NarrationSegment,
  NarratorProvider
} from "../core/narration.js";
import type { VoiceProfile } from "../core/profile.js";
import type { SourceSegment } from "../core/source.js";
import { Emitter, type Unsubscribe } from "./emitter.js";

/** Default number of source segments handed to the narrator per call (CdC §33). */
const DEFAULT_GROUP_SIZE = 4;

/** Tunables of one session build. */
export interface SessionBuildOptions {
  /** Source segments per narrator call; smaller means audio starts sooner. */
  groupSize?: number;
  /** Cancels narration of the groups not yet started (CdC §62). */
  signal?: AbortSignal;
  /**
   * Warning hook wired *before* the first group is narrated. `onWarning` on the
   * returned build can only observe later groups, since the first one has
   * already been decided by the time `buildSession` resolves.
   */
  onWarning?: (warning: NarrationWarning) => void;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

/** One group that fell back to faithful reading, surfaced to the user. */
export interface NarrationWarning {
  groupIndex: number;
  reason: NarrationDegradedReason;
  segmentIds: readonly string[];
}

/** Result of `buildSession`: the first group, plus what is still coming. */
export interface SessionBuild {
  /** Segments known so far; grows as later groups are narrated. */
  readonly segments: readonly NarrationSegment[];
  /** Resolves with the full list once every group is done or cancelled. */
  readonly completion: Promise<readonly NarrationSegment[]>;
  /** True as soon as any group fell back to faithful reading. */
  readonly degraded: boolean;
  onSegmentsAppended(
    listener: (added: readonly NarrationSegment[]) => void
  ): Unsubscribe;
  onWarning(listener: (warning: NarrationWarning) => void): Unsubscribe;
  /** Stops narrating the remaining groups; already built segments are kept. */
  cancel(): void;
  /**
   * CdC §52 "Read without narration": once called, every group not yet
   * dispatched to the narrator (the current session only — a fresh
   * `buildSession()` call, e.g. from Retry, starts un-forced again) falls
   * back to the faithful 1:1 mapping without ever calling
   * `NarratorProvider.transform()` again. Idempotent, and safe to call
   * before, during, or after the whole session has finished narrating.
   */
  forceFaithful(): void;
}

class SessionBuildImpl implements SessionBuild {
  readonly appended = new Emitter<readonly NarrationSegment[]>();
  readonly warned = new Emitter<NarrationWarning>();
  readonly built: NarrationSegment[] = [];
  degraded = false;
  forced = false;
  completion: Promise<readonly NarrationSegment[]> = Promise.resolve([]);

  constructor(
    private readonly controller: AbortController,
    private readonly warnSink: ((warning: NarrationWarning) => void) | undefined
  ) {}

  get segments(): readonly NarrationSegment[] {
    return this.built;
  }

  forceFaithful(): void {
    this.forced = true;
  }

  onSegmentsAppended(
    listener: (added: readonly NarrationSegment[]) => void
  ): Unsubscribe {
    return this.appended.on(listener);
  }

  onWarning(listener: (warning: NarrationWarning) => void): Unsubscribe {
    return this.warned.on(listener);
  }

  cancel(): void {
    this.controller.abort();
  }

  push(added: readonly NarrationSegment[]): void {
    this.built.push(...added);
    this.appended.emit(added);
  }

  warn(warning: NarrationWarning): void {
    this.degraded = true;
    this.warnSink?.(warning);
    this.warned.emit(warning);
  }
}

/**
 * Builds the reading session. Resolves as soon as the first group is ready;
 * the remaining groups keep narrating in the background.
 */
export async function buildSession(
  segments: readonly SourceSegment[],
  profile: VoiceProfile,
  narrator?: NarratorProvider,
  options: SessionBuildOptions = {}
): Promise<SessionBuild> {
  const controller = new AbortController();
  if (options.signal?.aborted === true) {
    controller.abort();
  } else {
    options.signal?.addEventListener("abort", () => controller.abort(), {
      once: true
    });
  }
  const build = new SessionBuildImpl(controller, options.onWarning);

  const narrationEnabled = profile.mode === "narrated" && narrator !== undefined;
  if (!narrationEnabled) {
    build.push(segments.map(toFaithfulSegment));
    build.completion = Promise.resolve(build.segments);
    return build;
  }

  const groups = groupBy(segments, Math.max(1, options.groupSize ?? DEFAULT_GROUP_SIZE));
  if (groups.length === 0) {
    build.completion = Promise.resolve(build.segments);
    return build;
  }

  await narrateGroup(build, groups[0] as SourceSegment[], 0, profile, narrator, options, controller);

  build.completion = (async () => {
    for (let index = 1; index < groups.length; index++) {
      if (controller.signal.aborted) {
        break;
      }
      await narrateGroup(
        build,
        groups[index] as SourceSegment[],
        index,
        profile,
        narrator,
        options,
        controller
      );
    }
    return build.segments;
  })();
  return build;
}

async function narrateGroup(
  build: SessionBuildImpl,
  group: readonly SourceSegment[],
  groupIndex: number,
  profile: VoiceProfile,
  narrator: NarratorProvider,
  options: SessionBuildOptions,
  controller: AbortController
): Promise<void> {
  if (controller.signal.aborted) {
    fallback(build, group, groupIndex, "cancelled");
    return;
  }
  if (build.forced) {
    fallback(build, group, groupIndex, "user-disabled");
    return;
  }

  const request: NarrationRequest = {
    segments: group,
    profileId: profile.id,
    language: profile.language,
    mode: profile.mode,
    outputContract: "narration-segments",
    ...(profile.style !== undefined ? { style: profile.style } : {}),
    ...(options.maxOutputTokens !== undefined
      ? { maxOutputTokens: options.maxOutputTokens }
      : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
  };

  try {
    const result = await narrator.transform(request, controller.signal);
    if (result.degraded || result.segments.length === 0) {
      fallback(
        build,
        group,
        groupIndex,
        result.degradedReason ?? "invalid-structured-output"
      );
      return;
    }
    build.push(result.segments);
  } catch {
    // The contract says `transform` resolves rather than rejects; a provider
    // that breaks it must still not stop the audio (ADR-005).
    fallback(build, group, groupIndex, "provider-unavailable");
  }
}

function fallback(
  build: SessionBuildImpl,
  group: readonly SourceSegment[],
  groupIndex: number,
  reason: NarrationDegradedReason
): void {
  build.warn({
    groupIndex,
    reason,
    segmentIds: group.map((segment) => segment.id)
  });
  build.push(group.map(toFaithfulSegment));
}

/** Verbatim reading: one source segment becomes one narration segment. */
function toFaithfulSegment(segment: SourceSegment): NarrationSegment {
  return {
    id: `faithful-${segment.id}`,
    spokenText: segment.spokenText ?? segment.rawText,
    sourceSegmentIds: [segment.id],
    sourceRanges: segment.sourceRange ? [segment.sourceRange] : []
  };
}

function groupBy<T>(items: readonly T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}
