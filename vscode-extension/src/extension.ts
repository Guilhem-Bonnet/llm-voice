import * as vscode from "vscode";
import * as path from "node:path";
import { PlayerViewProvider } from "./views/player/PlayerViewProvider.js";
import { ProfilesTreeProvider, ProfileTreeItem } from "./views/profiles/ProfilesTreeProvider.js";
import { HighlightController } from "./highlight/HighlightController.js";
import { StatusBar } from "./ui/StatusBar.js";
import { MarkdownSpeakSectionCodeLensProvider } from "./ui/CodeLensProvider.js";
import { registerCommands } from "./commands/index.js";
import type { PipelineFacade } from "./commands/PipelineFacade.js";
import { Pipeline } from "./pipeline/Pipeline.js";
import { ProfileRepository } from "./profiles/ProfileRepository.js";
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
  /** S9 (ADR-011 revision 2026-09-12): the "Profils" Tree View in the dedicated `llmVoice` container. */
  profilesTree: ProfilesTreeProvider;
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
  // S9 (ADR-011 revision 2026-09-12): "Lecture en cours", the same player
  // webview reused as-is (same `PlayerViewProvider`/`buildPlayerHtml`, not
  // rewritten) under a second view id so it can also live in the dedicated
  // `llmVoice` container (`full` layout, now the default) alongside the
  // Panel mini-player (`minimal` layout, still available). `resolveWebviewView`
  // rebinds `player`'s single `WebviewAudioSink` to whichever of the two
  // was resolved last — harmless in the normal case (only one layout's view
  // is ever open at a time), a known, narrow limitation if a user manually
  // opens both simultaneously.
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("llmVoice.playerView", player, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );
  context.subscriptions.push(player);

  // S9: "Profils" Tree View — a read-only `ProfileRepository` instance
  // (same `globalStorageUri`/`profiles.json` file, re-read on every call)
  // purely for listing; every mutation below routes through `pipeline`'s
  // existing `*ById` methods so session state (`currentProfileLabel`, the
  // status bar) stays the single source of truth.
  const profilesRepositoryForViews = new ProfileRepository(
    context.globalStorageUri.fsPath,
    context.globalState
  );
  const profilesTree = new ProfilesTreeProvider(
    () => profilesRepositoryForViews.list(),
    () => profilesRepositoryForViews.getSelected().then((profile) => profile.id)
  );
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("llmVoice.profilesView", profilesTree)
  );
  context.subscriptions.push(profilesTree);
  void profilesTree.refresh();
  // Keeps the tree in sync with edits made outside its own commands (the
  // full Profile Editor webview, `Open Profiles`' JSON editor, `Duplicate
  // Profile`/`Delete Profile` from the palette…).
  const profilesFileWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(path.dirname(profilesRepositoryForViews.uri.fsPath)), "profiles.json")
  );
  context.subscriptions.push(
    profilesFileWatcher,
    profilesFileWatcher.onDidChange(() => void profilesTree.refresh()),
    profilesFileWatcher.onDidCreate(() => void profilesTree.refresh())
  );

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

  // S9 (ADR-011 revision 2026-09-12): "Profils" Tree View hover actions +
  // title button. Registered here rather than `commands/index.ts`, same
  // reasoning as `llmVoice.setupVoice` above — never depends on that
  // file's ownership by another story — and they need `pipeline`'s
  // concrete `*ById` methods (`PipelineFacade` only exposes the
  // interactive, Quick-Pick-driven ones).
  function profileIdFromArg(arg: unknown): string | undefined {
    if (arg instanceof ProfileTreeItem) {
      return arg.data.id;
    }
    return typeof arg === "object" && arg !== null && "id" in arg ? String((arg as { id: unknown }).id) : undefined;
  }
  context.subscriptions.push(
    vscode.commands.registerCommand("llmVoice.profilesView.activate", async (arg?: unknown) => {
      const id = profileIdFromArg(arg);
      if (id === undefined) {
        return;
      }
      await pipeline.selectProfileById(id);
      await profilesTree.refresh();
    }),
    vscode.commands.registerCommand("llmVoice.profilesView.edit", async (arg?: unknown) => {
      const id = profileIdFromArg(arg);
      if (id === undefined) {
        return;
      }
      await pipeline.openProfileEditorById(id);
    }),
    vscode.commands.registerCommand("llmVoice.profilesView.duplicate", async (arg?: unknown) => {
      const id = profileIdFromArg(arg);
      if (id === undefined) {
        return;
      }
      const copy = await pipeline.duplicateProfileById(id);
      await profilesTree.refresh();
      void vscode.window.showInformationMessage(`LLM Voice : profil « ${copy.label} » créé.`);
    }),
    vscode.commands.registerCommand("llmVoice.profilesView.delete", async (arg?: unknown) => {
      const id = profileIdFromArg(arg);
      if (id === undefined) {
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        "LLM Voice : supprimer ce profil ?",
        { modal: true },
        "Supprimer"
      );
      if (confirm !== "Supprimer") {
        return;
      }
      try {
        await pipeline.deleteProfileById(id);
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        return;
      }
      await profilesTree.refresh();
    }),
    // "Nouveau profil" (title button, CdC §6): no blank-profile flow exists
    // yet, so this duplicates the currently active profile (always valid,
    // already configured) and opens it in the editor to rename/customize —
    // same starting point `Duplicate Profile` already gives.
    vscode.commands.registerCommand("llmVoice.profilesView.new", async () => {
      const active = await profilesRepositoryForViews.getSelected();
      const copy = await pipeline.duplicateProfileById(active.id);
      await profilesTree.refresh();
      await pipeline.openProfileEditorById(copy.id);
    }),
    vscode.commands.registerCommand("llmVoice.openSettings", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", "@ext:guilhem-bonnet.llm-voice")
    )
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
    profilesTree,
    pipeline,
    context,
    ...(testAudioSink !== undefined ? { audioSink: testAudioSink } : {}),
    ...(ttsProviderOverride !== undefined ? { ttsProvider: ttsProviderOverride } : {})
  };
}

export function deactivate(): void {
  logger?.info("LLM Voice extension deactivated.");
}
