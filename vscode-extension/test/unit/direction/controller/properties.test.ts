/**
 * Property tests of the partition controller (ADR-015 tests 7 and 10), seeded:
 * a failure is reproducible from the seed printed in its name. Whatever the
 * director answers, the controller never throws, never lets an invariant of
 * the accepted partition break, and the reading always gets a valid partition.
 */
import { describe, expect, it } from "vitest";
import { PartitionSchema } from "../../../../src/core/direction.js";
import {
  PartitionController,
  neutralPartitionForSource,
  type ControllerInput,
  type DirectFn,
  type SourceBlock
} from "../../../../src/direction/controller/index.js";
import { collapseThousands, extractNumbers } from "../../../../src/direction/controller/fidelity.js";
import { DOCUMENT_KEY, makeBible, prng, role, toOralForm } from "./helpers.js";

const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34, 2026, 90210];
const ROUNDS = 40;

const WORDS = ["chat", "lecture", "fichier", "test", "voix", "réseau", "dépôt", "erreur", "branche", "ligne", "cache", "hôte"];
const NEGATIONS = ["ne jamais", "sans", "n'est pas", "aucune", "not", "never", "ne pas"];
const IDENTIFIERS = ["`npm test`", "src/a/B.ts", "parseThing", "SOME_CONST", "--flag", "`x.y`", "CI", "`git push --force`"];
const NUMBERS = ["3", "42", "1,2", "0.3.1", "22 050", "60000", "0600", "127.0.0.1", "1 234 567", "9"];
const IDS = ["s1", "seg-2", "a b/c", "é", "s5", "x.y", "s7", "s8"];
const EXTREMES = [-Number.MAX_VALUE, -1e9, -1, -0.5, 0, 0.3, 0.69999, 0.7, 1, 1.4, 1.41, 3000, 3001, 1e9, Number.MAX_VALUE];
const BIBLE = makeBible([role("marie", { chatterbox: "voice-a" })], role("narrator", { chatterbox: "voice-n" }));

interface Gen {
  readonly random: () => number;
  pick<T>(items: readonly T[]): T;
}

function generator(seed: number): Gen {
  const random = prng(seed);
  return { random, pick: <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T };
}

function randomSource(gen: Gen): SourceBlock[] {
  const count = 1 + Math.floor(gen.random() * 6);
  return Array.from({ length: count }, (_, index) => {
    const id = index === 0 ? "s1" : `${gen.pick(IDS)}${index}`;
    const roll = gen.random();
    if (roll < 0.1) {
      return { id, rawText: " \n ", type: "paragraph" as const };
    }
    if (roll < 0.2) {
      return { id, rawText: `\`\`\`ts\nconst n = ${gen.pick(NUMBERS)};\n\`\`\``, type: "code" as const };
    }
    const parts = Array.from({ length: 3 + Math.floor(gen.random() * 10) }, () => {
      const kind = gen.random();
      return kind < 0.4 ? gen.pick(WORDS) : kind < 0.55 ? gen.pick(NEGATIONS) : kind < 0.75 ? gen.pick(IDENTIFIERS) : gen.pick(NUMBERS);
    });
    return { id, rawText: `${parts.join(" ")}.`, type: "paragraph" as const };
  });
}

function isBlank(block: SourceBlock): boolean {
  return (block.spokenText ?? block.rawText).trim().length === 0;
}

