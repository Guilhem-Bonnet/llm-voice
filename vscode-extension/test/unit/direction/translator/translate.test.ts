/**
 * ADR-015 step 2: capabilities declared by every provider, and the translator
 * (test 2: a neutral partition is today's requests, field for field; voice per
 * role, bounded intensity and tempo, unsupported dimensions ignored cleanly,
 * silence segments with exact durations and Core-conformant ids).
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  CUE_ID_PATTERN,
  narrationSegmentsToNeutralPartition,
  type SynthesisBinding
} from "../../../../src/core/direction.js";
import type { AudioChunk, NarrationSegment, TtsCapabilities, TtsRequest } from "../../../../src/core/index.js";
import { AudioQueue, InMemoryAudioCache } from "../../../../src/playback/index.js";
import { CHATTERBOX_DIRECTION } from "../../../../src/tts/ChatterboxProvider.js";
import {
  buildSilence,
  silenceDurationMs,
  translateCues,
  translatePartition,
  type SilencePlanItem,
  type SpeechPlanItem
} from "../../../../src/direction/translator/index.js";
import { FakeTtsProvider } from "../../../fakes/FakeTtsProvider.js";
import { makeProfile, makeSegments } from "../../playback/helpers.js";
import type { TtsBinding } from "../../../../src/core/profile.js";
import { withEffectiveVoice } from "../../../../src/profiles/voiceResolution.js";
import { cue, loadRealCapabilities, type RealCapabilities } from "./support.js";

const META = { documentKey: "a".repeat(64), bibleRevision: 0 };

let caps: RealCapabilities;
beforeAll(async () => {
  caps = await loadRealCapabilities();
});

const speech = (items: readonly { kind: string }[]): SpeechPlanItem[] =>
  items.filter((item): item is SpeechPlanItem => item.kind === "speech");
const silences = (items: readonly { kind: string }[]): SilencePlanItem[] =>
  items.filter((item): item is SilencePlanItem => item.kind === "silence");

describe("TtsCapabilities.direction is declared by every provider (ADR-015 §5.2)", () => {
  it("Chatterbox: intensity -> exaggeration, stability -> cfg_weight, no tempo, no notes, GPU", () => {
    expect(caps.chatterbox.direction).toEqual(CHATTERBOX_DIRECTION);
    expect(caps.chatterbox.direction?.tempo).toBeUndefined();
    expect(caps.chatterbox.direction?.instructions).toBe(false);
    expect(caps.chatterbox.direction?.usesGpu).toBe(true);
  });

  it("Piper / espeak-ng / say / SAPI: speed carries the tempo, nothing else, CPU", () => {
    expect(caps.system.direction).toEqual({
      tempo: { parameter: "speed", min: 0.5, max: 2 },
      instructions: false,
      nonverbal: [],
      usesGpu: false
    });
  });

  it("Kokoro declares its speed; a generic OpenAI-compatible engine declares voice and pauses only", () => {
    expect(caps.kokoro.direction?.tempo).toEqual({ parameter: "speed", min: 0.5, max: 2 });
    expect(caps.kokoro.direction?.intensity).toBeUndefined();
    expect(caps.openai.direction).toEqual({ instructions: false, nonverbal: [], usesGpu: true });
  });

  it("every declared parameter exists in `parameters` and the calibration sits inside its declared range", () => {
    for (const [name, capabilities] of Object.entries(caps) as Array<[string, TtsCapabilities]>) {
      const direction = capabilities.direction;
      const descriptor = (parameter: string) =>
        capabilities.parameters.find((candidate) => candidate.name === parameter);
      if (direction?.intensity !== undefined) {
        const declared = descriptor(direction.intensity.parameter);
        expect(declared, `${name}: intensity parameter`).toBeDefined();
        expect(direction.intensity.safeMax).toBeLessThanOrEqual(declared?.max ?? -Infinity);
        expect(direction.intensity.neutral).toBeGreaterThanOrEqual(declared?.min ?? Infinity);
        expect(direction.intensity.neutral).toBeLessThanOrEqual(direction.intensity.safeMax);
      }
      if (direction?.stability !== undefined) {
        const declared = descriptor(direction.stability.parameter);
        expect(declared, `${name}: stability parameter`).toBeDefined();
        expect(direction.stability.min).toBeGreaterThanOrEqual(declared?.min ?? Infinity);
        expect(direction.stability.max).toBeLessThanOrEqual(declared?.max ?? -Infinity);
      }
      if (direction?.tempo !== undefined && direction.tempo.parameter !== "speed") {
        expect(descriptor(direction.tempo.parameter), `${name}: tempo parameter`).toBeDefined();
      }
      if (direction?.tempo?.parameter === "speed") {
        const declared = descriptor("speed");
        expect(declared, `${name}: speed`).toBeDefined();
        expect(direction.tempo.min).toBeGreaterThanOrEqual(declared?.min ?? Infinity);
        expect(direction.tempo.max).toBeLessThanOrEqual(declared?.max ?? -Infinity);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Test 2
// ---------------------------------------------------------------------------

/** What `AudioQueue` sends to the engine for these segments and this binding, run for real. */
async function todaysRequests(segments: readonly NarrationSegment[], binding: SynthesisBinding): Promise<TtsRequest[]> {
  const tts = new FakeTtsProvider();
  const chunks: AudioChunk[] = segments.map((segment, index) => ({
    id: `chunk-${index}`,
    sessionId: "golden",
    spokenText: segment.spokenText,
    sourceRanges: segment.sourceRanges,
    status: "pending"
  }));
  const queue = new AudioQueue({ tts, cache: new InMemoryAudioCache(), binding }, {
    prefetchChunks: segments.length,
    retryJitterMs: 0
  });
  queue.reset(chunks);
  queue.setCursor(0);
  for (let index = 0; index < chunks.length; index += 1) {
    await queue.waitFor(index);
  }
  queue.dispose();
  return [...tts.requests];
}

