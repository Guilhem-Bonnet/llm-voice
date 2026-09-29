/**
 * Engine translator (ADR-015 §5, role 4): validated partition + declared engine
 * capabilities -> synthesis requests and silence segments. Pure, deterministic,
 * no `vscode`, no I/O.
 *
 * - The partition never names an engine parameter; the translator reads
 *   `TtsCapabilities.direction` (ADR-015 §5.2), never an id or `instanceof`.
 *   A dimension the engine does not declare is ignored and counted in the trace.
 * - Every parameter it sets is inside the safety bounds of ADR-015 §7 AND inside
 *   the bounds the engine declares (`TtsCapabilities.parameters`), whatever the
 *   partition holds: the translator re-clamps on its own, it does not rely on
 *   `boundPartition` having run.
 * - A neutral cue yields exactly today's `TtsRequest` (`baselineTtsRequest`),
 *   with no silence segment (ADR-015 §9, test 2).
 * - No style rule: the *choice* of an intensity, a tempo or a pause is the
 *   director's; only linear projections and clamps live here.
 */

import {
  CUE_ID_PATTERN,
  DIRECTION_BOUNDS,
  NARRATOR_SPEAKER_ID,
  baselineTtsRequest,
  clampNumber,
  isNeutralCue,
  silenceSegmentId,
  type Cue,
  type Partition,
  type SynthesisBinding
} from "../../core/direction.js";
import type { SourceRange } from "../../core/source.js";
import type { DirectionCapabilities, TtsCapabilities, TtsParameterDescriptor, TtsRequest } from "../../core/tts.js";
import { silenceMedia, type SilenceFormat, type SilenceMedia } from "./silence.js";

/** The concrete voice of a role for the engine in use (resolved from the bible by the caller). */
export interface VoiceChoice {
  /** Predefined voice id (`TtsRequest.voice`). */
  readonly voice?: string;
  readonly model?: string;
  /**
   * Reference sample of a cloned voice. The engine instance is picked by this
   * value (`Pipeline.ttsFor` registry key): `null` = explicitly none (a
   * predefined voice while the profile clones), absent = the profile's own.
   */
  readonly referenceAudio?: string | null;
  /** Extra engine parameters of this voice, under the profile's and above nothing else. */
  readonly parameters?: Readonly<Record<string, unknown>>;
}

/** Profile-level override of the engine calibration (ADR-015 §5.2: "surchargeable dans le profil"). */
export interface IntensityCalibration {
  readonly neutral?: number;
  readonly safeMax?: number;
}

export interface TranslateOptions {
  /** Engine binding of the session: today's request fields (voice, model, speed, parameters). */
  readonly binding: SynthesisBinding;
  /** `getCapabilities()` of the engine: `direction` and `parameters` (bounds). Absent = voice and pauses only. */
  readonly capabilities?: Pick<TtsCapabilities, "parameters" | "direction">;
  /** Voice of a role; `undefined` = unknown role, the narrator/profile voice is used. */
  readonly voiceFor?: (speakerId: string) => VoiceChoice | undefined;
  /** Highlight ranges of source ids (`sourceRangeResolver`). */
  readonly rangesFor?: (sourceIds: readonly string[]) => readonly SourceRange[];
  readonly intensityCalibration?: IntensityCalibration;
  readonly silence?: { readonly format?: SilenceFormat; readonly sampleRate?: number };
}

export interface SpeechPlanItem {
  readonly kind: "speech";
  /** `cueId`: same pattern as the Core `segmentId`. */
  readonly segmentId: string;
  readonly cueId: string;
  readonly cueIndex: number;
  readonly sourceIds: readonly string[];
  readonly sourceRanges: readonly SourceRange[];
  readonly request: TtsRequest;
  /** `parameters` as the audio cache must hash them (adds the applied `speed`, which today's key ignores). */
  readonly cacheParameters: Readonly<Record<string, unknown>> | undefined;
  /** `voice` as the audio cache must hash it (adds the reference sample when one is used). */
  readonly cacheVoice: string | undefined;
  readonly referenceAudio?: string | null;
  readonly navigable: true;
}

