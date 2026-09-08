import * as vscode from "vscode";
import { PlayerViewProvider } from "./views/player/PlayerViewProvider.js";
import { HighlightController } from "./highlight/HighlightController.js";
import { StatusBar } from "./ui/StatusBar.js";
import { MarkdownSpeakSectionCodeLensProvider } from "./ui/CodeLensProvider.js";
import { NotWiredPipeline } from "./commands/PipelineFacade.js";
import { registerCommands } from "./commands/index.js";

let outputChannel: vscode.OutputChannel | undefined;

/**
 * Surface returned by `activate()` so integration tests can reach internal
 * state that has no dedicated VS Code query API (status bar text, tracked
 * highlight ranges, webview resolution). Not a public extension API.
 */
export interface ExtensionTestApi {
  highlight: HighlightController;
  player: PlayerViewProvider;
  statusBar: StatusBar;
}

function isHighlightEnabled(): boolean {
  return vscode.workspace.getConfiguration("llmVoice").get<boolean>("highlight.enabled", true);
}

function isCodeLensEnabled(): boolean {
  return vscode.workspace.getConfiguration("llmVoice").get<boolean>("codeLens.enabled", true);
}

export function activate(context: vscode.ExtensionContext): ExtensionTestApi {
  outputChannel = vscode.window.createOutputChannel("LLM Voice");
  context.subscriptions.push(outputChannel);

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

  const pipeline = new NotWiredPipeline(outputChannel);

  const statusBarMenuCommand = "llmVoice.statusBar.openMenu";
  const statusBar = new StatusBar((choice) => {
    switch (choice) {
      case "resume":
        void pipeline.play();
        break;
      case "stop":
        void pipeline.stop();
        break;
      case "selectProfile":
        void pipeline.selectProfile();
        break;
      default:
        break;
    }
  }, statusBarMenuCommand);
  context.subscriptions.push(statusBar);
  context.subscriptions.push(
    vscode.commands.registerCommand(statusBarMenuCommand, () => statusBar.openMenu())
  );

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

  outputChannel.appendLine("LLM Voice extension activated.");

  return { highlight, player, statusBar };
}

export function deactivate(): void {
  outputChannel?.appendLine("LLM Voice extension deactivated.");
}