const BINDINGS: Array<[string, SynthesisBinding]> = [
  ["empty binding", {}],
  ["voice only", { voice: "fake-voice" }],
  [
    "every field of a Chatterbox-style profile",
    {
      language: "fr",
      voice: "voix-femme-2",
      model: "chatterbox-multilingual",
      speed: 1.1,
      format: "wav",
      parameters: { exaggeration: 0.5, cfg_weight: 0.5, temperature: 0.8 }
    }
  ]
];

describe("ADR-017 V12: the session binding comes from the effective voice, the contract does not change", () => {
  const GLOBAL = { providerId: "kyutai-pocket", baseUrl: "http://localhost:8000", voice: "estelle", speed: 1 };
  const segments = makeSegments(3, "narrated-");
  const partition = narrationSegmentsToNeutralPartition(segments, META);

  function bindingOf(tts: TtsBinding): SynthesisBinding {
    const mode = makeProfile({ tts });
    const { voice, parameters } = withEffectiveVoice(mode, GLOBAL).tts;
    return { ...(voice !== undefined ? { voice } : {}), ...(parameters !== undefined ? { parameters } : {}) };
  }

  it("a mode that inherits narrates with the global voice, the neutral partition being today's requests", async () => {
    const binding = bindingOf({});
    expect(binding.voice).toBe("estelle");
    const plan = translatePartition(partition, { binding });
    expect(speech(plan.items).map((item) => item.request)).toEqual(await todaysRequests(segments, binding));
  });

  it("the narrator is the voice of the mode when it has its own", async () => {
    const binding = bindingOf({ providerId: "chatterbox", voice: "propre", parameters: { exaggeration: 0.7 } });
    expect(binding.voice).toBe("propre");
    const plan = translatePartition(partition, { binding });
    expect(speech(plan.items).map((item) => item.request)).toEqual(await todaysRequests(segments, binding));
    expect(speech(plan.items)[0]?.request.voice).toBe("propre");
  });
});

