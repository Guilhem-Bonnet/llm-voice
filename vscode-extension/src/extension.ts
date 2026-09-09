import * as vscode from "vscode";
import * as path from "node:path";
import { PlayerViewProvider } from "./views/player/PlayerViewProvider.js";
import { HighlightController } from "./highlight/HighlightController.js";
import { StatusBar } from "./ui/StatusBar.js";
import { MarkdownSpeakSectionCodeLensProvider } from "./ui/CodeLensProvider.js";
import { registerCommands } from "./commands/index.js";
import type { PipelineFacade } from "./commands/PipelineFacade.js";
import { Pipeline } from "./pipeline/Pipeline.js";
import type { AudioSink } from "./playback/index.js";
import type { TtsProvider } from "./core/tts.js";
import type { PlayerUserAction } from "./core/playback.js";
import { createLogger, parseLogLevel, type Logger } from "./infrastructure/logger.js";
import { setupVoice } from "./onboarding/SetupVoice.js";
import { openWalkthroughExample, openWalkthroughOnFirstActivation } from "./onboarding/Walkthrough.js";
// Type-only: erased at compile time, never pulls `test/fakes/*` into the
// bundle (see `requireTestFixture` below for the runtime-safe counterpart).
import type { FakeAudioSink } from "../test/fakes/FakeAudioSink.js";

let outputChannel: vscode.OutputChannel | undefined;
let logger: Logger | undefined;

/** `llmVoice.log.level` (default `info`, CdC §81). */
function readLogLevel(): ReturnType<typeof parseLogLevel> {
  return parseLogLevel(vscode.workspace.getConfiguration("llmVoice").get<string>("log.level"));
}

/**
 * Surface returned by `activate()` so integration tests can reach internal
 * state that has no dedicated VS Code query API (status bar text, tracked
 * highlight ranges, webview resolution). Not a public extension API.
 */
export interface ExtensionTestApi {
  highlight: HighlightController;
  player: PlayerViewProvider;
  statusBar: StatusBar;
  pipeline: PipelineFacade;
  /**
   * Test-only: lets integration tests assert on `SecretStorage`/`globalState`
   * directly (AC-SEC-08 — a provider API key must live in `secrets` and
   * never in `globalState`). Not a public extension API.
   */
  context: vscode.ExtensionContext;
  /**
   * Only set when `LLM_VOICE_TEST_FAKE_TTS=1` was honoured (dev/test mode,
   * see `docs/testing.md`): the webview never decodes audio under `xvfb`, so
   * integration tests observe playback through this fake instead.
   */
  audioSink?: FakeAudioSink;
  /** Same gate as `audioSink`: lets tests inspect `FakeTtsProvider.requests`. */
  ttsProvider?: TtsProvider;
}

function isHighlightEnabled(): boolean {
  return vscode.workspace.getConfiguration("llmVoice").get<boolean>("highlight.enabled", true);
}

function isCodeLensEnabled(): boolean {
  return vscode.workspace.getConfiguration("llmVoice").get<boolean>("codeLens.enabled", true);
}

/**
 * `LLM_VOICE_TEST_FAKE_TTS=1` is only ever honoured outside `ExtensionMode.Production`
 * (never a VSIX release): a malicious `profiles.json` or environment cannot
 * make a real install skip the network and fabricate audio.
 */
function isTestFakeTtsEnabled(context: vscode.ExtensionContext): boolean {
  return (
    context.extensionMode !== vscode.ExtensionMode.Production &&
    process.env.LLM_VOICE_TEST_FAKE_TTS === "1"
  );
}

/**
 * Loads a compiled test fixture from `out/test/fakes` via a runtime-built
 * path. `esbuild` can only inline a `require()`/`import()` whose argument is
 * a string literal it can resolve at bundle time; building the path from
 * `context.extensionUri` at runtime keeps it a genuine dynamic `require`, so
 * `dist/extension.js` never embeds `test/fakes/*` (also excluded from the
 * VSIX by `.vscodeignore`'s `test/**`/`out/**` rules) — on top of the
 * `extensionMode` guard above, this is what makes it impossible to reach
 * even by tampering with the environment of a packaged install.
 */
function requireTestFixture<T>(context: vscode.ExtensionContext, fileName: string): T {
  const modulePath = path.join(context.extensionUri.fsPath, "out", "test", "fakes", fileName);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(modulePath) as T;
}

