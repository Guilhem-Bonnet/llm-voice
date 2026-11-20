/**
 * JSON Schemas handed to Ollama as `format` (structured outputs). They mirror
 * the contract `contracts/direction-v1/partition.schema.json` for the cue
 * (names, required fields, enums: a test guards the drift) and the events a
 * director may propose (`DIRECTOR_FACT_TYPES`).
 *
 * The numeric and size bounds of the contract are deliberately absent: the raw
 * output is lenient, `boundPartition` brings the values inside the bounds, and
 * the ranges are stated in the prompt (ADR-015 §3, second paragraph). Ids and
 * enums stay strict: they cannot be repaired.
 */

import { NONVERBAL_KINDS, NONVERBAL_POSITIONS } from "../../../core/direction.js";

type JsonSchema = { readonly [key: string]: unknown };

const string: JsonSchema = { type: "string" };
const stringArray: JsonSchema = { type: "array", items: string };

export const CUE_JSON_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["cueId", "sourceIds", "speakerId", "spokenText"],
  properties: {
    cueId: string,
    sourceIds: { type: "array", items: string, minItems: 1 },
    speakerId: string,
    spokenText: string,
    emotion: {
      type: "object",
      additionalProperties: false,
      required: ["label", "intensity"],
      properties: {
        label: string,
        intensity: { type: "number" },
        valence: { type: "number" },
        arousal: { type: "number" }
      }
    },
    tempo: { type: "number" },
    pauseBeforeMs: { type: "integer" },
    pauseAfterMs: { type: "integer" },
    emphasis: stringArray,
    direction: string,
    states: stringArray,
    nonverbal: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "at"],
        properties: {
          kind: { enum: [...NONVERBAL_KINDS] },
          at: { enum: [...NONVERBAL_POSITIONS] }
        }
      }
    }
  }
};

/** Types a director may add to the bible (same list as `DIRECTOR_FACT_TYPES`; a test guards the drift). */
export const FACT_TYPES = ["addRole", "addTrait", "addState", "closeState", "setDescriptor"] as const;

export const FACT_JSON_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["type"],
  properties: {
    type: { enum: [...FACT_TYPES] },
    roleId: string,
    names: stringArray,
    key: string,
    value: string,
    label: string,
    fromSourceId: string,
    untilSourceId: string,
    sourceIds: stringArray
  }
};

/** `{ cues, facts? }`: what `StageDirector` reads (`RawDirectionOutputSchema` plus the facts envelope). */
export const DIRECTION_OUTPUT_JSON_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["cues"],
  properties: {
    cues: { type: "array", items: CUE_JSON_SCHEMA },
    facts: { type: "array", items: FACT_JSON_SCHEMA }
  }
};

/**
 * `{ analysis, characters }`: what `Analyst` reads (`RawAnalysisSchema`). Traits
 * travel as `{ key, value }` pairs (a free-keyed object is a poor target for a
 * grammar-constrained decoder); `OllamaDirectionLlm` folds them into a record.
 * `readingProfileId` is the user's choice, not the model's: it is not asked.
 */
export const ANALYSIS_OUTPUT_JSON_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["analysis", "characters"],
  properties: {
    analysis: {
      type: "object",
      additionalProperties: false,
      properties: {
        genre: string,
        intent: string,
        audience: string,
        baseTone: string,
        narratorPersona: string
      }
    },
    characters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "names"],
        properties: {
          id: string,
          names: stringArray,
          traits: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["key", "value"],
              properties: { key: string, value: string }
            }
          },
          voiceDescriptor: string
        }
      }
    }
  }
};
