#!/usr/bin/env node
/**
 * Single source of truth for release notes is `vscode-extension/CHANGELOG.md`
 * (edited alongside every `package.json` version bump, and what the VS Code
 * Marketplace's "Changelog" tab reads straight out of the packaged VSIX).
 * The repo root `CHANGELOG.md` is a generated copy, kept only so GitHub's
 * repo landing page shows the same history without anyone maintaining two
 * files by hand — see CONTRIBUTING.md.
 *
 * Run: node scripts/sync-changelog.mjs (also wired into `npm run package`).
 */
import { copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "..", "CHANGELOG.md");
const dest = join(here, "..", "..", "CHANGELOG.md");

await copyFile(source, dest);
console.log(`Synced ${source} -> ${dest}`);
