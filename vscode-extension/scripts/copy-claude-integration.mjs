#!/usr/bin/env node
/**
 * Copies `integrations/claude-code/` into `vscode-extension/resources/claude-code/`
 * so the collector script (`ClaudeHookCommand.bundledCaptureScriptPath`) ships
 * *inside* the VSIX — `vsce package` only looks under `vscode-extension/`, it
 * never reaches the repo-root `integrations/` directory (S5.1, ADR-003).
 *
 * `resources/claude-code/` is generated (gitignored, like `dist/`/`out/`):
 * `integrations/claude-code/` stays the single source of truth.
 *
 * Run: node scripts/copy-claude-integration.mjs
 */
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = join(here, "..");
const repoRoot = join(extensionRoot, "..");

const source = join(repoRoot, "integrations", "claude-code");
const dest = join(extensionRoot, "resources", "claude-code");

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(source, dest, { recursive: true });

console.log(`copy-claude-integration: ${source} -> ${dest}`);