describe("test 2: a neutral partition is today's request list, no silence segment (ADR-015 §9)", () => {
  const segments = makeSegments(5, "narrated-");
  const partition = narrationSegmentsToNeutralPartition(segments, META);

  const engines: Array<[string, () => RealCapabilities[keyof RealCapabilities] | undefined]> = [
    ["Chatterbox", () => caps.chatterbox],
    ["Piper/system", () => caps.system],
    ["Kokoro", () => caps.kokoro],
    ["generic OpenAI-compatible", () => caps.openai],
    ["engine that declares nothing", () => caps.undeclared],
    ["no capabilities at all", () => undefined]
  ];

  for (const [bindingName, binding] of BINDINGS) {
    for (const [engineName, capabilitiesOf] of engines) {
      it(`${bindingName} x ${engineName}`, async () => {
        const capabilities = capabilitiesOf();
        const plan = translatePartition(partition, { binding, ...(capabilities !== undefined ? { capabilities } : {}) });
        const expected = await todaysRequests(segments, binding);

        expect(plan.items.every((item) => item.kind === "speech")).toBe(true);
        expect(speech(plan.items).map((item) => item.request)).toEqual(expected);
        // The audio cache hashes what it hashed before (same voice, same parameters, same id).
        for (const item of speech(plan.items)) {
          expect(item.referenceAudio).toBeUndefined();
        }
        expect(speech(plan.items).map((item) => item.segmentId)).toEqual(segments.map((segment) => segment.id));
        expect(plan.trace).toEqual({ ignored: {}, adjusted: {}, unknownSpeakers: 0 });
      });
    }
  }

  it("a neutral cue is passed through untouched even when the profile holds a value outside the engine's range", () => {
    const binding: SynthesisBinding = { speed: 3, parameters: { exaggeration: 5, cfg_weight: 4 } };
    for (const capabilities of [caps.chatterbox, caps.system]) {
      const plan = translatePartition(partition, { binding, capabilities });
      expect(speech(plan.items).map((item) => item.request)).toEqual(segments.map(() => ({
        text: expect.any(String),
        speed: 3,
        parameters: { exaggeration: 5, cfg_weight: 4 }
      })));
    }
  });

  it("keeps the source ids and resolved ranges of each cue", () => {
    const plan = translatePartition(partition, {
      binding: {},
      rangesFor: (sourceIds) => sourceIds.map((_, index) => ({ startLine: index, startColumn: 0, endLine: index, endColumn: 1 }))
    });
    expect(speech(plan.items).map((item) => item.sourceIds)).toEqual(segments.map((segment) => segment.sourceSegmentIds));
    expect(speech(plan.items)[0]?.sourceRanges).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Voice per role
// ---------------------------------------------------------------------------

describe("voice per role", () => {
  const cues = [
    cue("c1"),
    cue("c2", { speakerId: "marie", pauseBeforeMs: 200 }),
    cue("c3", { speakerId: "inconnu" }),
    cue("c4", { speakerId: "paul" })
  ];
  const voices: Record<string, { voice?: string; referenceAudio?: string | null; model?: string }> = {
    marie: { referenceAudio: "/voix/marie.wav" },
    paul: { voice: "Emily.wav", referenceAudio: null, model: "m2" }
  };

  it("uses the role's voice, falls back to the narrator/profile voice for an unknown speaker, and counts it", () => {
    const binding: SynthesisBinding = { voice: "narrateur.wav", model: "m1", language: "fr" };
    const plan = translateCues(cues, { binding, capabilities: caps.chatterbox, voiceFor: (id) => voices[id] });
    const [c1, c2, c3, c4] = speech(plan.items);
    expect(c1?.request.voice).toBe("narrateur.wav");
    expect(c2?.referenceAudio).toBe("/voix/marie.wav");
    expect(c2?.request.voice).toBe("narrateur.wav");
    expect(c3?.request.voice).toBe("narrateur.wav");
    expect(c3?.referenceAudio).toBeUndefined();
    expect(c4?.request).toMatchObject({ voice: "Emily.wav", model: "m2", language: "fr" });
    expect(c4?.referenceAudio).toBeNull();
    expect(plan.trace.unknownSpeakers).toBe(1);
  });

  it("two roles that share a voice id keep their own reference sample: the engine instance, `tts.id`, identifies a clone in the cache", () => {
    const plan = translateCues([cue("a", { speakerId: "marie" }), cue("b", { speakerId: "paul" })], {
      binding: { voice: "v" },
      voiceFor: (id) => (id === "marie" ? { referenceAudio: "/voix/marie.wav" } : { referenceAudio: "/voix/paul.wav" })
    });
    const [a, b] = speech(plan.items);
    expect(a?.referenceAudio).toBe("/voix/marie.wav");
    expect(b?.referenceAudio).toBe("/voix/paul.wav");
    expect(a?.request.voice).toBe("v");
  });
});

// ---------------------------------------------------------------------------
// Chatterbox: exaggeration and cfg_weight bounded; Piper: speed bounded
// ---------------------------------------------------------------------------

describe("Chatterbox: intensity -> exaggeration, cfg_weight kept in bounds, tempo ignored", () => {
  const binding: SynthesisBinding = { speed: 1, parameters: { exaggeration: 0.5, cfg_weight: 0.5, temperature: 0.8 } };
  const withEmotion = (intensity: number) =>
    cue("x", { emotion: { label: "colère", intensity }, tempo: 1.3, direction: "sèchement", emphasis: ["Texte"] });

  it("projects linearly from the profile's value to the safe ceiling", () => {
    const at = (intensity: number) =>
      speech(translateCues([withEmotion(intensity)], { binding, capabilities: caps.chatterbox }).items)[0]?.request.parameters;
    expect(at(0)?.["exaggeration"]).toBe(0.5);
    expect(at(0.5)?.["exaggeration"]).toBeCloseTo(0.75, 6);
    expect(at(1)?.["exaggeration"]).toBe(CHATTERBOX_DIRECTION.intensity?.safeMax);
    expect(at(1)?.["temperature"]).toBe(0.8);
  });

  it("never exceeds the safe ceiling, whatever the intensity, and counts the adjustment", () => {
    const plan = translateCues([withEmotion(50), withEmotion(-3), withEmotion(Number.NaN)], { binding, capabilities: caps.chatterbox });
    const values = speech(plan.items).map((item) => item.request.parameters?.["exaggeration"] as number);
    expect(values[0]).toBe(1);
    expect(values[1]).toBe(0.5);
    expect(values[2]).toBe(0.5);
    expect(plan.trace.adjusted["intensity"]).toBe(3);
  });

  it("a profile calibration overrides the engine's neutral and ceiling", () => {
    const plan = translateCues([withEmotion(1)], {
      binding,
      capabilities: caps.chatterbox,
      intensityCalibration: { safeMax: 1.4 }
    });
    expect(speech(plan.items)[0]?.request.parameters?.["exaggeration"]).toBe(1.4);
    const beyondEngine = translateCues([withEmotion(1)], {
      binding,
      capabilities: caps.chatterbox,
      intensityCalibration: { safeMax: 9 }
    });
    expect(speech(beyondEngine.items)[0]?.request.parameters?.["exaggeration"]).toBe(2);
  });

  it("keeps the profile's cfg_weight inside the declared range, tempo and notes are ignored and traced", () => {
    const plan = translateCues([withEmotion(0.4)], {
      binding: { parameters: { exaggeration: 0.5, cfg_weight: 4 } },
      capabilities: caps.chatterbox
    });
    const [item] = speech(plan.items);
    expect(item?.request.parameters?.["cfg_weight"]).toBe(1);
    expect(item?.request.speed).toBeUndefined();
    expect(plan.trace.ignored).toEqual({ tempo: 1, direction: 1, emphasis: 1 });
    expect(plan.trace.adjusted["stability"]).toBe(1);
    expect(item?.request.text).toBe("Texte x.");
  });

  it("does not invent parameters the profile does not carry", () => {
    const plan = translateCues([cue("y", { pauseAfterMs: 100 })], { binding: {}, capabilities: caps.chatterbox });
    expect(speech(plan.items)[0]?.request.parameters).toBeUndefined();
  });
});

describe("Piper / system: speed carries the tempo, bounded by the engine; everything else is ignored", () => {
  const styled = (tempo: number) =>
    cue("p", { tempo, emotion: { label: "joie", intensity: 1 }, direction: "avec le sourire", nonverbal: [{ kind: "laugh", at: "after" }] });

  it("multiplies the profile speed by the tempo", () => {
    const plan = translateCues([styled(1.2)], { binding: { speed: 1.5 }, capabilities: caps.system });
    expect(speech(plan.items)[0]?.request.speed).toBeCloseTo(1.8, 6);
    const noProfileSpeed = translateCues([styled(0.8)], { binding: {}, capabilities: caps.system });
    expect(speech(noProfileSpeed.items)[0]?.request.speed).toBeCloseTo(0.8, 6);
  });

  it("brings the speed back inside the engine's range and the tempo inside 0.7-1.4", () => {
    const fast = translateCues([styled(9)], { binding: { speed: 1.9 }, capabilities: caps.system });
    expect(speech(fast.items)[0]?.request.speed).toBe(2);
    expect(fast.trace.adjusted["tempo"]).toBe(1);
    expect(fast.trace.adjusted["tempo.engine"]).toBe(1);
    const slow = translateCues([styled(0.1)], { binding: { speed: 0.6 }, capabilities: caps.system });
    expect(speech(slow.items)[0]?.request.speed).toBe(0.5);
  });

  it("ignores emotion, note and non-verbal cleanly (no parameter appears, traced)", () => {
    const plan = translateCues([styled(1.1)], { binding: {}, capabilities: caps.system });
    const [item] = speech(plan.items);
    expect(item?.request.parameters).toBeUndefined();
    expect(plan.trace.ignored).toEqual({ emotion: 1, direction: 1, nonverbal: 1 });
  });

  it("the applied speed goes in the request, where `AudioQueue` reads it for the key and the synthesis alike", () => {
    const plan = translateCues([styled(1.2), cue("q")], { binding: { speed: 1 }, capabilities: caps.system });
    const [directed, plain] = speech(plan.items);
    expect(directed?.request.speed).toBe(1.2);
    expect(plain?.request.speed).toBe(1);
  });
});

describe("an engine that declares no direction: voice and pauses only", () => {
  it("ignores tempo and emotion, keeps the text, the voice and the pauses", () => {
    const plan = translateCues(
      [cue("z", { tempo: 1.3, emotion: { label: "peur", intensity: 0.9 }, pauseBeforeMs: 250, speakerId: "marie" })],
      { binding: { voice: "v", parameters: { temperature: 0.8 } }, capabilities: caps.undeclared, voiceFor: () => ({ voice: "w" }) }
    );
    const [pre, item] = plan.items as [SilencePlanItem, SpeechPlanItem];
    expect(pre.durationMs).toBe(250);
    expect(item.request).toEqual({ text: "Texte z.", voice: "w", parameters: { temperature: 0.8 } });
    expect(plan.trace.ignored).toEqual({ tempo: 1, emotion: 1 });
  });
});

// ---------------------------------------------------------------------------
// Silence segments
// ---------------------------------------------------------------------------

describe("silence segments (ADR-015 §5.4)", () => {
  const cues = [
    cue("c1", { pauseAfterMs: 800 }),
    cue("c2", { pauseBeforeMs: 300, pauseAfterMs: 0 }),
    cue("c3", { pauseBeforeMs: 1500, pauseAfterMs: 3000 })
  ];

  it("emits `-pre` and `-post` around their speech, only for a non-zero pause, with the exact durations", () => {
    const plan = translateCues(cues, { binding: {} });
    expect(plan.items.map((item) => `${item.kind}:${item.segmentId}`)).toEqual([
      "speech:c1",
      "silence:c1-post",
      "silence:c2-pre",
      "speech:c2",
      "silence:c3-pre",
      "speech:c3",
      "silence:c3-post"
    ]);
    expect(silences(plan.items).map((item) => item.durationMs)).toEqual([800, 300, 1500, 3000]);
  });

  it("gives silences no source of their own and marks them non-navigable", () => {
    const plan = translateCues(cues, { binding: {} });
    for (const item of silences(plan.items)) {
      expect(item.sourceIds).toEqual([]);
      expect(item.sourceRanges).toEqual([]);
      expect(item.navigable).toBe(false);
    }
    expect(speech(plan.items).every((item) => item.navigable)).toBe(true);
  });

  it("every segment id matches the Core v1 segmentId pattern and is unique, even for hostile cue ids", () => {
    const hostile = [
      cue("a", { pauseAfterMs: 100 }),
      cue("a-post", { pauseBeforeMs: 100 }),
      cue("é ü", { pauseBeforeMs: 100 }),
      cue("a-post-2")
    ];
    const plan = translateCues(hostile, { binding: {} });
    const ids = plan.items.map((item) => item.segmentId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(CUE_ID_PATTERN);
    }
    // Speech ids are never renamed to make room for a derived silence id.
    expect(speech(plan.items).map((item) => item.segmentId).slice(0, 2)).toEqual(["a", "a-post"]);
  });

  it("shortens the later `-pre` when the silence between two cues would pass 3 000 ms, and counts it", () => {
    const plan = translateCues([cue("a", { pauseAfterMs: 2500 }), cue("b", { pauseBeforeMs: 2000 })], { binding: {} });
    const durations = silences(plan.items).map((item) => [item.segmentId, item.durationMs]);
    expect(durations).toEqual([["a-post", 2500], ["b-pre", 500]]);
    expect(plan.trace.adjusted["silenceBetweenCues"]).toBe(1);
  });

  it("brings an out-of-range pause back to 0-3 000 ms (integer) and counts it", () => {
    const plan = translateCues(
      [cue("a", { pauseBeforeMs: 99_999, pauseAfterMs: -5 }), cue("b", { pauseBeforeMs: 10.4 })],
      { binding: {} }
    );
    expect(silences(plan.items).map((item) => [item.segmentId, item.durationMs])).toEqual([
      ["a-pre", 3000],
      ["b-pre", 10]
    ]);
    expect(plan.trace.adjusted["pauseBeforeMs"]).toBe(2);
    expect(plan.trace.adjusted["pauseAfterMs"]).toBe(1);
  });

  it("the audio of a silence lasts exactly its duration, as WAV and as pcm16le, at any integer kHz", () => {
    for (const durationMs of [1, 10, 300, 800, 1500, 3000]) {
      for (const sampleRate of [16_000, 22_050 - 50, 24_000, 48_000]) {
        const wav = buildSilence({ durationMs, sampleRate });
        expect(silenceDurationMs(wav, { format: "wav", sampleRate })).toBe(durationMs);
        const pcm = buildSilence({ durationMs, sampleRate, format: "pcm16le" });
        expect(silenceDurationMs(pcm, { format: "pcm16le", sampleRate })).toBe(durationMs);
        expect(pcm.every((byte) => byte === 0)).toBe(true);
      }
    }
    const wav = buildSilence({ durationMs: 300 });
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe("WAVE");
    expect(new DataView(wav.buffer).getUint32(24, true)).toBe(24_000);
  });

  it("the cache key of a silence is duration + format + sample rate, nothing else", () => {
    const plan = translateCues(
      [cue("a", { pauseAfterMs: 500 }), cue("b", { pauseAfterMs: 500 }), cue("c", { pauseAfterMs: 501 })],
      { binding: {} }
    );
    const [a, b, c] = silences(plan.items);
    expect(a?.media.cacheKey).toBe(b?.media.cacheKey);
    expect(a?.media.cacheKey).not.toBe(c?.media.cacheKey);
    const pcm = translateCues([cue("a", { pauseAfterMs: 500 })], { binding: {}, silence: { format: "pcm16le", sampleRate: 16_000 } });
    expect(silences(pcm.items)[0]?.media).toMatchObject({ format: "pcm16le", sampleRate: 16_000, channels: 1 });
    expect(silences(pcm.items)[0]?.media.cacheKey).not.toBe(a?.media.cacheKey);
  });
});