export interface SilencePlanItem {
  readonly kind: "silence";
  /** `<cueId>-pre` / `<cueId>-post` (ADR-015 §5.4). */
  readonly segmentId: string;
  /** The cue that owns this silence; it has no source of its own. */
  readonly cueId: string;
  readonly cueIndex: number;
  readonly position: "pre" | "post";
  readonly durationMs: number;
  readonly sourceIds: readonly [];
  readonly sourceRanges: readonly [];
  readonly media: SilenceMedia;
  readonly navigable: false;
}

export type PlanItem = SpeechPlanItem | SilencePlanItem;

/** Counts only: never a text, a note or a name (ADR-015 §4, "Oubli"). */
export interface TranslationTrace {
  /** Dimensions of the partition the engine cannot carry, by field. */
  readonly ignored: Readonly<Record<string, number>>;
  /** Values brought back inside a bound, by field. */
  readonly adjusted: Readonly<Record<string, number>>;
  /** Cues whose speaker has no voice: read with the narrator's. */
  readonly unknownSpeakers: number;
}

export interface TranslationPlan {
  readonly items: readonly PlanItem[];
  readonly trace: TranslationTrace;
}

class Tally {
  private readonly counts = new Map<string, number>();
  hit(field: string): void {
    this.counts.set(field, (this.counts.get(field) ?? 0) + 1);
  }
  toRecord(): Record<string, number> {
    return Object.fromEntries(this.counts);
  }
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function descriptorFor(
  descriptors: readonly TtsParameterDescriptor[] | undefined,
  name: string
): TtsParameterDescriptor | undefined {
  return descriptors?.find((descriptor) => descriptor.name === name && descriptor.type === "number");
}

/** Clamp into the engine's declared `[min, max]` of a parameter, when it declares one. */
function withinDescriptor(descriptor: TtsParameterDescriptor | undefined, value: number): number {
  return clampNumber(value, descriptor?.min ?? -Infinity, descriptor?.max ?? Infinity);
}

function numberOf(parameters: Readonly<Record<string, unknown>> | undefined, name: string): number | undefined {
  const value = parameters?.[name];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function safeSegmentId(id: string): string {
  return CUE_ID_PATTERN.test(id) ? id : id.replace(/[^A-Za-z0-9_-]/g, "_") || "cue";
}

/** Speech ids are reserved first and never renamed; a derived silence id that collides gets a numeric suffix. */
class SegmentIds {
  private readonly used = new Set<string>();
  reserve(id: string): string {
    return this.take(safeSegmentId(id));
  }
  derive(id: string, tally: Tally): string {
    const taken = this.take(id);
    if (taken !== id) {
      tally.hit("segmentId");
    }
    return taken;
  }
  private take(base: string): string {
    let candidate = base;
    for (let suffix = 2; this.used.has(candidate); suffix += 1) {
      candidate = `${base}-${suffix}`;
    }
    this.used.add(candidate);
    return candidate;
  }
}

function boundedPause(value: number | undefined, tally: Tally, field: string): number {
  const raw = finiteOr(value, 0);
  const bounded = Math.round(clampNumber(raw, DIRECTION_BOUNDS.pauseMs.min, DIRECTION_BOUNDS.pauseMs.max));
  if (bounded !== raw) {
    tally.hit(field);
  }
  return bounded;
}

interface EngineContext {
  readonly direction: DirectionCapabilities | undefined;
  readonly descriptors: readonly TtsParameterDescriptor[] | undefined;
}

function translateSpeech(
  cue: Cue,
  cueIndex: number,
  segmentId: string,
  options: TranslateOptions,
  engine: EngineContext,
  tally: Tally,
  unknownSpeakers: { count: number }
): SpeechPlanItem {
  const { binding } = options;
  const choice = options.voiceFor?.(cue.speakerId);
  if (choice === undefined && cue.speakerId !== NARRATOR_SPEAKER_ID) {
    unknownSpeakers.count += 1;
  }

  // Voice per role: the profile's binding, overridden field by field by the role's voice.
  const voiceBinding: SynthesisBinding = {
    ...binding,
    ...(choice?.voice !== undefined ? { voice: choice.voice } : {}),
    ...(choice?.model !== undefined ? { model: choice.model } : {}),
    ...(choice?.parameters !== undefined ? { parameters: { ...binding.parameters, ...choice.parameters } } : {})
  };
  const base = baselineTtsRequest(cue, voiceBinding);
  const request: Mutable<TtsRequest> = { ...base };
  const parameters: Record<string, unknown> = { ...base.parameters };
  const direction = engine.direction;
  const neutral = isNeutralCue(cue);

  if (!neutral) {
    // Tempo: multiplier of the profile speed, bounded by §7 then by the engine.
    const tempo = finiteOr(cue.tempo, 1);
    const boundedTempo = clampNumber(tempo, DIRECTION_BOUNDS.tempo.min, DIRECTION_BOUNDS.tempo.max);
    if (boundedTempo !== (cue.tempo ?? 1)) {
      tally.hit("tempo");
    }
    if (boundedTempo !== 1) {
      const capability = direction?.tempo;
      if (capability === undefined) {
        tally.hit("ignored:tempo");
      } else {
        const descriptor = descriptorFor(engine.descriptors, capability.parameter);
        const requested = (binding.speed ?? 1) * boundedTempo;
        const engineBounded = withinDescriptor(descriptor, clampNumber(requested, capability.min, capability.max));
        if (engineBounded !== requested) {
          tally.hit("tempo.engine");
        }
        if (capability.parameter === "speed") {
          request.speed = round(engineBounded);
        } else {
          parameters[capability.parameter] = round(engineBounded);
        }
      }
    }

    // Intensity: linear projection between the engine's neutral and its safe ceiling.
    if (cue.emotion !== undefined) {
      const capability = direction?.intensity;
      if (capability === undefined) {
        tally.hit("ignored:emotion");
      } else {
        const rawIntensity = finiteOr(cue.emotion.intensity, 0);
        const intensity = clampNumber(rawIntensity, DIRECTION_BOUNDS.intensity.min, DIRECTION_BOUNDS.intensity.max);
        if (intensity !== cue.emotion.intensity) {
          tally.hit("intensity");
        }
        const descriptor = descriptorFor(engine.descriptors, capability.parameter);
        const neutralValue = finiteOr(
          options.intensityCalibration?.neutral ?? numberOf(base.parameters, capability.parameter),
          capability.neutral
        );
        const safeMax = finiteOr(options.intensityCalibration?.safeMax, capability.safeMax);
        const ceiling = Math.max(neutralValue, safeMax);
        const projected = neutralValue + intensity * (ceiling - neutralValue);
        // Rounded against float noise, but never above the ceiling the rounding could cross.
        parameters[capability.parameter] = withinDescriptor(descriptor, Math.min(round(projected), ceiling));
      }
    }

    // Stability: no cue dimension drives it (ADR-015 §3 has none); the profile's value is only kept in bounds.
    const stability = direction?.stability;
    if (stability !== undefined) {
      const current = numberOf(base.parameters, stability.parameter);
      if (current !== undefined) {
        const descriptor = descriptorFor(engine.descriptors, stability.parameter);
        const bounded = withinDescriptor(descriptor, clampNumber(current, stability.min, stability.max));
        if (bounded !== current) {
          tally.hit("stability");
        }
        parameters[stability.parameter] = bounded;
      }
    }

    // Notes and renderings no current engine carries (instruction rendering is ADR-015 step 9).
    if ((cue.emphasis?.length ?? 0) > 0) {
      tally.hit("ignored:emphasis");
    }
    if (cue.direction !== undefined) {
      tally.hit("ignored:direction");
    }
    if ((cue.states?.length ?? 0) > 0) {
      tally.hit("ignored:states");
    }
    if ((cue.nonverbal?.length ?? 0) > 0) {
      tally.hit("ignored:nonverbal");
    }
  }

  const touched = Object.keys(parameters).length > 0 || base.parameters !== undefined;
  if (touched) {
    request.parameters = parameters;
  }
  const speedApplied = request.speed !== base.speed;
  const cacheParameters = touched || speedApplied ? { ...parameters, ...(speedApplied ? { speed: request.speed } : {}) } : undefined;
  const referenceAudio = choice?.referenceAudio;
  const cacheVoice =
    typeof referenceAudio === "string" && referenceAudio.length > 0
      ? `${request.voice ?? ""}@${referenceAudio}`
      : request.voice;

  return {
    kind: "speech",
    segmentId,
    cueId: cue.cueId,
    cueIndex,
    sourceIds: [...cue.sourceIds],
    sourceRanges: [...(options.rangesFor?.(cue.sourceIds) ?? [])],
    request,
    cacheParameters,
    cacheVoice,
    ...(referenceAudio !== undefined ? { referenceAudio } : {}),
    navigable: true
  };
}

/**
 * Translates cues for one engine. Order of the plan: for every cue, an optional
 * `-pre` silence, the speech, an optional `-post` silence. A pause of 0 ms
 * yields no segment. The silence between two cues (`pauseAfterMs` + next
 * `pauseBeforeMs`) never exceeds 3 000 ms: the later `-pre` is shortened.
 */
export function translateCues(cues: readonly Cue[], options: TranslateOptions): TranslationPlan {
  const tally = new Tally();
  const ids = new SegmentIds();
  const engine: EngineContext = {
    direction: options.capabilities?.direction,
    descriptors: options.capabilities?.parameters
  };
  const speechIds = cues.map((cue) => ids.reserve(cue.cueId));
  const unknownSpeakers = { count: 0 };
  const items: PlanItem[] = [];
  let previousPost = 0;

  cues.forEach((cue, cueIndex) => {
    let pre = boundedPause(cue.pauseBeforeMs, tally, "pauseBeforeMs");
    const post = boundedPause(cue.pauseAfterMs, tally, "pauseAfterMs");
    const room = DIRECTION_BOUNDS.silenceBetweenCuesMaxMs - previousPost;
    if (pre > room) {
      pre = room;
      tally.hit("silenceBetweenCues");
    }
    previousPost = post;

    const speechId = speechIds[cueIndex] ?? cue.cueId;
    const silence = (position: "pre" | "post", durationMs: number): SilencePlanItem => ({
      kind: "silence",
      segmentId: ids.derive(silenceSegmentId(speechId, position), tally),
      cueId: cue.cueId,
      cueIndex,
      position,
      durationMs,
      sourceIds: [],
      sourceRanges: [],
      media: silenceMedia({ durationMs, ...options.silence }),
      navigable: false
    });

    if (pre > 0) {
      items.push(silence("pre", pre));
    }
    items.push(translateSpeech(cue, cueIndex, speechId, options, engine, tally, unknownSpeakers));
    if (post > 0) {
      items.push(silence("post", post));
    }
  });

  const counts = tally.toRecord();
  const ignored: Record<string, number> = {};
  const adjusted: Record<string, number> = {};
  for (const [field, count] of Object.entries(counts)) {
    if (field.startsWith("ignored:")) {
      ignored[field.slice("ignored:".length)] = count;
    } else {
      adjusted[field] = count;
    }
  }
  return { items, trace: { ignored, adjusted, unknownSpeakers: unknownSpeakers.count } };
}

export function translatePartition(partition: Partition, options: TranslateOptions): TranslationPlan {
  return translateCues(partition.cues, options);
}
