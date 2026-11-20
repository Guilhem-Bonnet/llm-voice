#!/usr/bin/env node
/**
 * Generates `schemas/profile-collection.schema.json` and
 * `schemas/global-voice.schema.json` from `ProfileCollectionSchema` and
 * `GlobalVoiceFileSchema` (`src/core/profile.schema.ts`), using zod v4's
 * built-in `z.toJSONSchema` — the single source of truth stays the Zod
 * schema, this script only serialises it (ADR-004: JSON Schema attached to
 * `profiles.json` via `contributes.jsonValidation`).
 *
 * Requires `npm run compile` to have run first: it imports the compiled
 * `out/src/core/profile.schema.js` rather than re-implementing the schema,
 * so it can never drift from the runtime validator.
 *
 * Run: node scripts/generate-profile-schema.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { GlobalVoiceFileSchema, ProfileCollectionSchema } from "../out/src/core/profile.schema.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const jsonSchema = z.toJSONSchema(ProfileCollectionSchema, { target: "draft-7" });
jsonSchema.$schema = "http://json-schema.org/draft-07/schema#";
jsonSchema.title = "LLM Voice — profiles.json";
jsonSchema.description =
  "Generated from src/core/profile.schema.ts (ProfileCollectionSchema); do not edit by hand.";

const outDir = join(root, "schemas");
await mkdir(outDir, { recursive: true });
const outFile = join(outDir, "profile-collection.schema.json");
await writeFile(outFile, `${JSON.stringify(jsonSchema, null, 2)}\n`, "utf8");
console.log(`Generated ${outFile}`);

const voiceSchema = z.toJSONSchema(GlobalVoiceFileSchema, { target: "draft-7" });
voiceSchema.$schema = "http://json-schema.org/draft-07/schema#";
voiceSchema.title = "LLM Voice — global-voice.json";
voiceSchema.description =
  "Generated from src/core/profile.schema.ts (GlobalVoiceFileSchema); do not edit by hand.";
const voiceFile = join(outDir, "global-voice.schema.json");
await writeFile(voiceFile, `${JSON.stringify(voiceSchema, null, 2)}\n`, "utf8");
console.log(`Generated ${voiceFile}`);
