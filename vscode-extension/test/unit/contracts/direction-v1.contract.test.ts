/**
 * ADR-015 test 1 ("Contrat"): every example under
 * `contracts/direction-v1/examples/` is accepted or rejected exactly as
 * `examples/manifest.json` says, by BOTH the canonical JSON Schema files
 * (ajv, draft 2020-12) and their Zod twin in `src/core/direction.ts`, so a
 * drift between the two is a test failure. Same discipline as
 * `core-v1.contract.test.ts`.
 *
 * Two layers of verdict (see the manifest description): `schema` examples
 * must be rejected by ajv AND Zod; `semantic` examples must pass both schemas
 * and be rejected by `checkPartition` / `checkBible` (rules that JSON Schema
 * cannot express: unknown speaker, duplicate ids, narrator voice reused).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import { describe, expect, it } from "vitest";
import {
  BibleSchema,
  CUE_ID_PATTERN,
  DIRECTION_BOUNDS,
  DOCUMENT_KEY_PATTERN,
  PartitionSchema,
  RFC3339_DATE_TIME_PATTERN,
  ROLE_ID_PATTERN,
  checkBible,
  checkPartition,
  silenceSegmentId,
  type Bible,
  type Partition
} from "../../../src/core/direction.js";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const CONTRACT_ROOT = join(REPO_ROOT, "contracts", "direction-v1");
const EXAMPLES_ROOT = join(CONTRACT_ROOT, "examples");

type Kind = "partition" | "bible" | "pair";

interface ManifestEntry {
  file: string;
  kind: Kind;
  valid: boolean;
  layer?: "schema" | "semantic";
  reason?: string;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

const partitionSchemaJson = readJson(join(CONTRACT_ROOT, "partition.schema.json")) as Record<string, unknown>;
const bibleSchemaJson = readJson(join(CONTRACT_ROOT, "bible.schema.json")) as Record<string, unknown>;
const manifest = readJson(join(EXAMPLES_ROOT, "manifest.json")) as { examples: ManifestEntry[] };

const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
const ajvPartition: ValidateFunction = ajv.compile(partitionSchemaJson);
const ajvBible: ValidateFunction = ajv.compile(bibleSchemaJson);

interface Verdict {
  schemaOk: boolean;
  semanticIssues: number;
}

/** Verdict of one example under one engine; semantic checks are shared code. */
function judge(engine: "ajv" | "zod", kind: Kind, doc: unknown): Verdict {
  const parsePartition = (value: unknown): Partition | undefined => {
    if (engine === "ajv") {
      return ajvPartition(value) ? (value as Partition) : undefined;
    }
    const parsed = PartitionSchema.safeParse(value);
    return parsed.success ? (parsed.data as Partition) : undefined;
  };
  const parseBible = (value: unknown): Bible | undefined => {
    if (engine === "ajv") {
      return ajvBible(value) ? (value as Bible) : undefined;
    }
    const parsed = BibleSchema.safeParse(value);
    return parsed.success ? (parsed.data as Bible) : undefined;
  };

  if (kind === "partition") {
    const partition = parsePartition(doc);
    return partition === undefined
      ? { schemaOk: false, semanticIssues: 0 }
      : { schemaOk: true, semanticIssues: checkPartition(partition).length };
  }
  if (kind === "bible") {
    const bible = parseBible(doc);
    return bible === undefined
      ? { schemaOk: false, semanticIssues: 0 }
      : { schemaOk: true, semanticIssues: checkBible(bible).length };
  }
  const pair = doc as { bible: unknown; partition: unknown };
  const bible = parseBible(pair.bible);
  const partition = parsePartition(pair.partition);
  if (bible === undefined || partition === undefined) {
    return { schemaOk: false, semanticIssues: 0 };
  }
  return { schemaOk: true, semanticIssues: checkBible(bible).length + checkPartition(partition, bible).length };
}

const valid = manifest.examples.filter((entry) => entry.valid);
const invalid = manifest.examples.filter((entry) => !entry.valid);

describe("contracts/direction-v1: examples", () => {
  it("ships at least 8 valid and 10 invalid examples, covering the four reading cases", () => {
    expect(valid.length).toBeGreaterThanOrEqual(8);
    expect(invalid.length).toBeGreaterThanOrEqual(10);
    for (const needle of ["roman", "technical", "ai-reply", "neutral"]) {
      expect(valid.some((entry) => entry.file.includes(needle)), `no valid example for ${needle}`).toBe(true);
    }
  });

  it("covers, among the invalid examples, bounds, unknown speaker, forbidden write scope and missing fields", () => {
    const reasons = invalid.map((entry) => `${entry.file} ${entry.reason ?? ""}`).join("\n");
    expect(reasons).toMatch(/tempo/);
    expect(reasons).toMatch(/pauseBeforeMs/);
    expect(reasons).toMatch(/absent de la bible/);
    expect(reasons).toMatch(/portée series/);
    expect(reasons).toMatch(/portée user/);
    expect(reasons).toMatch(/champ requis/);
  });

  it("lists every file of examples/valid and examples/invalid in the manifest, and vice versa", () => {
    const onDisk = (dir: string) => readdirSync(join(EXAMPLES_ROOT, dir)).map((name) => `${dir}/${name}`).sort();
    expect(manifest.examples.map((entry) => entry.file).sort()).toEqual([...onDisk("valid"), ...onDisk("invalid")].sort());
  });

  it.each(manifest.examples)("$file is $valid ($layer)", (entry) => {
    const doc = readJson(join(EXAMPLES_ROOT, entry.file));
    const ajvVerdict = judge("ajv", entry.kind, doc);
    const zodVerdict = judge("zod", entry.kind, doc);

    // The two engines never disagree, whatever the verdict.
    expect(zodVerdict, `${entry.file}: Zod and ajv disagree`).toEqual(ajvVerdict);

    for (const [engine, verdict] of [["ajv", ajvVerdict], ["zod", zodVerdict]] as const) {
      if (entry.valid) {
        expect(verdict.schemaOk, `${engine} rejected a valid example`).toBe(true);
        expect(verdict.semanticIssues, `${engine}: semantic issue on a valid example`).toBe(0);
      } else if (entry.layer === "semantic") {
        expect(verdict.schemaOk, `${engine} should accept the structure`).toBe(true);
        expect(verdict.semanticIssues, `${engine}: semantic check accepted "${entry.reason}"`).toBeGreaterThan(0);
      } else {
        expect(verdict.schemaOk, `${engine} accepted an invalid example (${entry.reason})`).toBe(false);
      }
    }
  });
});

