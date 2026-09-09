import { defineConfig } from "@vscode/test-cli";

const common = {
  version: "stable",
  workspaceFolder: "./test/fixtures",
  mocha: {
    timeout: 20000
  }
};

export default defineConfig([
  {
    ...common,
    label: "fake-tts",
    // AC-01..06 (S3.5): `LLM_VOICE_TEST_FAKE_TTS=1` swaps in FakeTtsProvider +
    // FakeAudioSink for the whole run (docs/testing.md) — `context.extensionMode`
    // is never `Production` under test-electron, so `extension.ts` honours it.
    files: "out/test/integration/**/*.test.js",
    env: { LLM_VOICE_TEST_FAKE_TTS: "1" },
    // Own `--user-data-dir` (own `globalStorageUri`, own `DiskAudioCache`
    // root): the audio cache key only depends on the *profile's declared*
    // `tts.providerId` ("openai-compatible"), not on which `TtsProvider`
    // instance actually served it (ADR-005's `AudioQueueBinding`, by
    // design — a profile never names a class). Sharing one `.vscode-test`
    // user-data dir with the `real-provider-unavailable` profile below would
    // let audio synthesised by `FakeTtsProvider` here satisfy a cache *hit*
    // there, silently skipping the real network call it exists to exercise.
    // fix(review): kept short — on the macOS GH Actions runner the checkout
    // path (`/Users/runner/work/<repo>/<repo>/vscode-extension/...`) is long
    // enough that `user-data-fake-tts`/`user-data-real-provider` pushed the
    // extension host's IPC unix socket path past the 103-char `sockaddr_un`
    // limit ("Error: listen EINVAL", integration (macos-latest) failing in
    // CI while passing locally on Linux).
    launchArgs: ["--user-data-dir=.vscode-test/fake-tts"]
  },
  {
    ...common,
    label: "real-provider-unavailable",
    // Separate VS Code instance, *without* the fake: exercises the real
    // `OpenAICompatibleTtsProvider` + `EgressGuard` path against the default
    // profile's loopback `baseUrl`, which nothing listens on in CI/dev
    // sandboxes ("TTS unavailable" error path, story S3.5 task 6/8).
    // Named explicitly, not a `**` glob: `test/integration-real/` also holds
    // plain-Node vitest tests (import `vitest`, no `vscode` — S4.1's
    // `ollama-narrator.test.ts`, S4.2/S4.3's `chatterbox-tts.test.ts`), run
    // separately via `npm run test:integration-real`
    // (`vitest.integration-real.config.ts`). A wildcard here makes mocha
    // `require()` those files too and crash with "Vitest cannot be
    // imported ... using require()" — `vitest`'s `describe`/`it`/`test`
    // have no meaning under mocha.
    files: "out/test/integration-real/tts-unavailable.test.js",
    env: { LLM_VOICE_TEST_FAKE_TTS: undefined },
    // See the comment on the `fake-tts` profile above: a *different* cache
    // directory is what actually forces this run to hit the network.
    // See the comment on the `fake-tts` profile above re: the socket path length.
    launchArgs: ["--user-data-dir=.vscode-test/real-provider"]
  },
  {
    ...common,
    label: "chunk-invalid-fake-tts",
    // S5.3/AC-16: chunk 0 (call #1) always succeeds, every later chunk fails
    // for good (`FakeTtsProvider({ failFromNth: 2 })`) — deterministically
    // reaches `Pipeline.handleChunkError`'s "later chunk" branch (CdC §52
    // "Chunk TTS invalide") after `AudioQueue`'s `maxRetries`, never the
    // first-chunk "TTS unavailable" one `tts-unavailable.test.ts` covers.
    // Own directory, not `test/integration/**`: the "fake-tts" profile above
    // globs that whole tree with a *non*-failing `FakeTtsProvider` — a
    // shared file would run under both, failing there.
    files: "out/test/integration-chunk-invalid/**/*.test.js",
    env: { LLM_VOICE_TEST_FAKE_TTS: "1", LLM_VOICE_TEST_FAKE_TTS_FAIL_FROM: "2" },
    // See the comment on the `fake-tts` profile above re: separate cache/socket path.
    launchArgs: ["--user-data-dir=.vscode-test/chunk-invalid"]
  }
]);
