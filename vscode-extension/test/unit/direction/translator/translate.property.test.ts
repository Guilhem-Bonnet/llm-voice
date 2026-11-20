/**
 * ADR-015 test 3 (property): whatever the raw director output holds (extreme
 * values, valid types), every engine parameter the translator sets is inside
 * the safety bounds of §7 AND inside the bounds the engine declares in
 * `getCapabilities()`; silences are exact and cumulatively bounded; ids are
 * Core-conformant. Seeded PRNG: a failure is reproducible from the seed in its name.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  CUE_ID_PATTERN,
  DIRECTION_BOUNDS,
  RawDirectionOutputSchema,
  boundPartition,
  type Cue,
  type RawCue,
  type SynthesisBinding
} from "../../../../src/core/direction.js";
import type { TtsCapabilities } from "../../../../src/core/tts.js";
import {
  buildSilence,
  silenceDurationMs,
  translateCues,
  type SpeechPlanItem,
  type TranslationPlan
} from "../../../../src/direction/translator/index.js";
import { loadRealCapabilities, mulberry32, type RealCapabilities } from "./support.js";

let caps: RealCapabilities;
beforeAll(async () => {
  caps = await loadRealCapabilities();
});

const EXTREME_NUMBERS = [-1e9, -1, -0.001, 0, 0.001, 0.5, 0.7, 1, 1.4, 2, 10, 2999, 3000, 3001, 1e6, 1e9];
const TEXTS = ["Bonjour.", "Un texte un peu plus long, avec une virgule.", "Oui !", "x"];

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)] as T;
}

function rawCue(random: () => number, index: number): RawCue {
  const maybe = <T>(make: () => T): T | undefined => (random() < 0.7 ? make() : undefined);
  const spokenText = pick(random, TEXTS);
  const emotion = maybe(() => ({
    label: "x".repeat(Math.floor(random() * 120) + 1),
    intensity: pick(random, EXTREME_NUMBERS),
    ...(random() < 0.5 ? { valence: pick(random, EXTREME_NUMBERS) } : {}),
    ...(random() < 0.5 ? { arousal: pick(random, EXTREME_NUMBERS) } : {})
  }));
  const tempo = maybe(() => pick(random, EXTREME_NUMBERS));
  const pauseBeforeMs = maybe(() => pick(random, EXTREME_NUMBERS) + (random() < 0.3 ? random() : 0));
  const pauseAfterMs = maybe(() => pick(random, EXTREME_NUMBERS));
  const emphasis = maybe(() => Array.from({ length: Math.floor(random() * 9) }, () => pick(random, [...TEXTS, "absent"])));
  const direction = maybe(() => "d".repeat(Math.floor(random() * 500)));
  return {
    cueId: `cue-${index}`,
    sourceIds: [`s${index}`],
    speakerId: pick(random, ["narrator", "marie", "paul", "inconnu"]),
    spokenText,
    ...(emotion !== undefined ? { emotion } : {}),
    ...(tempo !== undefined ? { tempo } : {}),
    ...(pauseBeforeMs !== undefined ? { pauseBeforeMs } : {}),
    ...(pauseAfterMs !== undefined ? { pauseAfterMs } : {}),
    ...(emphasis !== undefined ? { emphasis } : {}),
    ...(direction !== undefined ? { direction } : {}),
    ...(random() < 0.3 ? { nonverbal: [{ kind: "sigh" as const, at: "before" as const }] } : {})
  };
}

function randomBinding(random: () => number): SynthesisBinding {
  return {
    language: "fr",
    ...(random() < 0.5 ? { voice: "narrateur" } : {}),
    ...(random() < 0.5 ? { speed: 0.5 + random() * 1.5 } : {}),
    ...(random() < 0.6
      ? {
          parameters: {
            ...(random() < 0.7 ? { exaggeration: random() * 2 } : {}),
            ...(random() < 0.7 ? { cfg_weight: random() } : {}),
            temperature: 0.05 + random() * 1.95
          }
        }
      : {})
  };
}

const speechOf = (plan: TranslationPlan): SpeechPlanItem[] =>
  plan.items.filter((item): item is SpeechPlanItem => item.kind === "speech");

/** The invariants of ADR-015 §7 and of engine bounds, checked on one plan. */
function assertPlan(plan: TranslationPlan, capabilities: TtsCapabilities, cues: readonly Cue[], binding: SynthesisBinding): void {
  const direction = capabilities.direction;
  const speeches = speechOf(plan);
  expect(speeches).toHaveLength(cues.length);

  // Engine parameters: inside what `getCapabilities()` declares.
  for (const item of speeches) {
    for (const [name, value] of Object.entries(item.request.parameters ?? {})) {
      const descriptor = capabilities.parameters.find((candidate) => candidate.name === name);
      if (typeof value === "number" && descriptor?.min !== undefined) {
        expect(value, `${name} >= min`).toBeGreaterThanOrEqual(descriptor.min);
      }
      if (typeof value === "number" && descriptor?.max !== undefined) {
        expect(value, `${name} <= max`).toBeLessThanOrEqual(descriptor.max);
      }
    }
    const exaggeration = item.request.parameters?.["exaggeration"];
    if (typeof exaggeration === "number" && direction?.intensity !== undefined) {
      const profile = binding.parameters?.["exaggeration"];
      const ceiling = Math.max(direction.intensity.safeMax, typeof profile === "number" ? profile : direction.intensity.neutral);
      expect(exaggeration).toBeLessThanOrEqual(ceiling + 1e-9);
    }
    const speed = item.request.speed;
    if (speed !== undefined && speed !== binding.speed) {
      expect(direction?.tempo, "speed is only ever set by a declared tempo").toBeDefined();
      expect(speed).toBeGreaterThanOrEqual(direction?.tempo?.min ?? Infinity);
      expect(speed).toBeLessThanOrEqual(direction?.tempo?.max ?? -Infinity);
      // The tempo multiplier itself stays inside 0.7-1.4 x the profile speed (unless the engine bound tightens it).
      const base = binding.speed ?? 1;
      expect(speed).toBeGreaterThanOrEqual(Math.min(base * DIRECTION_BOUNDS.tempo.min, direction?.tempo?.max ?? Infinity) - 1e-6);
      expect(speed).toBeLessThanOrEqual(Math.max(base * DIRECTION_BOUNDS.tempo.max, direction?.tempo?.min ?? -Infinity) + 1e-6);
    }
    // An engine without tempo never receives one.
    if (direction?.tempo === undefined) {
      expect(item.request.speed).toBe(binding.speed);
    }
    // The spoken text is the cue's, and notes are never synthesised.
    expect(item.request.text).toBe(cues[item.cueIndex]?.spokenText);
  }

  // Silences: exact, bounded, cumulatively bounded, never stray.
  for (const item of plan.items) {
    if (item.kind === "silence") {
      expect(Number.isInteger(item.durationMs)).toBe(true);
      expect(item.durationMs).toBeGreaterThan(0);
      expect(item.durationMs).toBeLessThanOrEqual(DIRECTION_BOUNDS.pauseMs.max);
      const bytes = buildSilence({ durationMs: item.durationMs, sampleRate: item.media.sampleRate, format: item.media.format });
      expect(silenceDurationMs(bytes, item.media)).toBe(item.durationMs);
    }
  }
  // Cumulative silence between two consecutive cues, recomputed from the plan order.
  const post = new Map<number, number>();
  const pre = new Map<number, number>();
  for (const item of plan.items) {
    if (item.kind === "silence") {
      (item.position === "post" ? post : pre).set(item.cueIndex, item.durationMs);
    }
  }
  for (let index = 1; index < cues.length; index += 1) {
    expect((post.get(index - 1) ?? 0) + (pre.get(index) ?? 0)).toBeLessThanOrEqual(DIRECTION_BOUNDS.silenceBetweenCuesMaxMs);
  }

  // Identifiers: Core `segmentId` pattern, unique.
  const ids = plan.items.map((item) => item.segmentId);
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) {
    expect(id).toMatch(CUE_ID_PATTERN);
  }
}