function randomCueText(gen: Gen, covered: readonly SourceBlock[]): string {
  const joined = covered.map((block) => block.spokenText ?? block.rawText).join(" ");
  const roll = gen.random();
  if (roll < 0.35) {
    return joined;
  }
  if (roll < 0.5) {
    return toOralForm(joined);
  }
  if (roll < 0.65) {
    return joined.split(" ").filter(() => gen.random() < 0.6).join(" ") || "x";
  }
  if (roll < 0.75) {
    return `${joined} soit ${gen.pick(["4242", "17", "31337"])} fois`;
  }
  if (roll < 0.85) {
    return gen.pick(["", "   ", "Bonjour.", WORDS.join(" ")]);
  }
  return joined.replace(/\d+/g, "quelques").replace(/\b(ne|n'|pas|jamais|sans|not|never)\b/gi, "");
}

function randomRaw(gen: Gen, blocks: readonly SourceBlock[]): unknown {
  const kind = gen.random();
  if (kind < 0.07) {
    return gen.pick([undefined, null, "texte", 12, [], {}, { cues: null }, { cues: [null, 1, "a"] }, { cues: [{ cueId: 1 }] }]);
  }
  if (kind < 0.45) {
    // A director that does its job, with wild numeric values for the bounds to absorb.
    return {
      cues: blocks
        .filter((block) => !isBlank(block))
        .map((block, index) => ({
          cueId: `c${index}`,
          sourceIds: [block.id],
          speakerId: gen.pick(["narrator", "marie"]),
          spokenText: gen.random() < 0.5 ? (block.spokenText ?? block.rawText) : toOralForm(block.spokenText ?? block.rawText),
          tempo: gen.pick(EXTREMES),
          pauseBeforeMs: gen.pick(EXTREMES),
          pauseAfterMs: gen.pick(EXTREMES),
          emotion: { label: "calme", intensity: gen.pick(EXTREMES) }
        }))
    };
  }
  const count = Math.floor(gen.random() * (blocks.length + 3));
  const cues = Array.from({ length: count }, (_, index) => {
    const covered =
      gen.random() < 0.6 && blocks[index] !== undefined
        ? [blocks[index] as SourceBlock]
        : blocks.filter(() => gen.random() < 0.3);
    const ids = covered.map((block) => block.id);
    if (gen.random() < 0.1) {
      ids.push("ghost");
    }
    const cue: Record<string, unknown> = {
      cueId: gen.random() < 0.06 ? "bad id!" : gen.random() < 0.08 ? "dup" : `c${index}`,
      sourceIds: gen.random() < 0.05 ? [] : ids,
      speakerId: gen.pick(["narrator", "narrator", "marie", "zed", "Bad Id"]),
      spokenText: randomCueText(gen, covered)
    };
    if (gen.random() < 0.4) {
      cue["tempo"] = gen.pick(EXTREMES);
    }
    if (gen.random() < 0.4) {
      cue["pauseBeforeMs"] = gen.pick(EXTREMES);
      cue["pauseAfterMs"] = gen.pick(EXTREMES);
    }
    if (gen.random() < 0.3) {
      cue["emotion"] = { label: "x".repeat(Math.floor(gen.random() * 80)), intensity: gen.pick(EXTREMES) };
    }
    if (gen.random() < 0.2) {
      cue["emphasis"] = ["chat", "absent", ...WORDS].slice(0, Math.floor(gen.random() * 9));
    }
    if (gen.random() < 0.08) {
      cue["voice"] = "voice-x";
    }
    return cue;
  });
  return { cues };
}

/** Digit runs of a text, thousands collapsed, leading zeros dropped (independent of the controller's own helper names). */
function digitRuns(text: string): Set<string> {
  return new Set((text.replace(/(?<![\d.,])(\d{1,3}) (?=\d{3}(?!\d|\.\d))/g, "$1").match(/\d+/g) ?? []).map((run) => run.replace(/^0+(?=\d)/, "")));
}

const controller = new PartitionController();

function inputFor(blocks: readonly SourceBlock[], raw: unknown): ControllerInput {
  return { documentKey: DOCUMENT_KEY, source: blocks, raw, bible: { bible: BIBLE } };
}

describe("property: the neutral partition is always acceptable", () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}`, () => {
      const gen = generator(seed);
      for (let round = 0; round < ROUNDS; round += 1) {
        const blocks = randomSource(gen);
        const neutral = neutralPartitionForSource(blocks, { documentKey: DOCUMENT_KEY, bibleRevision: 0 });
        expect(PartitionSchema.safeParse(neutral).success).toBe(true);
        const verdict = controller.check(inputFor(blocks, neutral));
        expect(verdict.violations, JSON.stringify(blocks)).toEqual([]);
        expect(verdict.accepted).toBe(true);
        for (const block of blocks.filter((item) => !isBlank(item))) {
          expect(neutral.cues.some((cue) => cue.sourceIds.includes(block.id))).toBe(true);
        }
      }
    });
  }
});

const branches = { accepted: 0, rejected: 0 };

describe("property: whatever the director answers", () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: never throws; accepted means every invariant holds; rejected means a usable resend list`, () => {
      const gen = generator(seed);
      for (let round = 0; round < ROUNDS; round += 1) {
        const blocks = randomSource(gen);
        const required = blocks.filter((block) => !isBlank(block));
        const raw = randomRaw(gen, blocks);
        const frozen = structuredClone({ blocks, raw });
        const verdict = controller.check(inputFor(blocks, raw));
        branches[verdict.accepted ? "accepted" : "rejected"] += 1;
        // Pure: inputs untouched, same verdict twice.
        expect(structuredClone({ blocks, raw })).toEqual(frozen);
        expect(controller.check(inputFor(blocks, raw))).toEqual(verdict);

        if (verdict.accepted) {
          const partition = verdict.partition;
          expect(PartitionSchema.safeParse(partition).success).toBe(true);
          for (const block of required) {
            expect(partition.cues.some((cue) => cue.sourceIds.includes(block.id)), `${block.id} covered`).toBe(true);
          }
          expect(new Set(partition.cues.map((cue) => cue.cueId)).size).toBe(partition.cues.length);
          const byId = new Map(blocks.map((block) => [block.id, block] as const));
          partition.cues.forEach((cue, index) => {
            expect(["narrator", "marie"]).toContain(cue.speakerId);
            expect(cue.spokenText.trim().length).toBeGreaterThan(0);
            const allowed = new Set<string>();
            for (const id of cue.sourceIds) {
              const block = byId.get(id);
              expect(block, "cue names a known segment").toBeDefined();
              for (const run of digitRuns(`${block?.rawText ?? ""} ${block?.spokenText ?? ""}`)) {
                allowed.add(run);
              }
            }
            for (const run of digitRuns(cue.spokenText)) {
              expect(allowed.has(run), `digit run ${run} comes from the source`).toBe(true);
            }
            const next = partition.cues[index + 1];
            if (next !== undefined) {
              expect((cue.pauseAfterMs ?? 0) + (next.pauseBeforeMs ?? 0)).toBeLessThanOrEqual(3000);
            }
          });
          expect(verdict.resend).toEqual([]);
        } else {
          expect(verdict.violations.length).toBeGreaterThan(0);
          const requiredIds = new Set(required.map((block) => block.id));
          if (required.length > 0) {
            expect(verdict.resend.length).toBeGreaterThan(0);
          }
          for (const item of verdict.resend) {
            expect(requiredIds.has(item.sourceId)).toBe(true);
            expect(item.reasons.length).toBeGreaterThan(0);
          }
          for (const violation of verdict.violations) {
            expect(violation.sourceIds.every((id) => requiredIds.has(id))).toBe(true);
            if (required.length > 0) {
              expect(violation.sourceIds.length).toBeGreaterThan(0);
            }
          }
        }
        const counted = Object.values(verdict.trace.violations).reduce((sum, count) => sum + (count ?? 0), 0);
        expect(counted).toBe(verdict.violations.length);
      }
    });
  }
});

