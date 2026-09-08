#!/usr/bin/env node
/**
 * Bundles `src/extension.ts` into `dist/extension.js` (CJS, Node platform,
 * `vscode` external — S3.5 task 1). This is what lets `zod`/`unified`/
 * `remark-*` ship *inside* the VSIX without `npm install` at install time,
 * fixing the gap ADR-005 flags: `vsce package --no-dependencies` plus
 * `.vscodeignore`'s `node_modules/**` used to strip every production
 * dependency from the package, so any code path reaching
 * `profile.schema.ts` (`zod`) crashed a real install with
 * `Cannot find module 'zod'`. `package.json#main` now points at this
 * bundle; `tsc` (`npm run compile`) still produces `out/` separately, which
 * is what the `@vscode/test-electron` integration suite compiles against and
 * runs unbundled (mirrors production behaviour closely enough while keeping
 * stack traces readable).
 *
 * The dynamic `import("unified")` etc. in `src/parser/MarkdownParser.ts`
 * (ESM-only packages, loaded lazily from a CJS module) survive bundling:
 * esbuild resolves every bundled specifier at bundle time, including ones
 * only reachable through a dynamic `import()`, and rewrites the call to load
 * the now-inlined module instead of doing a real dynamic import at runtime.
 * Verified by grepping the bundle for a literal `import("unified")` (absent)
 * and by running the parser unit suite against `dist/extension.js`'s
 * dependency graph (`npm run test:integration`, which exercises
 * `parseMarkdown` through `Speak Document`).
 *
 * Run: node scripts/esbuild.mjs
 */
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

await build({
  entryPoints: [join(root, "src/extension.ts")],
  outfile: join(root, "dist/extension.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["vscode"],
  sourcemap: true,
  logLevel: "info"
});
