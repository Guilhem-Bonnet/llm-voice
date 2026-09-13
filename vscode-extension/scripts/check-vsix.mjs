#!/usr/bin/env node
/**
 * What actually ships (S6.1 audit, axis 6).
 *
 * `.vscodeignore` is an allow-by-default list: anything nobody thought to
 * exclude ends up in the `.vsix` and on every user's disk. This script asks
 * `vsce ls` for the exact file list `vsce package` would produce and refuses
 * the categories that must never be in it:
 *
 *  - test code and fixtures (they carry hostile payloads on purpose);
 *  - TypeScript sources and source maps (the bundle is what ships);
 *  - anything that looks like a secret or a local environment file;
 *  - build/tooling configuration that only matters in the repository.
 *
 * It also asserts the files that *must* be there, so a `.vscodeignore` that
 * over-excludes fails just as loudly as one that under-excludes.
 *
 *   node scripts/check-vsix.mjs
 */

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** [label, predicate] — a shipped file matching any of these fails the gate. */
const FORBIDDEN = [
  ["test code", (file) => /(^|\/)test\//.test(file) || /\.test\.[cm]?[jt]s$/.test(file)],
  ["test fixtures", (file) => /(^|\/)fixtures?\//.test(file)],
  ["TypeScript source", (file) => file.endsWith(".ts") && !file.endsWith(".d.ts")],
  ["source map", (file) => file.endsWith(".map")],
  ["unbundled src/", (file) => file.startsWith("src/")],
  ["compiled out/", (file) => file.startsWith("out/")],
  ["build tooling", (file) => /^(scripts\/|tsconfig|vitest\.|eslint\.|\.vscode-test)/.test(file)],
  ["editor/CI config", (file) => /^(\.github\/|\.vscode\/|\.editorconfig|\.nvmrc|\.gitignore)/.test(file)],
  ["lockfile", (file) => /(^|\/)package-lock\.json$/.test(file)],
  ["coverage report", (file) => file.startsWith("coverage/")],
  [
    "environment or secret file",
    (file) => /(^|\/)\.env(\.|$)|\.pem$|\.key$|(^|\/)id_(rsa|ed25519)|\.p12$|\.pfx$|(^|\/)\.npmrc$/.test(file)
  ]
];

/**
 * Bug fix (voice-selection-not-applied / infinite loop investigation,
 * 2026-09-12, `_grimoire/_memory/shared-context.md`): `FORBIDDEN` above is a
 * blocklist — anything nobody thought to name a pattern for ships by
 * default, the exact same "allow-by-default" failure mode `.vscodeignore`
 * itself has (this file's own header). A stray top-level directory that
 * matches none of the `FORBIDDEN` predicates (an ops/tooling folder such as
 * `_grimoire-output/`, a future scratch directory, an editor swap file at
 * the repository root) would sail through silently.
 *
 * `ALLOWED_PREFIXES`/`ALLOWED_EXACT_FILES` add the other half: an explicit
 * whitelist of what *may* ship, checked in addition to (never instead of)
 * `FORBIDDEN` above — a file can fail this gate either by matching a
 * forbidden pattern *or* by matching no allowed one, whichever fires first.
 * Extending what ships (a new `media/` asset, a new top-level doc) means
 * adding to this list deliberately, not editing `.vscodeignore` alone.
 */
const ALLOWED_PREFIXES = ["media/", "resources/", "schemas/", "dist/"];
const ALLOWED_EXACT_FILES = ["package.json", "README.md", "LICENSE", "CHANGELOG.md"];

function isWhitelisted(file) {
  return ALLOWED_EXACT_FILES.includes(file) || ALLOWED_PREFIXES.some((prefix) => file.startsWith(prefix));
}

/** Files whose absence means the package is broken. */
const REQUIRED = [
  "package.json",
  "dist/extension.js",
  "media/player/player.js",
  "media/player/player.css",
  "schemas/profile-collection.schema.json",
  // S7.2: the extension's Marketplace page (README) and the two other
  // files VS Code surfaces in the extension details view — a `.vscodeignore`
  // that swallows any of these silently ships a blank "no README" page
  // again (the real 0.1.0 user complaint this story fixes).
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
  "media/walkthrough/exemple.md",
  "media/walkthrough/choose-voice.svg",
  "media/walkthrough/read-document.svg",
  "media/walkthrough/choose-profile.svg",
  "media/walkthrough/connect-claude.svg"
];

const listed = execFileSync("npx", ["vsce", "ls", "--no-dependencies"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024
})
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith("WARNING") && !line.startsWith("DONE"));

const violations = [];
for (const file of listed) {
  for (const [label, matches] of FORBIDDEN) {
    if (matches(file)) {
      violations.push(`${label}: ${file}`);
    }
  }
  if (!isWhitelisted(file)) {
    violations.push(`not on the shipping whitelist (ALLOWED_PREFIXES/ALLOWED_EXACT_FILES): ${file}`);
  }
}

const missing = REQUIRED.filter((required) => !listed.includes(required));

console.log(`check-vsix: ${listed.length} files would be packaged.`);

if (violations.length > 0 || missing.length > 0) {
  for (const violation of violations) {
    console.error(`check-vsix: MUST NOT SHIP — ${violation}`);
  }
  for (const file of missing) {
    console.error(`check-vsix: MISSING — ${file} is required but would not be packaged`);
  }
  console.error("check-vsix: fix .vscodeignore and re-run.");
  process.exit(1);
}

console.log("check-vsix: no test code, no sources, no maps, no secrets; every required file present.");
