#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";

const scriptDir = path.dirname(url.fileURLToPath(import.meta.url));
// The repo root, wherever this checkout actually lives — CI and every
// contributor's machine put it somewhere different; the only thing that is
// always true is "one level up from scripts/".
const repoRoot = path.dirname(scriptDir);
const docPath = path.join(repoRoot, "docs", "traceability.md");

if (!fs.existsSync(docPath)) {
  console.error(`[ERROR] File not found: ${docPath}`);
  process.exit(1);
}

const content = fs.readFileSync(docPath, "utf-8");
// Any backtick-quoted `*.test.ts` path, wherever it is in the tree
// (`vscode-extension/test/...`, `.github/workflows/ci.yml` config
// references are matched separately below) — not anchored to a literal
// `test/` prefix, which used to silently drop the `vscode-extension/`
// segment and resolve every path wrong.
const testFilePattern = /`([^`]+\.test\.ts)`/g;
const referencedFiles = new Set();

let match;
while ((match = testFilePattern.exec(content)) !== null) {
  referencedFiles.add(match[1]);
}

const errors = [];
for (const filePath of referencedFiles) {
  const fullPath = path.join(repoRoot, filePath);
  if (!fs.existsSync(fullPath)) {
    errors.push(`Test file missing: ${filePath}`);
  }
}

console.log("\n=== Traceability Check ===\n");

const coveredACs = content.match(/Couvert\s*\|/gm)?.length || 0;
const partialACs = content.match(/Partiel\s*\|/gm)?.length || 0;
const notCoveredACs = content.match(/Non couvert\s*\|/gm)?.length || 0;

console.log(`Coverage: ${coveredACs} Couvert, ${partialACs} Partiel, ${notCoveredACs} Non couvert`);
console.log(`Test files referenced: ${referencedFiles.size}`);
console.log("\nTest files:");
for (const file of Array.from(referencedFiles).sort()) {
  const exists = fs.existsSync(path.join(repoRoot, file)) ? "✓" : "✗";
  console.log(`  ${exists} ${file}`);
}

if (errors.length > 0) {
  console.error("\n=== Errors ===");
  errors.forEach((e) => console.error(e));
  process.exit(1);
}

console.log("\n✓ All checks passed.");
process.exit(0);
