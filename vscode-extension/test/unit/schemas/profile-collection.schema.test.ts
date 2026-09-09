/**
 * Proves `schemas/profile-collection.schema.json` (the JSON Schema attached
 * to `profiles.json` via `contributes.jsonValidation`) is up to date with
 * `ProfileCollectionSchema` (`src/core/profile.schema.ts`). Regenerates the
 * schema in-process with the same `z.toJSONSchema` call
 * `scripts/generate-profile-schema.mjs` uses, so it never drifts from the
 * committed file without failing CI. Run `npm run gen:schema` (alias of
 * `generate:profile-schema`) after editing `profile.schema.ts`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ProfileCollectionSchema } from "../../../src/core/profile.schema.js";

describe("schemas/profile-collection.schema.json", () => {
  it("matches a fresh z.toJSONSchema(ProfileCollectionSchema) generation", () => {
    const jsonSchema = z.toJSONSchema(ProfileCollectionSchema, { target: "draft-7" }) as Record<
      string,
      unknown
    >;
    jsonSchema.$schema = "http://json-schema.org/draft-07/schema#";
    jsonSchema.title = "LLM Voice — profiles.json";
    jsonSchema.description =
      "Generated from src/core/profile.schema.ts (ProfileCollectionSchema); do not edit by hand.";
    const expected = `${JSON.stringify(jsonSchema, null, 2)}\n`;

    const committedPath = resolve(__dirname, "../../../schemas/profile-collection.schema.json");
    const committed = readFileSync(committedPath, "utf8");

    expect(committed).toBe(expected);
  });
});