const SEEDS = [1, 7, 42, 2026, 915];

describe("test 3: safety bounds and engine bounds hold on any raw director output", () => {
  for (const seed of SEEDS) {
    it(`raw output -> boundPartition -> translation, seed ${seed} (200 draws x every engine)`, () => {
      const random = mulberry32(seed);
      for (let draw = 0; draw < 200; draw += 1) {
        const rawCues = Array.from({ length: 1 + Math.floor(random() * 6) }, (_, index) => rawCue(random, index));
        const parsed = RawDirectionOutputSchema.parse({ cues: rawCues });
        const { partition } = boundPartition(parsed, { documentKey: "a".repeat(64), bibleRevision: 0 });
        const binding = randomBinding(random);
        for (const capabilities of Object.values(caps) as TtsCapabilities[]) {
          const plan = translateCues(partition.cues, {
            binding,
            capabilities,
            voiceFor: (id) => (id === "marie" ? { referenceAudio: "/v/marie.wav" } : id === "paul" ? { voice: "p" } : undefined)
          });
          assertPlan(plan, capabilities, partition.cues, binding);
        }
      }
    });

    it(`unbounded cues straight into the translator (it clamps on its own), seed ${seed}`, () => {
      const random = mulberry32(seed + 1000);
      const weird = [...EXTREME_NUMBERS, Number.NaN, Infinity, -Infinity];
      for (let draw = 0; draw < 200; draw += 1) {
        const cues: Cue[] = Array.from({ length: 1 + Math.floor(random() * 6) }, (_, index) => ({
          cueId: `c${index}`,
          sourceIds: [`s${index}`],
          speakerId: pick(random, ["narrator", "marie"]),
          spokenText: pick(random, TEXTS),
          emotion: { label: "e", intensity: pick(random, weird) },
          tempo: pick(random, weird),
          pauseBeforeMs: pick(random, weird),
          pauseAfterMs: pick(random, weird)
        }));
        const binding = randomBinding(random);
        for (const capabilities of Object.values(caps) as TtsCapabilities[]) {
          assertPlan(translateCues(cues, { binding, capabilities }), capabilities, cues, binding);
        }
      }
    });
  }
});