export function activate(context: vscode.ExtensionContext): ExtensionTestApi {
  // `{ log: true }` (available since VS Code 1.74) returns a
  // `LogOutputChannel`: native `error`/`warn`/`info`/`debug` methods with
  // VS Code's own timestamp/colouring — `Logger` uses them when present and
  // falls back to `appendLine` otherwise (see `src/infrastructure/logger.ts`).
  outputChannel = vscode.window.createOutputChannel("LLM Voice", { log: true });
  context.subscriptions.push(outputChannel);
  const log = createLogger(outputChannel, readLogLevel());
  logger = log;
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("llmVoice.log.level")) {
        log.setLevel(readLogLevel());
      }
    })
  );

  const player = new PlayerViewProvider(context.extensionUri, context.globalStorageUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(PlayerViewProvider.viewType, player, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );
  context.subscriptions.push(player);

  const highlight = new HighlightController(isHighlightEnabled);
  context.subscriptions.push(highlight);

  const codeLensProvider = new MarkdownSpeakSectionCodeLensProvider(isCodeLensEnabled);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ language: "markdown" }, codeLensProvider)
  );
  context.subscriptions.push(codeLensProvider);

  let sinkOverride: AudioSink | undefined;
  let ttsProviderOverride: TtsProvider | undefined;
  let testAudioSink: FakeAudioSink | undefined;

  if (isTestFakeTtsEnabled(context)) {
    try {
      const ttsModule = requireTestFixture<{
        FakeTtsProvider: new (options?: { failFromNth?: number }) => TtsProvider;
      }>(context, "FakeTtsProvider.js");
      const sinkModule = requireTestFixture<{ FakeAudioSink: new () => FakeAudioSink }>(
        context,
        "FakeAudioSink.js"
      );
      testAudioSink = new sinkModule.FakeAudioSink();
      sinkOverride = testAudioSink;
      // S5.3/AC-16 "chunk invalide" integration test only: deterministically
      // fails every chunk from the Nth call onward (never a race on
      // `failEveryNth`'s modulo) so it reaches the "later chunk" Skip/Stop
      // path instead of the first-chunk "TTS unavailable" one. Same
      // dev/test-mode + explicit env-var gate as `LLM_VOICE_TEST_FAKE_TTS`
      // itself — never reachable from a packaged install.
      const failFromNthRaw = process.env.LLM_VOICE_TEST_FAKE_TTS_FAIL_FROM;
      const failFromNth = failFromNthRaw !== undefined ? Number(failFromNthRaw) : undefined;
      ttsProviderOverride = new ttsModule.FakeTtsProvider(
        failFromNth !== undefined && Number.isFinite(failFromNth) ? { failFromNth } : undefined
      );
      log.info("LLM_VOICE_TEST_FAKE_TTS=1 — using FakeTtsProvider + FakeAudioSink (docs/testing.md).");
    } catch (error) {
      log.error("failed to load test fixtures", { error: String(error) });
    }
  }

  // `statusBar`'s click-menu needs to call back into the pipeline, and the
  // pipeline needs `statusBar` to push state onto it: a plain forward
  // reference (rather than a `let pipeline` read before assignment) avoids
  // any TDZ/definite-assignment subtlety.
  const pipelineRef: { current: PipelineFacade | undefined } = { current: undefined };

  const statusBarMenuCommand = "llmVoice.statusBar.openMenu";
  const statusBar = new StatusBar((choice) => {
    switch (choice) {
      case "resume":
        void pipelineRef.current?.play();
        break;
      case "pause":
        void pipelineRef.current?.pause();
        break;
      case "stop":
        void pipelineRef.current?.stop();
        break;
      case "selectProfile":
        void pipelineRef.current?.selectProfile();
        break;
      case "openInbox":
        void pipelineRef.current?.openInbox();
        break;
      case "providerStatus":
        void pipelineRef.current?.providerStatus();
        break;
      case "verifyLocalMode":
        void pipelineRef.current?.verifyLocalMode();
        break;
      default:
        break;
    }
  }, statusBarMenuCommand);
  context.subscriptions.push(statusBar);
  context.subscriptions.push(
    vscode.commands.registerCommand(statusBarMenuCommand, () => statusBar.openMenu())
  );

  // S7.2 (onboarding): registered here rather than `commands/index.ts` so
  // this story never has to depend on that file's ownership by S7.1/S7.3.
  context.subscriptions.push(
    vscode.commands.registerCommand("llmVoice.setupVoice", () => setupVoice())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("llmVoice.walkthroughOpenExample", () => openWalkthroughExample(context))
  );

  const pipeline = new Pipeline({
    context,
    output: log,
    highlight,
    player,
    statusBar,
    ...(sinkOverride !== undefined ? { sinkOverride } : {}),
    ...(ttsProviderOverride !== undefined ? { ttsProviderOverride } : {})
  });
  pipelineRef.current = pipeline;
  context.subscriptions.push({ dispose: () => pipeline.dispose() });

  // Mini-player transport buttons (ADR-001 `userAction`), independent of
  // which sink actually drives playback.
  context.subscriptions.push({
    dispose: player.audioSink.onUserAction((action: PlayerUserAction) => {
      switch (action) {
        case "play":
          void pipeline.play();
          break;
        case "pause":
          void pipeline.pause();
          break;
        case "stop":
          void pipeline.stop();
          break;
        case "next":
          void pipeline.nextSegment();
          break;
        case "prev":
          void pipeline.previousSegment();
          break;
        case "selectProfile":
          void pipeline.selectProfile();
          break;
        case "setupVoice":
          void vscode.commands.executeCommand("llmVoice.setupVoice");
          break;
        case "speakCurrentDocument":
          void vscode.commands.executeCommand("llmVoice.speakDocument");
          break;
        default:
          break;
      }
    })
  });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("llmVoice.codeLens.enabled")) {
        codeLensProvider.refresh();
      }
    })
  );

  for (const disposable of registerCommands({ pipeline, highlight, player })) {
    context.subscriptions.push(disposable);
  }

  log.info("LLM Voice extension activated.");

  // First activation only (`globalState`, never again) — never under
  // `vscode-test` (`ExtensionMode.Test`), see `Walkthrough.ts`.
  void openWalkthroughOnFirstActivation(context);

  return {
    highlight,
    player,
    statusBar,
    pipeline,
    context,
    ...(testAudioSink !== undefined ? { audioSink: testAudioSink } : {}),
    ...(ttsProviderOverride !== undefined ? { ttsProvider: ttsProviderOverride } : {})
  };
}

export function deactivate(): void {
  logger?.info("LLM Voice extension deactivated.");
}
