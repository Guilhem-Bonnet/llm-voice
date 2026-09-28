#!/usr/bin/env node
/**
 * Stages the `llm-voice-core` binary into `vscode-extension/bin/<target>/`
 * (ADR-012 §7, phasage linux-x64 : decisions-log 2026-09-28).
 *
 * `CoreProcess.ts` resolves the packaged binary at
 * `<extensionPath>/bin/<platformTarget()>/llm-voice-core[.exe]`. This script
 * copies the Cargo release build there so `vsce package --target <target>`
 * can ship it. `vscode-extension/bin/` is git-ignored (a binary artifact,
 * rebuilt every time) but NOT `.vscodeignore`-d, so it reaches the VSIX.
 *
 *   node scripts/stage-core.mjs <target>
 *
 * `<target>` is one of vsce's target triples (`linux-x64`, `linux-arm64`,
 * `darwin-x64`, `darwin-arm64`, `win32-x64`). Only `linux-x64` is wired to a
 * Cargo build today (S1); the others are accepted so this script does not
 * need to change again in S3/S4, but they will fail clearly if the release
 * binary for that host is not what was built.
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(root, "..");

const KNOWN_TARGETS = new Set(["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64"]);

function binaryNameFor(target) {
  return target.startsWith("win32") ? "llm-voice-core.exe" : "llm-voice-core";
}

function fail(message) {
  console.error(`stage-core: ${message}`);
  process.exit(1);
}

const target = process.argv[2];
if (target === undefined || target.length === 0) {
  fail(`cible manquante. Usage : node scripts/stage-core.mjs <${[...KNOWN_TARGETS].join("|")}>`);
}
if (!KNOWN_TARGETS.has(target)) {
  fail(`cible inconnue "${target}". Cibles valides : ${[...KNOWN_TARGETS].join(", ")}`);
}

const binaryName = binaryNameFor(target);
// `cargo build --release` always produces `target/release/<name>` for the
// host it runs on. Cross-compilation (darwin/win32 from a Linux CI runner,
// S3/S4) is out of scope here: this script only stages what Cargo already
// built for the *current* host, so it fails loudly rather than silently
// shipping the wrong architecture's binary under someone else's target name.
const source = join(repoRoot, "target", "release", binaryName);
const destDir = join(root, "bin", target);
const destination = join(destDir, binaryName);

if (!existsSync(source)) {
  fail(
    `binaire introuvable : ${source}\n` +
      `  → lancer d'abord : cargo build --release -p llm-voice-core`
  );
}

const sourceStat = statSync(source);
if (!sourceStat.isFile()) {
  fail(`${source} n'est pas un fichier régulier`);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(source, destination);
if (!target.startsWith("win32")) {
  chmodSync(destination, 0o755);
}

const destStat = statSync(destination);
console.log(
  `stage-core: ${source} → ${destination} (${destStat.size} octets, mode ${(destStat.mode & 0o777).toString(8)})`
);
