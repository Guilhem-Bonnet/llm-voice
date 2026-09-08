import * as vscode from "vscode";

let outputChannel: vscode.OutputChannel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel("LLM Voice");
  context.subscriptions.push(outputChannel);

  const helloCommand = vscode.commands.registerCommand("llmVoice.hello", () => {
    outputChannel?.appendLine("LLM Voice: hello command executed.");
  });
  context.subscriptions.push(helloCommand);

  outputChannel.appendLine("LLM Voice extension activated.");
}

export function deactivate(): void {
  outputChannel?.appendLine("LLM Voice extension deactivated.");
}
