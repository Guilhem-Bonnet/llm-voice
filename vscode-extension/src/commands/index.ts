/**
 * Registers every command from CdC §7. Commands that need the synthesis
 * pipeline (not wired until S3.5) call through the injected `PipelineFacade`;
 * `clearHighlight` is the only one handled purely locally.
 */

import * as vscode from "vscode";
import type { CaptureContext, CaptureScope, SourceRange } from "../core/source.js";
import type { HighlightController } from "../highlight/HighlightController.js";
import type { PlayerViewProvider } from "../views/player/PlayerViewProvider.js";
import type { SpeakSectionArgs } from "../ui/CodeLensProvider.js";
import type { PipelineFacade } from "./PipelineFacade.js";

export interface CommandDependencies {
  pipeline: PipelineFacade;
  highlight: HighlightController;
  player: PlayerViewProvider;
}

function selectionToSourceRange(selection: vscode.Selection): SourceRange {
  return {
    startLine: selection.start.line,
    startColumn: selection.start.character,
    endLine: selection.end.line,
    endColumn: selection.end.character
  };
}

function activeEditorContext(): Pick<CaptureContext, "uri" | "languageId"> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return {};
  }
  return {
    uri: editor.document.uri.toString(),
    languageId: editor.document.languageId
  };
}

/** Registers all `llmVoice.*` commands and returns their disposables. */
export function registerCommands(deps: CommandDependencies): vscode.Disposable[] {
  const { pipeline, highlight, player } = deps;

  const startCapture = (
    scope: CaptureScope,
    buildExtra: () => Partial<CaptureContext> = () => ({})
  ) => {
    return async (): Promise<void> => {
      const context: CaptureContext = {
        scope,
        ...activeEditorContext(),
        ...buildExtra()
      };
      player.reveal();
      await pipeline.start(context);
    };
  };

  return [
    vscode.commands.registerCommand("llmVoice.speakDocument", startCapture("document")),
    vscode.commands.registerCommand(
      "llmVoice.speakSelection",
      startCapture("selection", () => {
        const editor = vscode.window.activeTextEditor;
        return editor ? { selection: selectionToSourceRange(editor.selection) } : {};
      })
    ),
    vscode.commands.registerCommand(
      "llmVoice.speakFromCursor",
      startCapture("from-cursor", () => {
        const editor = vscode.window.activeTextEditor;
        return editor
          ? { cursor: { line: editor.selection.active.line, column: editor.selection.active.character } }
          : {};
      })
    ),
    vscode.commands.registerCommand("llmVoice.speakSection", async (args?: SpeakSectionArgs) => {
      const context: CaptureContext = {
        scope: "section",
        ...activeEditorContext(),
        ...(args ? { uri: args.uri, cursor: { line: args.line, column: 0 } } : {})
      };
      player.reveal();
      await pipeline.start(context);
    }),
    vscode.commands.registerCommand("llmVoice.speakClipboard", async () => {
      const text = await vscode.env.clipboard.readText();
      const context: CaptureContext = { scope: "clipboard", text };
      player.reveal();
      await pipeline.start(context);
    }),
    vscode.commands.registerCommand("llmVoice.play", () => pipeline.play()),
    vscode.commands.registerCommand("llmVoice.pause", () => pipeline.pause()),
    vscode.commands.registerCommand("llmVoice.stop", () => pipeline.stop()),
    vscode.commands.registerCommand("llmVoice.previousSegment", () => pipeline.previousSegment()),
    vscode.commands.registerCommand("llmVoice.nextSegment", () => pipeline.nextSegment()),
    vscode.commands.registerCommand("llmVoice.selectProfile", () => pipeline.selectProfile()),
    vscode.commands.registerCommand("llmVoice.openProfiles", () => pipeline.openProfiles()),
    vscode.commands.registerCommand("llmVoice.duplicateProfile", () => pipeline.duplicateProfile()),
    vscode.commands.registerCommand("llmVoice.deleteProfile", () => pipeline.deleteProfile()),
    vscode.commands.registerCommand("llmVoice.importProfile", () => pipeline.importProfile()),
    vscode.commands.registerCommand("llmVoice.exportProfile", () => pipeline.exportProfile()),
    vscode.commands.registerCommand("llmVoice.setDefaultProfile", () => pipeline.setDefaultProfile()),
    vscode.commands.registerCommand("llmVoice.testVoice", () => pipeline.testVoice()),
    vscode.commands.registerCommand("llmVoice.providerStatus", () => pipeline.providerStatus()),
    vscode.commands.registerCommand("llmVoice.setProviderApiKey", () => pipeline.setProviderApiKey()),
    vscode.commands.registerCommand("llmVoice.clearProviderApiKey", () => pipeline.clearProviderApiKey()),
    vscode.commands.registerCommand("llmVoice.openInbox", () => pipeline.openInbox()),
    vscode.commands.registerCommand("llmVoice.speakLatestClaudeResponse", () =>
      pipeline.speakLatestClaudeResponse()
    ),
    vscode.commands.registerCommand("llmVoice.clearHighlight", () => highlight.clear()),
    vscode.commands.registerCommand("llmVoice.clearAudioCache", () => pipeline.clearAudioCache()),
    vscode.commands.registerCommand("llmVoice.verifyLocalMode", () => pipeline.verifyLocalMode()),
    vscode.commands.registerCommand("llmVoice.installClaudeHook", () => pipeline.installClaudeHook()),
    vscode.commands.registerCommand("llmVoice.uninstallClaudeHook", () => pipeline.uninstallClaudeHook())
  ];
}