describe("contracts/direction-v1: schema and Zod stay in step", () => {
  const cueSchema = (partitionSchemaJson.$defs as Record<string, Record<string, unknown>>).cue as {
    properties: Record<string, Record<string, unknown> & { items?: Record<string, unknown> }>;
  };
  const props = cueSchema.properties;
  const b = DIRECTION_BOUNDS;

  it("uses the bounds of ADR-015 §7 (constants of direction.ts = numbers in partition.schema.json)", () => {
    expect([props.tempo?.minimum, props.tempo?.maximum]).toEqual([b.tempo.min, b.tempo.max]);
    expect([props.pauseBeforeMs?.minimum, props.pauseBeforeMs?.maximum]).toEqual([b.pauseMs.min, b.pauseMs.max]);
    expect([props.pauseAfterMs?.minimum, props.pauseAfterMs?.maximum]).toEqual([b.pauseMs.min, b.pauseMs.max]);
    expect(props.emphasis?.maxItems).toBe(b.emphasisMax);
    expect(props.direction?.maxLength).toBe(b.directionMaxChars);
    expect(props.states?.maxItems).toBe(b.statesMax);
    expect(props.states?.items?.maxLength).toBe(b.stateMaxChars);
    expect(props.nonverbal?.maxItems).toBe(b.nonverbalMax);
    const emotion = props.emotion as unknown as { properties: Record<string, Record<string, number>> };
    expect(emotion.properties.label?.maxLength).toBe(b.emotionLabelMaxChars);
    expect([emotion.properties.intensity?.minimum, emotion.properties.intensity?.maximum]).toEqual([b.intensity.min, b.intensity.max]);
    expect([emotion.properties.valence?.minimum, emotion.properties.valence?.maximum]).toEqual([b.valence.min, b.valence.max]);
    expect([emotion.properties.arousal?.minimum, emotion.properties.arousal?.maximum]).toEqual([b.arousal.min, b.arousal.max]);
  });

  it("uses the same patterns", () => {
    expect(props.cueId?.pattern).toBe(CUE_ID_PATTERN.source);
    expect(props.speakerId?.pattern).toBe(ROLE_ID_PATTERN.source);
    const top = partitionSchemaJson.properties as Record<string, Record<string, unknown>>;
    expect(top.documentKey?.pattern).toBe(DOCUMENT_KEY_PATTERN.source);
    const defs = bibleSchemaJson.$defs as Record<string, Record<string, unknown>>;
    expect(defs.dateTime?.pattern).toBe(RFC3339_DATE_TIME_PATTERN.source);
    const role = defs.role as { properties: Record<string, Record<string, unknown>> };
    expect(role.properties.id?.pattern).toBe(ROLE_ID_PATTERN.source);
  });

  it("counts characters as code points on both sides (a 280-emoji direction is valid, 281 is not)", () => {
    const base = readJson(join(EXAMPLES_ROOT, "valid", "partition.neutral.json")) as Partition;
    const withDirection = (text: string) => ({ ...base, cues: [{ ...base.cues[0], direction: text }] });
    for (const [text, expected] of [["😀".repeat(280), true], ["😀".repeat(281), false]] as const) {
      expect(ajvPartition(withDirection(text))).toBe(expected);
      expect(PartitionSchema.safeParse(withDirection(text)).success).toBe(expected);
    }
  });
});

describe("contracts/direction-v1: identifiers", () => {
  const coreCommon = readJson(join(REPO_ROOT, "contracts", "core-v1", "common.schema.json")) as {
    $defs: { segmentId: { pattern: string } };
  };
  const coreSegmentId = new RegExp(coreCommon.$defs.segmentId.pattern);

  it("every cueId of every valid partition, and the silence ids derived from it, satisfy the Core v1 segmentId pattern", () => {
    const cueIds: string[] = [];
    for (const entry of valid) {
      const doc = readJson(join(EXAMPLES_ROOT, entry.file)) as { partition?: Partition; cues?: Partition["cues"] };
      const cues = entry.kind === "pair" ? doc.partition?.cues : entry.kind === "partition" ? doc.cues : undefined;
      cueIds.push(...(cues ?? []).map((cue) => cue.cueId));
    }
    expect(cueIds.length).toBeGreaterThan(10);
    for (const cueId of cueIds) {
      expect(coreSegmentId.test(cueId), cueId).toBe(true);
      expect(coreSegmentId.test(silenceSegmentId(cueId, "pre")), `${cueId}-pre`).toBe(true);
      expect(coreSegmentId.test(silenceSegmentId(cueId, "post")), `${cueId}-post`).toBe(true);
    }
  });

  it("the Core segmentId pattern and CUE_ID_PATTERN are the same language", () => {
    expect(coreCommon.$defs.segmentId.pattern).toBe(CUE_ID_PATTERN.source);
  });
});
