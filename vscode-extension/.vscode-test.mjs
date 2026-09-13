import { defineConfig } from "@vscode/test-cli";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const common = {
  version: "stable",
  workspaceFolder: "./test/fixtures",
  mocha: {
    timeout: 20000
  }
};

// S9 fix(review): every `--user-data-dir` below used to be a *relative*
// path ("`.vscode-test/fake-tts`"...). The Electron child process
// `@vscode/test-electron` spawns does not reliably inherit this script's
// `process.cwd()` in every environment (sandboxed/xvfb runs observed here
// resolved it against `$HOME` instead) — two different checkouts of this
// repo (e.g. two git worktrees run concurrently) can then silently share
// the *same* real `~/.vscode-test/<profile>/User/globalStorage/...`
// directory and corrupt each other's `profiles.json` mid-run (a `ZodError`
// on `schemaVersion` from a profile shape the *other* worktree's code
// wrote). An absolute path anchored to this file's own directory removes
// the ambiguity — same fix `prefetchChunksUserDataDir` below already used.
const testRootDir = dirname(fileURLToPath(import.meta.url));
function userDataDir(profileName) {
  return join(testRootDir, ".vscode-test", profileName);
}

// S5.1: `Pipeline`'s `InboxRepository` resolves its directory once, at
// activation (`llmVoice.claude.inboxPath` > `LLM_VOICE_INBOX` > default) —
// without this override every integration run would create/read
// `~/.llm-voice/inbox/` on the machine running the tests. One directory per
// `vscode-test` profile (shared by every `*.test.ts` file that profile
// loads, same as `--user-data-dir` above); `test/integration/inbox.test.ts`
// only ever asserts on *deltas* it creates itself for exactly this reason.
const inboxDirFakeTts = mkdtempSync(join(tmpdir(), "llm-voice-test-inbox-fake-tts-"));
const inboxDirPrefetch = mkdtempSync(join(tmpdir(), "llm-voice-test-inbox-prefetch-"));
// S6.1: the security profile writes deliberately hostile inbox entries
// (script tags, ANSI escapes) and must never see, or be seen by, the
// functional profiles' entries.
const inboxDirSecurity = mkdtempSync(join(tmpdir(), "llm-voice-test-inbox-security-"));

// S5.3: `llmVoice.audio.prefetchChunks` (CdC §32/§48) is read once, at
// `Pipeline`'s construction (activation time) — a live `config.update()`
// from inside a test would arrive too late to affect the already-built
// `PlaybackController`. Pre-seeding this profile's own `--user-data-dir`
// with a User `settings.json` is the only way to have the extension host
// see a non-default value *before* `activate()` runs, same idea as the
// `--user-data-dir` isolation below (own dir so this never leaks into the
// `fake-tts` profile's default-prefetch assertions).
const prefetchChunksUserDataDir = mkdtempSync(join(tmpdir(), "llm-voice-test-userdata-prefetch-"));
mkdirSync(join(prefetchChunksUserDataDir, "User"), { recursive: true });
writeFileSync(
  join(prefetchChunksUserDataDir, "User", "settings.json"),
  JSON.stringify({ "llmVoice.audio.prefetchChunks": 0 }, null, 2)
);

// Bug fix (voice-selection-not-applied / infinite loop, coordinator review):
// replaces the old `real-provider-unavailable` profile, whose result used to
// depend on whether a real Chatterbox happened to be reachable at
// `localhost:8004` on the machine running the suite — green in CI (nothing
// listens there), red (or green for the wrong reason) on a developer
// machine with the real service up, exactly the fragility issue #50 closed
// elsewhere. Both replacement profiles below are isolated from the host
// machine on every axis `Pipeline.autoSelectTts()`/`SystemTtsProvider`
// touch:
//
//  - `LLM_VOICE_TEST_AUTO_CHATTERBOX_BASE_URL`/`_PIPER_BASE_URL` (test-only
//    seam, `Pipeline`'s own doc comment) point the "auto" chain's two
//    network probes at fixed, unusual high loopback ports nothing on a
//    normal dev/CI machine binds by default — never the real Chatterbox/
//    Piper-local default ports (`8004`/`5000`) a developer might actually
//    be running.
//  - `LLM_VOICE_TEST_SYSTEM_RUNNER` (test-only seam, `presets.ts`'s own doc
//    comment) replaces `SystemTtsProvider`'s real process/filesystem runner
//    outright — `"espeak-only"` (fallback succeeds) or `"none"` (fallback
//    fails). A first attempt at this used `PATH` manipulation instead
//    (mirroring `system-no-engine` below): verified live *not* to work —
//    VS Code's own "resolve shell environment" startup step re-derives
//    `PATH` from the real login shell before the extension host ever sees
//    it, so a machine with a real `espeak-ng`/`piper` installed (this
//    repo's own dev machine) found the *real* engine regardless of what
//    `.vscode-test.mjs` asked for.
//  - each gets its own brand-new `--user-data-dir` and its own pre-seeded
//    `profiles.json` naming no explicit `tts.providerId` at all, so it
//    resolves through `llmVoice.tts.provider`'s own shipped default,
//    `"auto"`.
const AUTO_CHATTERBOX_CLOSED_PORT = 47601;
const AUTO_PIPER_LOCAL_CLOSED_PORT = 47602;

