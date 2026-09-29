/**
 * Shared helpers of the controller tests (not a test file). No fast-check in
 * the tree: property tests use a small seeded PRNG, so a failure is
 * reproducible from the seed printed in its name.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Bible, Fact, Role } from "../../../../src/core/direction.js";
import { numberWords } from "../../../../src/direction/controller/fidelity.js";
import type { SourceBlock } from "../../../../src/direction/controller/PartitionController.js";

export const DOCUMENT_KEY = "a".repeat(64);

/** A row of the narrator fidelity dataset, copied to `fixtures/trapped-texts.jsonl`. */
export interface TrappedText {
  readonly id: string;
  readonly kind: "agent" | "doc";
  readonly text: string;
  readonly mustKeep: ReadonlyArray<{ readonly t: string; readonly priority: string }>;
  readonly negations: ReadonlyArray<{ readonly anchor: string }>;
}

export function loadTrappedTexts(): TrappedText[] {
  return readFileSync(join(__dirname, "fixtures", "trapped-texts.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as TrappedText);
}

/** mulberry32: tiny, deterministic PRNG. */
export function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Same split the dataset script uses: blank-line separated blocks, ids `seg-1`, `seg-2`… */
export function blocksOf(text: string): SourceBlock[] {
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((rawText, index) => ({
      id: `seg-${index + 1}`,
      rawText,
      type: /^```/.test(rawText) ? ("code" as const) : ("paragraph" as const)
    }));
}

/** Digits written out in French, as a director rendering the "spoken form" would. */
export function toOralForm(text: string): string {
  return text.replace(/(?<![\d.,])\d{1,3}(?: \d{3}(?!\d|\.\d))+(?:,\d+)?|\d+(?:[.,]\d+)*/g, (token) => {
    const groups = token.replace(/ /g, "").split(/[.,]/);
    const separator = groups.length === 2 && token.includes(",") ? " virgule " : " point ";
    return ` ${groups.map((group) => numberWords(Number(group))[0] ?? group).join(separator)} `;
  });
}

const AT = "2026-09-29T10:00:00Z";
const fact = (value: string): Fact => ({ value, by: "analyst", at: AT });

export function role(id: string, assignments: Record<string, string> = {}): Role {
  return {
    id,
    names: [id],
    traits: { age: fact("adulte") },
    voice: {
      assignments: Object.fromEntries(Object.entries(assignments).map(([provider, voiceRef]) => [provider, { voiceRef, by: "casting" as const }]))
    }
  };
}

/** A document bible: the narrator plus the given characters. */
export function makeBible(characters: readonly Role[] = [], narrator: Role = role("narrator"), revision = 0): Bible {
  return {
    schemaVersion: "1.0",
    scope: "document",
    scopeKey: "test",
    revision,
    narrator,
    characters
  };
}

/** A director answer that reads each block once, neutrally, with its own text. */
export function cuesFor(blocks: readonly SourceBlock[], text: (block: SourceBlock) => string = (block) => block.spokenText ?? block.rawText): {
  cues: Array<Record<string, unknown>>;
} {
  return {
    cues: blocks.map((block, index) => ({
      cueId: `cue-${index + 1}`,
      sourceIds: [block.id],
      speakerId: "narrator",
      spokenText: text(block)
    }))
  };
}
