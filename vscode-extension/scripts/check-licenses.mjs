#!/usr/bin/env node
/**
 * Production dependency licence gate (AC-SEC-10's neighbour, S6.1 audit).
 *
 * `npm audit --omit=dev` answers "is a shipped dependency known-vulnerable".
 * This answers the other supply-chain question: "may we ship it at all".
 * LLM Voice is MIT; a strong-copyleft dependency inside the VSIX would make
 * the whole distributed artifact subject to that licence.
 *
 * Walks the *production* dependency tree only (`npm ls --omit=dev --all`),
 * reads each package's own `package.json` for its `license`, and fails on
 * anything strong-copyleft or unidentifiable.
 *
 *   node scripts/check-licenses.mjs           # gate
 *   node scripts/check-licenses.mjs --list    # gate + print the inventory
 *
 * Exits 1 on the first violation, so it can be a CI gate as-is.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Refused outright: copyleft that reaches the whole distributed work.
 * LGPL is not here — dynamic linking is compatible with shipping an MIT
 * extension — but it is reported, because a bundler that inlines it would
 * change that answer.
 */
const DENIED = [/\bAGPL/i, /\bGPL-[0-9]/i, /^GPL\b/i, /\bSSPL/i, /\bCPAL/i, /\bOSL-/i, /\bEUPL/i];
const REPORT_ONLY = [/\bLGPL/i, /\bMPL-/i, /\bEPL-/i, /\bCDDL/i];
/** Permissive licences we ship without further thought. */
const ALLOWED = [
  /^MIT$/i,
  /^ISC$/i,
  /^BSD-2-Clause$/i,
  /^BSD-3-Clause$/i,
  /^0BSD$/i,
  /^Apache-2\.0$/i,
  /^Unlicense$/i,
  /^CC0-1\.0$/i,
  /^BlueOak-1\.0\.0$/i,
  /^Python-2\.0$/i
];

/** Flattens `npm ls --json`'s nested tree into `name@version -> path`. */
function collect(node, into = new Map()) {
  for (const [name, entry] of Object.entries(node.dependencies ?? {})) {
    if (entry.path !== undefined && !into.has(`${name}@${entry.version}`)) {
      into.set(`${name}@${entry.version}`, entry.path);
    }
    collect(entry, into);
  }
  return into;
}

function licenseOf(packagePath) {
  const manifest = JSON.parse(readFileSync(resolve(packagePath, "package.json"), "utf8"));
  if (typeof manifest.license === "string") {
    return manifest.license;
  }
  if (manifest.license?.type !== undefined) {
    return manifest.license.type;
  }
  if (Array.isArray(manifest.licenses)) {
    return manifest.licenses.map((entry) => entry.type ?? entry).join(" OR ");
  }
  return undefined;
}

/** A SPDX expression is acceptable if every alternative it offers is. */
function classify(expression) {
  if (expression === undefined) {
    return "unknown";
  }
  const normalised = expression.replace(/[()]/g, " ").trim();
  if (DENIED.some((pattern) => pattern.test(normalised))) {
    // `MIT OR GPL-2.0` is fine: we take the MIT branch.
    const alternatives = normalised.split(/\s+OR\s+/i).map((part) => part.trim());
    const hasCleanBranch = alternatives.some(
      (part) => ALLOWED.some((pattern) => pattern.test(part)) && !DENIED.some((pattern) => pattern.test(part))
    );
    return hasCleanBranch ? "allowed" : "denied";
  }
  if (REPORT_ONLY.some((pattern) => pattern.test(normalised))) {
    return "review";
  }
  if (normalised.split(/\s+(?:AND|OR)\s+/i).every((part) => ALLOWED.some((pattern) => pattern.test(part.trim())))) {
    return "allowed";
  }
  return "unknown";
}

const listing = JSON.parse(
  execFileSync("npm", ["ls", "--omit=dev", "--all", "--json", "--long"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  })
);

const packages = collect(listing);
const denied = [];
const unknown = [];
const review = [];
const rows = [];

for (const [id, packagePath] of [...packages].sort()) {
  let license;
  try {
    license = licenseOf(packagePath);
  } catch {
    license = undefined;
  }
  const verdict = classify(license);
  rows.push({ id, license: license ?? "(none declared)", verdict });
  if (verdict === "denied") {
    denied.push(`${id}: ${license}`);
  } else if (verdict === "unknown") {
    unknown.push(`${id}: ${license ?? "(none declared)"}`);
  } else if (verdict === "review") {
    review.push(`${id}: ${license}`);
  }
}

if (process.argv.includes("--list")) {
  for (const row of rows) {
    console.log(`${row.verdict.padEnd(8)} ${row.id.padEnd(44)} ${row.license}`);
  }
}

console.log(`check-licenses: ${rows.length} production packages inspected.`);
for (const entry of review) {
  console.warn(`check-licenses: weak-copyleft, shipped as-is: ${entry}`);
}

if (denied.length > 0 || unknown.length > 0) {
  for (const entry of denied) {
    console.error(`check-licenses: DENIED (strong copyleft): ${entry}`);
  }
  for (const entry of unknown) {
    console.error(`check-licenses: UNKNOWN licence, refusing to ship blind: ${entry}`);
  }
  process.exit(1);
}

console.log("check-licenses: every production dependency is permissively licensed.");