/** One profile, `tts: {}` — no explicit `providerId`/`baseUrl`, resolves to `llmVoice.tts.provider`'s default (`"auto"`). */
function seedAutoProfile(profileUserDataDir) {
  const globalStorageDir = join(profileUserDataDir, "User", "globalStorage", "guilhem-bonnet.llm-voice");
  mkdirSync(globalStorageDir, { recursive: true });
  writeFileSync(
    join(globalStorageDir, "profiles.json"),
    JSON.stringify(
      {
        schemaVersion: 2,
        defaultProfileId: "auto-fallback-test",
        profiles: [
          {
            id: "auto-fallback-test",
            label: "Auto fallback test",
            mode: "faithful",
            language: "fr-FR",
            tts: {},
            chunking: { unit: "sentence", maxSentences: 3, prefetchChunks: 2 },
            playback: { rate: 1, volume: 1 },
            description: "Test-only profile: providerId deliberately omitted, resolves to 'auto'."
          }
        ]
      },
      null,
      2
    )
  );
}

const autoFallbackSucceedsUserDataDir = mkdtempSync(join(tmpdir(), "llm-voice-test-userdata-auto-succeeds-"));
seedAutoProfile(autoFallbackSucceedsUserDataDir);
const autoFallbackFailsUserDataDir = mkdtempSync(join(tmpdir(), "llm-voice-test-userdata-auto-fails-"));
seedAutoProfile(autoFallbackFailsUserDataDir);
const inboxDirAutoFallbackSucceeds = mkdtempSync(join(tmpdir(), "llm-voice-test-inbox-auto-succeeds-"));
const inboxDirAutoFallbackFails = mkdtempSync(join(tmpdir(), "llm-voice-test-inbox-auto-fails-"));

