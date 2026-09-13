import { defineConfig } from "vitest/config";

// Plain-Node vitest run against real local servers (S4.3 E2E), separate from
// `vitest.config.ts` (unit) and `.vscode-test.mjs` (extension-host
// integration). `test/integration-real/` also hosts `tts-fallback-succeeds
// .test.ts`/`tts-fallback-fails.test.ts` (coordinator review, replacing the
// old `tts-unavailable.test.ts`, `docs/testing.md`), which import `vscode`
// and only run under `@vscode/test-cli` — excluded here since plain Node
// cannot resolve that module, symmetrically to how `.vscode-test.mjs` never
// compiles/collects this vitest-only file into its own run.
export default defineConfig({
  test: {
    include: ["test/integration-real/*.test.ts"],
    exclude: [
      "test/integration-real/tts-fallback-succeeds.test.ts",
      "test/integration-real/tts-fallback-fails.test.ts"
    ],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000
  }
});
