import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json"],
      reportsDirectory: "./coverage",
      // Coverage is scoped to the modules that are actually unit-testable in
      // plain Node (fix(review): the 80% target applies to "modules purs",
      // not to the whole extension). `src/pipeline` here means
      // `textSegments.ts` only — `Pipeline.ts` itself is excluded below.
      include: [
        "src/core/**/*.ts",
        "src/parser/**/*.ts",
        "src/playback/**/*.ts",
        "src/net/**/*.ts",
        "src/pipeline/**/*.ts",
        "src/narrator/**/*.ts",
        "src/profiles/defaults*.ts",
        "src/claude/**/*.ts"
      ],
      // Everything below imports `vscode` (directly or by re-exporting a
      // module that does) and therefore cannot run under plain-Node vitest —
      // it is exercised by `test/integration/**` and `test/integration-real/**`
      // instead (`.vscode-test.mjs`), never by `test:unit`.
      exclude: [
        "src/playback/WebviewAudioSink.ts",
        "src/pipeline/Pipeline.ts",
        "src/profiles/ProfileRepository.ts",
        "src/claude/GlobalStateReadStore.ts",
        "src/claude/InboxQuickPick.ts",
        "src/claude/InboxTreeProvider.ts",
        "src/claude/InboxContentProvider.ts",
        "src/claude/ClaudeHookCommand.ts"
      ],
      thresholds: {
        lines: 80
      }
    }
  }
});