export default defineConfig([
  {
    ...common,
    label: "fake-tts",
    // AC-01..06 (S3.5): `LLM_VOICE_TEST_FAKE_TTS=1` swaps in FakeTtsProvider +
    // FakeAudioSink for the whole run (docs/testing.md) — `context.extensionMode`
    // is never `Production` under test-electron, so `extension.ts` honours it.
    files: "out/test/integration/**/*.test.js",
    env: { LLM_VOICE_TEST_FAKE_TTS: "1", LLM_VOICE_INBOX: inboxDirFakeTts },
    // Own `--user-data-dir` (own `globalStorageUri`, own `DiskAudioCache`
    // root): the audio cache key only depends on the *profile's declared*
    // `tts.providerId` ("openai-compatible"), not on which `TtsProvider`
    // instance actually served it (ADR-005's `AudioQueueBinding`, by
    // design — a profile never names a class). Sharing one `.vscode-test`
    // user-data dir with the `tts-auto-fallback-*` profiles below would let
    // audio synthesised by `FakeTtsProvider` here satisfy a cache *hit*
    // there, silently skipping the real network/engine calls they exist to
    // exercise.
    // fix(review): kept short — on the macOS GH Actions runner the checkout
    // path (`/Users/runner/work/<repo>/<repo>/vscode-extension/...`) is long
    // enough that `user-data-fake-tts`/`user-data-real-provider` pushed the
    // extension host's IPC unix socket path past the 103-char `sockaddr_un`
    // limit ("Error: listen EINVAL", integration (macos-latest) failing in
    // CI while passing locally on Linux).
    launchArgs: [`--user-data-dir=${userDataDir("fake-tts")}`]
  },
  {
    ...common,
    label: "tts-auto-fallback-succeeds",
    // Case 1 (coordinator review): the resolved "auto" provider chain's
    // first two rungs (Chatterbox, Piper local) are unreachable — pointed at
    // fixed closed ports, never the machine's real Chatterbox/Piper — but
    // the final rung (`SystemTtsProvider`) *does* find a (fake) `espeak-ng`
    // (`LLM_VOICE_TEST_SYSTEM_RUNNER=espeak-only`). Speak must succeed via
    // that fallback with no error dialog at all; `ensureVoiceReady`'s
    // one-button "install a better voice" offer (Piper outranks espeak-ng,
    // `AutoVoiceInstall.ts`) is still expected — declined the same way
    // `no-voice-available.test.ts` already does — and its own decline
    // message is what "signale le repli" to the user (`fallbackMessageFor`,
    // never Chatterbox's name, S8.3).
    // Named explicitly, not a `**` glob: see the comment on the file this
    // replaces for why `test/integration-real/` cannot be globbed under mocha.
    files: "out/test/integration-real/tts-fallback-succeeds.test.js",
    env: {
      LLM_VOICE_TEST_FAKE_TTS: undefined,
      LLM_VOICE_INBOX: inboxDirAutoFallbackSucceeds,
      LLM_VOICE_TEST_SYSTEM_RUNNER: "espeak-only",
      LLM_VOICE_TEST_AUTO_CHATTERBOX_BASE_URL: `http://127.0.0.1:${AUTO_CHATTERBOX_CLOSED_PORT}`,
      LLM_VOICE_TEST_AUTO_PIPER_BASE_URL: `http://127.0.0.1:${AUTO_PIPER_LOCAL_CLOSED_PORT}`
    },
    launchArgs: [`--user-data-dir=${autoFallbackSucceedsUserDataDir}`]
  },
  {
    ...common,
    label: "tts-auto-fallback-fails",
    // Case 2 (coordinator review): every rung of the same "auto" chain is
    // deterministically unreachable — Chatterbox/Piper-local on the same
    // fixed closed ports as above, *and* `LLM_VOICE_TEST_SYSTEM_RUNNER=none`
    // so `SystemTtsProvider` finds nothing either. Speak must end in the
    // diagnostic "TTS unavailable" dialog (`Pipeline.handleChunkError`),
    // never a hang or an unhandled rejection — and, unlike the "succeeds"
    // profile above, this never depends on the real machine having (or
    // lacking) any of these engines/servers either.
    files: "out/test/integration-real/tts-fallback-fails.test.js",
    env: {
      LLM_VOICE_TEST_FAKE_TTS: undefined,
      LLM_VOICE_INBOX: inboxDirAutoFallbackFails,
      LLM_VOICE_TEST_SYSTEM_RUNNER: "none",
      LLM_VOICE_TEST_AUTO_CHATTERBOX_BASE_URL: `http://127.0.0.1:${AUTO_CHATTERBOX_CLOSED_PORT}`,
      LLM_VOICE_TEST_AUTO_PIPER_BASE_URL: `http://127.0.0.1:${AUTO_PIPER_LOCAL_CLOSED_PORT}`
    },
    launchArgs: [`--user-data-dir=${autoFallbackFailsUserDataDir}`]
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
    launchArgs: [`--user-data-dir=${userDataDir("chunk-invalid")}`]
  },
  {
    ...common,
    label: "prefetch-chunks-fake-tts",
    // S5.3: proves `llmVoice.audio.prefetchChunks` actually reaches
    // `PlaybackController`/`AudioQueue` (it didn't, pre-fix — the setting
    // existed in `package.json` since S5.2 but nothing read it). Own
    // profile: the value is pre-seeded into this run's `--user-data-dir`
    // (see `prefetchChunksUserDataDir` above), which must not leak into
    // the `fake-tts` profile's default-prefetch assertions (AC-01..06).
    files: "out/test/integration-prefetch/**/*.test.js",
    env: { LLM_VOICE_TEST_FAKE_TTS: "1", LLM_VOICE_INBOX: inboxDirPrefetch },
    launchArgs: [`--user-data-dir=${prefetchChunksUserDataDir}`]
  },
  {
    ...common,
    label: "system-no-engine",
    // S8.3: the real "fresh install, zero local engine at all" case —
    // *without* the fake TTS, `PATH` stripped of `espeak-ng`/`say`/`piper`,
    // and a brand-new `--user-data-dir` (so `PiperSetup` never finds a
    // prior install either). Proves `Pipeline.ensureVoiceReady`'s one-action
    // prompt path never leaves the user with an unhandled rejection or a
    // hang, whichever way the prompt is answered (`no-voice-available.test.ts`).
    files: "out/test/integration-no-engine/**/*.test.js",
    env: { LLM_VOICE_TEST_FAKE_TTS: undefined, PATH: "/nonexistent-on-purpose" },
    launchArgs: [`--user-data-dir=${userDataDir("system-no-engine")}`]
  },
  {
    ...common,
    label: "integration-security",
    // S6.1 audit (AC-SEC-02/05/08): the attack tests that need a *real* VS
    // Code — the CSP a live webview actually serves, `localResourceRoots` as
    // actually applied, and profile import going through the real
    // `SecretStorage`. Own profile for two reasons: the hostile inbox
    // entries it writes would pollute the functional profiles' assertions,
    // and the API keys it sets/clears must not share a `SecretStorage` with
    // `test/integration/profiles.test.ts`, which asserts on the same keys.
    // `FAKE_TTS` is on: nothing here needs a real engine, and a synthesis
    // attempt against an absent loopback server would only add noise.
    files: "out/test/integration-security/**/*.test.js",
    env: { LLM_VOICE_TEST_FAKE_TTS: "1", LLM_VOICE_INBOX: inboxDirSecurity },
    launchArgs: [`--user-data-dir=${userDataDir("security")}`]
  }
]);