describe("property: the generators reach both verdicts", () => {
  it("accepts some answers and rejects others", () => {
    expect(branches.accepted).toBeGreaterThan(100);
    expect(branches.rejected).toBeGreaterThan(20);
  });
});

describe("property: a figure dropped from the spoken text is always sent back", () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}`, () => {
      const gen = generator(seed);
      let exercised = 0;
      for (let round = 0; round < ROUNDS * 2; round += 1) {
        const blocks = randomSource(gen);
        const target = blocks.find((block) => block.type === "paragraph" && extractNumbers(block.rawText).length > 0);
        if (target === undefined) {
          continue;
        }
        const first = extractNumbers(target.rawText)[0] ?? "";
        const raw = {
          cues: blocks
            .filter((block) => !isBlank(block))
            .map((block, index) => ({
              cueId: `c${index}`,
              sourceIds: [block.id],
              speakerId: "narrator",
              spokenText: block.id === target.id ? collapseThousands(block.rawText).split(first).join("") || "vide" : block.rawText
            }))
        };
        const verdict = controller.check(inputFor(blocks, raw));
        expect(verdict.accepted).toBe(false);
        expect(verdict.violations.map((violation) => violation.code)).toContain("number-lost");
        expect(verdict.resend.map((item) => item.sourceId)).toContain(target.id);
        exercised += 1;
      }
      expect(exercised).toBeGreaterThan(10);
    });
  }
});

describe("property: the reading always gets a valid, complete partition (test 10)", () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: a flaky director never blocks nor breaks the window`, async () => {
      const gen = generator(seed);
      for (let round = 0; round < ROUNDS; round += 1) {
        const blocks = randomSource(gen);
        const required = blocks.filter((block) => !isBlank(block));
        const maxResends = Math.floor(gen.random() * 4);
        const flaky = new PartitionController({ maxResends, faithful: gen.random() < 0.3 });
        let calls = 0;
        const direct: DirectFn = (request) => {
          calls += 1;
          expect(request.attempt).toBe(calls - 1);
          expect(request.attempt === 0 ? request.resend : [1]).toEqual(request.attempt === 0 ? [] : [1]);
          const roll = gen.random();
          if (roll < 0.15) {
            return Promise.reject(new Error("panne"));
          }
          if (roll < 0.35) {
            return Promise.resolve(randomRaw(gen, blocks));
          }
          if (roll < 0.5) {
            return Promise.resolve(neutralPartitionForSource(blocks, { documentKey: DOCUMENT_KEY, bibleRevision: 0 }));
          }
          return Promise.resolve(randomRaw(gen, blocks));
        };
        const outcome = await flaky.run({ documentKey: DOCUMENT_KEY, source: blocks, bible: { bible: BIBLE } }, direct);
        if (required.length === 0) {
          expect(calls).toBe(0);
        } else {
          expect(calls).toBeGreaterThanOrEqual(1);
          expect(calls).toBeLessThanOrEqual(maxResends + 1);
        }
        expect(PartitionSchema.safeParse(outcome.partition).success).toBe(true);
        for (const block of required) {
          expect(outcome.partition.cues.some((cue) => cue.sourceIds.includes(block.id))).toBe(true);
        }
        if (outcome.kind === "neutral") {
          expect(outcome.partition).toEqual(neutralPartitionForSource(blocks, { documentKey: DOCUMENT_KEY, bibleRevision: 0 }));
          expect(["resend-budget-exhausted", "director-failed"]).toContain(outcome.reason);
          if (outcome.reason === "resend-budget-exhausted") {
            expect(calls).toBe(maxResends + 1);
          }
        } else {
          expect(flaky.check({ documentKey: DOCUMENT_KEY, source: blocks, raw: outcome.partition, bible: { bible: BIBLE } }).accepted).toBe(true);
        }
      }
    });
  }
});
