/**
 * Proves that every reference message under `contracts/core-v1/examples/`
 * is accepted or rejected exactly as `contracts/core-v1/examples/manifest.json`
 * says it should be, against the JSON Schema (draft 2020-12) files that are
 * the canonical Core v1 contract (ADR-012 §4). The same manifest and the
 * same example files are replayed by `crates/llm-voice-protocol`'s
 * `cargo test` (serde) — a mismatch between the two is a contract bug.
 *
 * Uses `ajv` (MIT, already resolved transitively at 8.20.0 through the
 * existing devDependency tree — see `contracts/core-v1/README.md` and this
 * task's evidence pack for the license/justification check) rather than
 * Zod: unlike every other schema in `src/core`, these `.schema.json` files
 * are the source of truth (read by Rust too), not generated from a Zod
 * schema, so the test must load and validate the actual committed JSON
 * Schema documents.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import { describe, expect, it } from "vitest";

const CONTRACT_ROOT = resolve(__dirname, "..", "..", "..", "..", "contracts", "core-v1");
const EXAMPLES_ROOT = join(CONTRACT_ROOT, "examples");

interface ManifestEntry {
  file: string;
  kind: string;
  valid: boolean;
  reason?: string;
}

interface Manifest {
  examples: ManifestEntry[];
}

/** Recursively lists every `*.schema.json` file under `dir`. */
function listSchemaFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return listSchemaFiles(full);
    }
    return entry.endsWith(".schema.json") ? [full] : [];
  });
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * `kind` is the schema's path relative to `contracts/core-v1`, without the
 * `.schema.json` suffix (e.g. `http/enqueue.request`, `ws/state.event`) —
 * exactly what `examples/manifest.json` uses, and what the Rust test's
 * dispatcher matches on too.
 */
function kindOf(schemaPath: string): string {
  return relative(CONTRACT_ROOT, schemaPath).replace(/\.schema\.json$/, "");
}

function buildValidators(): Map<string, ValidateFunction> {
  // `strictRequired` flags a `required` entry not declared in that exact
  // subschema's own `properties` — it fires on every `if`/`then` here
  // (the conditionally required field is declared once, on the parent
  // object), which is the documented, intended use of `if`/`then` and not
  // a contract bug. Every other strict-mode check stays enabled.
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });

  const commonSchema = readJson(join(CONTRACT_ROOT, "common.schema.json"));
  ajv.addSchema(commonSchema as object);

  const validators = new Map<string, ValidateFunction>();
  for (const schemaPath of listSchemaFiles(CONTRACT_ROOT)) {
    if (schemaPath.endsWith("common.schema.json")) continue;
    const schema = readJson(schemaPath);
    validators.set(kindOf(schemaPath), ajv.compile(schema as object));
  }
  return validators;
}

describe("contracts/core-v1", () => {
  const validators = buildValidators();
  const manifest = readJson(join(EXAMPLES_ROOT, "manifest.json")) as Manifest;

  it("declares at least one valid and one invalid example per message kind", () => {
    const kinds = new Set(validators.keys());
    expect(kinds.size).toBeGreaterThan(0);
    for (const kind of kinds) {
      const entries = manifest.examples.filter((e) => e.kind === kind);
      expect(entries.some((e) => e.valid), `${kind}: no valid example`).toBe(true);
      expect(entries.some((e) => !e.valid), `${kind}: no invalid example`).toBe(true);
    }
  });

  it.each(manifest.examples)(
    "$file ($kind) is $valid",
    ({ file, kind, valid, reason }) => {
      const validate = validators.get(kind);
      expect(validate, `no schema compiled for kind "${kind}"`).toBeDefined();

      const example = readJson(join(EXAMPLES_ROOT, file));
      const accepted = validate!(example);

      if (accepted !== valid) {
        const detail = valid
          ? JSON.stringify(validate!.errors, null, 2)
          : `expected to be rejected (${reason ?? "no reason given"}) but ajv accepted it`;
        throw new Error(`${file}: expected valid=${valid}, got valid=${accepted}\n${detail}`);
      }
      expect(accepted).toBe(valid);
    }
  );
});
