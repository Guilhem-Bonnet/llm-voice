/**
 * Des segments et une distribution aux voix par passage (ADR-018 §4.1) : des consignes
 * neutres passent par le traducteur d'ADR-015, et la voix obtenue va dans `metadata.cast`.
 * Le narrateur n'a pas de voix à lui : son passage garde la clé d'aujourd'hui.
 */

import { NARRATOR_SPEAKER_ID, type Cue, type SynthesisBinding } from "../../core/direction.js";
import type { ChunkVoice } from "../../core/playback.js";
import type { NarrationSegment } from "../../core/narration.js";
import { translateCues } from "../translator/translate.js";
import { directionsOf, isSendableDirection } from "./stagePlay.js";

export interface AssignCastOptions {
  readonly binding: SynthesisBinding;
  readonly voiceOf: (speakerId: string) => string | undefined;
  /** The engine plays a written state (`instructions`): only then does a line carry a direction. */
  readonly playsStates?: boolean;
  /**
   * What the stage director added for a state outside the table (already checked against the
   * text), found by the line's speaker and words. Read only where the table gives nothing.
   */
  readonly extraDirectionOf?: (speakerId: string, spokenText: string) => string | undefined;
}

function speakerOf(segment: NarrationSegment): string {
  const speakerId = segment.metadata?.["speakerId"];
  return typeof speakerId === "string" ? speakerId : NARRATOR_SPEAKER_ID;
}

export function assignCast(segments: readonly NarrationSegment[], options: AssignCastOptions): NarrationSegment[] {
  const cues: Cue[] = segments.map((segment) => ({
    cueId: segment.id,
    sourceIds: segment.sourceSegmentIds,
    speakerId: speakerOf(segment),
    spokenText: segment.spokenText
  }));
  const plan = translateCues(cues, {
    binding: options.binding,
    voiceFor: (speakerId) => {
      const voice = speakerId === NARRATOR_SPEAKER_ID ? undefined : options.voiceOf(speakerId);
      return voice !== undefined ? { voice } : undefined;
    }
  });
  const speech = plan.items.filter((item) => item.kind === "speech");
  const directions =
    options.playsStates === true
      ? directionsOf(
          segments.map((segment) => ({ speakerId: speakerOf(segment), states: segment.metadata?.["stage"] as ChunkVoice["stage"] })),
          NARRATOR_SPEAKER_ID
        )
      : [];
  return segments.map((segment, index) => {
    const extra = options.playsStates === true && speakerOf(segment) !== NARRATOR_SPEAKER_ID ? options.extraDirectionOf?.(speakerOf(segment), segment.spokenText) : undefined;
    const direction = directions[index] ?? (extra !== undefined && isSendableDirection(extra) ? extra : undefined);
    const voice = speech[index]?.request.voice;
    const speakerId = speakerOf(segment);
    const stage = segment.metadata?.["stage"] as ChunkVoice["stage"];
    const cast: ChunkVoice = {
      speakerId,
      ...(speakerId !== NARRATOR_SPEAKER_ID && voice !== undefined && voice !== options.binding.voice ? { voice } : {}),
      ...(stage !== undefined ? { stage } : {}),
      ...(direction !== undefined ? { direction } : {})
    };
    return { ...segment, metadata: { ...segment.metadata, cast } };
  });
}
