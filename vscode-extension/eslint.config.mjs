// @ts-check
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    ignores: [
      "out/**",
      "node_modules/**",
      ".vscode-test/**",
      "*.vsix",
      "coverage/**",
      "*.mjs",
      "vitest.config.ts"
    ]
  },
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
        sourceType: "module"
      }
    },
    plugins: {
      "@typescript-eslint": tsPlugin
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // Mirrors tsconfig's `noUnusedParameters`, which already treats a
      // leading underscore as "intentionally unused" (e.g. `parseMarkdown`'s
      // `_uri`, kept for API-contract symmetry with `SourceAdapter.capture`).
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-floating-promises": "off"
    }
  }
];
