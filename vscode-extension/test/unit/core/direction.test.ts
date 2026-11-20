/**
 * ADR-015 tests 2 ("Compatibilité ascendante", golden) and 3 (safety bounds,
 * property-based) for `src/core/direction.ts`. No fast-check in the tree: the
 * property tests use a small seeded PRNG, so a failure is reproducible from
 * the seed printed in its name.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { AudioChunk, NarrationSegment, SourceSegment, TtsRequest } from "../../../src/core/index.js";
import {
  DIRECTION_BOUNDS,
  DirectionContractError,
  NARRATOR_SPEAKER_ID,
  PartitionSchema,
  RawDirectionOutputSchema,
  baselineTtsRequest,
  boundPartition,
  isNeutralCue,
  narratorSegmentsToNeutralPartition,
  narrationSegmentsToNeutralPartition,
  neutralCue,
  partitionToNarrationSegments,
  partitionToNarratorSegments,
  sourceRangeResolver,
  truncateCodePoints,
  type RawCue,
  type RawDirectionOutput,
  type SynthesisBinding
} from "../../../src/core/direction.js";
import { blockLabel, parseNarration } from "../../../src/narrator/parseNarration.js";
import { faithfulSegment } from "../../../src/narrator/shared.js";
import { AudioQueue, InMemoryAudioCache } from "../../../src/playback/index.js";
import { FakeTtsProvider } from "../../fakes/FakeTtsProvider.js";
import { makeSourceSegments } from "../playback/helpers.js";

const META = { documentKey: "a".repeat(64), bibleRevision: 0 };

// ---------------------------------------------------------------------------
// Test 2: golden compatibility
// ---------------------------------------------------------------------------

/** What `AudioQueue` sends to the engine for these segments and this binding, run for real. */
async function requestsOf(segments: readonly NarrationSegment[], binding: SynthesisBinding): Promise<TtsRequest[]> {
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

function narratedFixture(): { group: SourceSegment[]; faithful: NarrationSegment[]; narrated: NarrationSegment[] } {
  const group = makeSourceSegments(4);
  const faithful = group.map(faithfulSegment);
  const reply = JSON.stringify({
    segments: [
      { sourceIds: [blockLabel(0), blockLabel(1)], spokenText: "  Deux blocs fusionnés en une phrase fluide.  " },
      { sourceIds: [blockLabel(2)], spokenText: "Le troisième, reformulé." }
    ]
  });
  // Block 4 is left uncovered on purpose: parseNarration appends its faithful segment.
  const narrated = [...parseNarration({ raw: reply, group }).result.segments];
  return { group, faithful, narrated };
}

describe("compatibility: neutral partition reproduces today's requests (ADR-015 §9, test 2)", () => {
  const { group, faithful, narrated } = narratedFixture();

  it("the fixture really exercises a merged, a rewritten and a faithful-fallback segment", () => {
    expect(narrated.map((segment) => segment.sourceSegmentIds)).toEqual([["src-0", "src-1"], ["src-2"], ["src-3"]]);
    expect(narrated[0]?.sourceRanges).toHaveLength(2);
  });

  for (const [fixtureName, segments] of [["faithful reading", faithful], ["narrated reading", narrated]] as const) {
    describe(fixtureName, () => {
      const partition = narrationSegmentsToNeutralPartition(segments, META);
      const rebuilt = partitionToNarrationSegments(partition, sourceRangeResolver(group));

      it("yields the same {sourceIds, spokenText} segments", () => {
        expect(partitionToNarratorSegments(partition)).toEqual(
          segments.map((segment) => ({ sourceIds: segment.sourceSegmentIds, spokenText: segment.spokenText }))
        );
      });

      it("yields identical NarrationSegments, field for field (ids, ranges, no metadata)", () => {
        expect(rebuilt).toEqual(segments);
        for (const segment of rebuilt) {
          expect(segment).not.toHaveProperty("metadata");
        }
      });

      it("has neutral cues only, hence no silence segment to enqueue", () => {
        expect(partition.cues.every(isNeutralCue)).toBe(true);
        expect(partition.cues.every((cue) => (cue.pauseBeforeMs ?? 0) === 0 && (cue.pauseAfterMs ?? 0) === 0)).toBe(true);
        expect(partition.cues.every((cue) => cue.speakerId === NARRATOR_SPEAKER_ID && cue.emotion === undefined)).toBe(true);
      });

      it("is a valid partition for the contract", () => {
        expect(PartitionSchema.safeParse(partition).success).toBe(true);
      });

      it.each(BINDINGS)("sends the very same TtsRequest list to the engine (%s)", async (_name, binding) => {
        const today = await requestsOf(segments, binding);
        const viaPartition = await requestsOf(rebuilt, binding);
        expect(today).toHaveLength(segments.length);
        expect(viaPartition).toEqual(today);
        expect(partition.cues.map((cue) => baselineTtsRequest(cue, binding))).toEqual(today);
      });
    });
  }

  it("a narrator contract result converts to a neutral partition and back without loss", () => {
    const contract = [
      { sourceIds: ["s1", "s2"], spokenText: "Premier." },
      { sourceIds: ["s3"], spokenText: "Second." }
    ];
    const partition = narratorSegmentsToNeutralPartition(contract, META);
    expect(partition.cues.map((cue) => cue.cueId)).toEqual(["cue-001", "cue-002"]);
    expect(partitionToNarratorSegments(partition)).toEqual(contract);
    expect(PartitionSchema.safeParse(partition).success).toBe(true);
  });

  it("the neutral cue is exactly the one of ADR-015 §9", () => {
    expect(neutralCue({ cueId: "c1", sourceIds: ["s1"], spokenText: "Texte." })).toEqual({
      cueId: "c1",
      sourceIds: ["s1"],
      speakerId: "narrator",
      spokenText: "Texte.",
      tempo: 1,
      pauseBeforeMs: 0,
      pauseAfterMs: 0
    });
  });

  it("a segment id outside the Core pattern is made safe and unique; sourceIds and text are untouched", () => {
    const segments: NarrationSegment[] = [
      { id: "faithful-a.b", spokenText: "Un.", sourceSegmentIds: ["a.b"], sourceRanges: [] },
      { id: "faithful-a b", spokenText: "Deux.", sourceSegmentIds: ["a b"], sourceRanges: [] },
      { id: "narrated-0", spokenText: "Trois.", sourceSegmentIds: ["c"], sourceRanges: [] }
    ];
    const partition = narrationSegmentsToNeutralPartition(segments, META);
    expect(partition.cues.map((cue) => cue.cueId)).toEqual(["faithful-a_b", "faithful-a_b-2", "narrated-0"]);
    expect(partitionToNarratorSegments(partition)).toEqual(
      segments.map((segment) => ({ sourceIds: segment.sourceSegmentIds, spokenText: segment.spokenText }))
    );
    expect(PartitionSchema.safeParse(partition).success).toBe(true);
  });

  it("a directed cue travels in metadata.direction; the projection keeps only what the old contract carries", () => {
    const directed = { ...neutralCue({ cueId: "c1", sourceIds: ["s1"], spokenText: "Vite !" }), speakerId: "victor", tempo: 1.2 };
    const partition = { ...narratorSegmentsToNeutralPartition([], META), cues: [directed] };
    const [segment] = partitionToNarrationSegments(partition);
    expect(segment?.metadata).toEqual({ direction: directed });
    expect(partitionToNarratorSegments(partition)).toEqual([{ sourceIds: ["s1"], spokenText: "Vite !" }]);
  });

  it("refuses to fabricate a cue from an empty sourceIds or spokenText (the narrator contract forbids both)", () => {
    expect(() => narratorSegmentsToNeutralPartition([{ sourceIds: [], spokenText: "x" }], META)).toThrow(DirectionContractError);
    expect(() => narratorSegmentsToNeutralPartition([{ sourceIds: ["s"], spokenText: "" }], META)).toThrow(DirectionContractError);
  });
});

// ---------------------------------------------------------------------------
// Test 3: safety bounds (property-based, seeded)
// ---------------------------------------------------------------------------

/** mulberry32: tiny, deterministic PRNG. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EXTREMES = [-Number.MAX_VALUE, -1e9, -1000, -1, -0.5, 0, 0.3, 0.69999, 0.7, 1, 1.4, 1.40001, 2.5, 2999.5, 3000, 3000.4, 3001, 1e9, Number.MAX_SAFE_INTEGER, Number.MAX_VALUE];

function generator(seed: number) {
  const random = prng(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const number = (): number => (random() < 0.7 ? pick(EXTREMES) : (random() - 0.5) * 8000);
  const text = (): string => {
    const length = pick([0, 1, 5, 39, 40, 41, 200, 279, 280, 281, 1000]);
    return Array.from({ length }, () => pick(["a", "é", "😀", " ", "字"])).join("");
  };
  const list = <T>(make: () => T): T[] => Array.from({ length: pick([0, 1, 2, 3, 4, 5, 6, 9, 15]) }, make);
  const maybe = <T>(make: () => T): T | undefined => (random() < 0.7 ? make() : undefined);
  const rawCue = (index: number): RawCue => {
    const spokenText = `Texte ${index} avec des mots appuyés et un nombre 42.`;
    const words = spokenText.split(" ");
    const cue: RawCue = { cueId: `cue-${index}`, sourceIds: [`s${index}`], speakerId: pick(["narrator", "marguerite", "victor"]), spokenText };
    const emotion = maybe(() => ({ label: text(), intensity: number(), valence: maybe(number), arousal: maybe(number) }));
    const emphasis = maybe(() => list(() => (random() < 0.6 ? pick(words) : text())));
    const states = maybe(() => list(text));
    const nonverbal = maybe(() => list(() => ({ kind: pick(["breath", "sigh", "laugh", "cough", "hesitation"] as const), at: pick(["before", "after"] as const) })));
    return {
      ...cue,
      ...(emotion !== undefined ? { emotion: { label: emotion.label, intensity: emotion.intensity, ...(emotion.valence !== undefined ? { valence: emotion.valence } : {}), ...(emotion.arousal !== undefined ? { arousal: emotion.arousal } : {}) } } : {}),
      ...withOptional("tempo", maybe(number)),
      ...withOptional("pauseBeforeMs", maybe(number)),
      ...withOptional("pauseAfterMs", maybe(number)),
      ...withOptional("emphasis", emphasis),
      ...withOptional("direction", maybe(text)),
      ...withOptional("states", states),
      ...withOptional("nonverbal", nonverbal)
    };
  };
  const rawOutput = (): RawDirectionOutput => ({ cues: Array.from({ length: pick([0, 1, 2, 3, 8]) }, (_v, index) => rawCue(index)) });
  return { rawOutput, random, pick };
}

function withOptional<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

const ajvValidate = new Ajv2020({ strict: true, strictRequired: false, allErrors: true }).compile(
  JSON.parse(readFileSync(join(resolve(__dirname, "..", "..", "..", ".."), "contracts", "direction-v1", "partition.schema.json"), "utf8"))
);

describe("boundPartition: any raw output ends up inside the ADR-015 §7 bounds (test 3)", () => {
  const b = DIRECTION_BOUNDS;
  const SEEDS = [1, 7, 42, 2026, 92901];

  for (const seed of SEEDS) {
    it(`seed ${seed}: 200 random raw outputs (extreme values, valid types) give bounded, contract-valid partitions`, () => {
      const { rawOutput } = generator(seed);
      for (let run = 0; run < 200; run += 1) {
        const raw = rawOutput();
        expect(RawDirectionOutputSchema.safeParse(raw).success).toBe(true);

        const { partition, report } = boundPartition(raw, META);

        // Contract-valid for Zod AND for the canonical JSON Schema.
        const zod = PartitionSchema.safeParse(partition);
        expect(zod.success, JSON.stringify(zod.error?.issues.slice(0, 2))).toBe(true);
        expect(ajvValidate(partition), JSON.stringify(ajvValidate.errors?.slice(0, 2))).toBe(true);

        partition.cues.forEach((cue, index) => {
          const source = raw.cues[index] as RawCue;
          // Identity fields are never touched.
          expect([cue.cueId, cue.sourceIds, cue.speakerId, cue.spokenText]).toEqual([source.cueId, source.sourceIds, source.speakerId, source.spokenText]);
          if (cue.tempo !== undefined) expect(cue.tempo >= b.tempo.min && cue.tempo <= b.tempo.max).toBe(true);
          for (const pause of [cue.pauseBeforeMs, cue.pauseAfterMs]) {
            if (pause !== undefined) {
              expect(Number.isInteger(pause) && pause >= b.pauseMs.min && pause <= b.pauseMs.max).toBe(true);
            }
          }
          if (cue.emotion !== undefined) {
            expect(cue.emotion.intensity >= 0 && cue.emotion.intensity <= 1).toBe(true);
          }
          for (const word of cue.emphasis ?? []) {
            expect(cue.spokenText.includes(word) && word.length > 0).toBe(true);
          }
          expect((cue.emphasis ?? []).length).toBeLessThanOrEqual(b.emphasisMax);
          const next = partition.cues[index + 1];
          if (next !== undefined) {
            expect((cue.pauseAfterMs ?? 0) + (next.pauseBeforeMs ?? 0)).toBeLessThanOrEqual(b.silenceBetweenCuesMaxMs);
          }
        });

        // Idempotent: bounding an already bounded partition changes nothing and reports nothing.
        const again = boundPartition({ cues: partition.cues as RawCue[] }, META);
        expect(again.report.total).toBe(0);
        expect(again.partition).toEqual(partition);

        // The report is consistent.
        expect(Object.values(report.byField).reduce((sum, count) => sum + count, 0)).toBe(report.total);
      }
    });
  }

  it("a partition already inside the bounds is returned unchanged with an empty report (no gratuitous rewriting)", () => {
    const { random, pick } = generator(5);
    for (let run = 0; run < 200; run += 1) {
      const cues: RawCue[] = [];
      let previousAfter = 0;
      for (let index = 0; index < pick([1, 2, 5]); index += 1) {
        const spokenText = "un deux trois quatre cinq six";
        const before = Math.floor(random() * (b.silenceBetweenCuesMaxMs - previousAfter + 1));
        const after = Math.floor(random() * 3001);
        previousAfter = after;
        cues.push({
          cueId: `c${index}`,
          sourceIds: ["s"],
          speakerId: "narrator",
          spokenText,
          tempo: b.tempo.min + random() * (b.tempo.max - b.tempo.min),
          pauseBeforeMs: before,
          pauseAfterMs: after,
          emotion: { label: "x", intensity: random(), valence: random() * 2 - 1, arousal: random() },
          emphasis: ["un", "trois"].slice(0, Math.floor(random() * 3)),
          direction: "d".repeat(Math.floor(random() * 281)),
          states: ["a", "b"].slice(0, Math.floor(random() * 3))
        });
      }
      const { partition, report } = boundPartition({ cues }, META);
      expect(report).toEqual({ total: 0, byField: {} });
      expect(partition.cues).toEqual(cues);
    }
  });

  it("brings each kind of violation back and counts it, one field at a time", () => {
    const base: RawCue = { cueId: "c1", sourceIds: ["s"], speakerId: "narrator", spokenText: "un deux trois quatre cinq six sept" };
    const run = (cue: Partial<RawCue>) => boundPartition({ cues: [{ ...base, ...cue }] }, META);
    expect(run({ tempo: 9 }).partition.cues[0]?.tempo).toBe(1.4);
    expect(run({ tempo: 0.1 }).partition.cues[0]?.tempo).toBe(0.7);
    expect(run({ pauseBeforeMs: 99999 }).partition.cues[0]?.pauseBeforeMs).toBe(3000);
    expect(run({ pauseAfterMs: -5 }).partition.cues[0]?.pauseAfterMs).toBe(0);
    expect(run({ pauseAfterMs: 250.6 }).partition.cues[0]?.pauseAfterMs).toBe(251);
    expect(run({ emotion: { label: "x", intensity: 7, valence: -7, arousal: 7 } }).partition.cues[0]?.emotion).toEqual({ label: "x", intensity: 1, valence: -1, arousal: 1 });
    expect(run({ emphasis: ["un", "absent", "deux", "trois", "quatre", "cinq", "six"] }).partition.cues[0]?.emphasis).toEqual(["un", "deux", "trois", "quatre", "cinq"]);
    expect(run({ direction: "é".repeat(300) }).partition.cues[0]?.direction).toHaveLength(280);
    expect(run({ states: ["a", "b", "c", "d", "e"] }).partition.cues[0]?.states).toEqual(["a", "b", "c", "d"]);
    expect(run({ nonverbal: [{ kind: "sigh", at: "before" }, { kind: "laugh", at: "after" }, { kind: "cough", at: "after" }] }).partition.cues[0]?.nonverbal).toHaveLength(2);
    expect(run({ tempo: 9, pauseAfterMs: 99999 }).report).toEqual({ total: 2, byField: { tempo: 1, pauseAfterMs: 1 } });
    expect(run({ emphasis: ["absent"] }).report.byField).toEqual({ "emphasis.notSubstring": 1 });
  });

  it("reduces the later pause when two consecutive pauses add up to more than 3 000 ms, and counts it", () => {
    const cue = (id: string, extra: Partial<RawCue>): RawCue => ({ cueId: id, sourceIds: [id], speakerId: "narrator", spokenText: "texte", ...extra });
    const { partition, report } = boundPartition(
      { cues: [cue("a", { pauseAfterMs: 2500 }), cue("b", { pauseBeforeMs: 2000, pauseAfterMs: 3000 }), cue("c", { pauseBeforeMs: 3000 })] },
      META
    );
    expect(partition.cues.map((c) => [c.pauseBeforeMs, c.pauseAfterMs])).toEqual([[undefined, 2500], [500, 3000], [0, undefined]]);
    expect(report.byField).toEqual({ silenceBetweenCues: 2 });
  });

  it("truncates by code points, never inside a surrogate pair", () => {
    expect(truncateCodePoints("😀😀😀", 2)).toBe("😀😀");
    expect(truncateCodePoints("abc", 5)).toBe("abc");
  });
});
