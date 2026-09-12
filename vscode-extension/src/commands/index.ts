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

  const runCapture = async (
    scope: CaptureScope,
    extra: Partial<CaptureContext> = {}
  ): Promise<void> => {
    const context: CaptureContext = {
      scope,
      ...activeEditorContext(),
      ...extra
    };
    player.reveal();
    await pipeline.start(context);
  };

  const startCapture = (
    scope: CaptureScope,
    buildExtra: () => Partial<CaptureContext> = () => ({})
  ) => {
    return async (): Promise<void> => {
      await runCapture(scope, buildExtra());
    };
  };

  return [
    vscode.commands.registerCommand("llmVoice.speakDocument", startCapture("document")),
    vscode.commands.registerCommand("llmVoice.speakSelection", async () => {
      const editor = vscode.window.activeTextEditor;
      // No silent no-op (S7.3): an empty selection used to build a
      // zero-width `SourceRange` that always ended up matching zero
      // segments — `startInternal` messages that ("rien à lire pour cette
      // sélection") but only *after* opening the player and briefly showing
      // "preparing". Catching it here, before capture even starts, offers
      // the document instead of just reporting the empty result.
      if (editor === undefined || editor.selection.isEmpty) {
        const choice = await vscode.window.showInformationMessage(
          "LLM Voice : aucune sélection. Lire le document entier ?",
          "Lire le document"
        );
        if (choice === "Lire le document") {
          await runCapture("document");
        }
        return;
      }
      await runCapture("selection", { selection: selectionToSourceRange(editor.selection) });
    }),
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
    vscode.commands.registerCommand("llmVoice.playPause", () => pipeline.playPause()),
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
    vscode.commands.registerCommand("llmVoice.performanceReport", () => pipeline.performanceReport()),
    vscode.commands.registerCommand("llmVoice.setProviderApiKey", () => pipeline.setProviderApiKey()),
    vscode.commands.registerCommand("llmVoice.clearProviderApiKey", () => pipeline.clearProviderApiKey()),
    vscode.commands.registerCommand("llmVoice.openInbox", () => pipeline.openInbox()),
    vscode.commands.registerCommand("llmVoice.speakLatestClaudeResponse", () =>
      pipeline.speakLatestClaudeResponse()
    ),
    vscode.commands.registerCommand("llmVoice.clearHighlight", () => {
      // No silent no-op (S7.3): only the *active* editor is checked — good
      // enough to answer "was there anything visibly highlighted here?"
      // without adding a query surface to `HighlightController` (owned by
      // the parallel highlight story).
      const editor = vscode.window.activeTextEditor;
      const ranges = editor ? highlight.getRanges(editor.document.uri) : undefined;
      const hadHighlight = ranges !== undefined && (ranges.current.length > 0 || ranges.stale.length > 0);
      highlight.clear();
      if (!hadHighlight) {
        void vscode.window.showInformationMessage("LLM Voice : aucun surlignage à effacer.");
      }
    }),
    vscode.commands.registerCommand("llmVoice.clearAudioCache", async () => {
      // Confirmation lives here, not in `Pipeline.clearAudioCache()`: that
      // method is also called directly, non-interactively, by integration
      // tests resetting the disk cache between cases (a confirm dialog
      // there would hit test-electron's `DialogService`, which refuses
      // modals under test and throws). `Pipeline.clearAudioCache()` still
      // reports "déjà vide"/the freed space either way.
      const confirmed = await vscode.window.showWarningMessage(
        "LLM Voice : vider le cache audio ?",
        { modal: true },
        "Vider le cache"
      );
      if (confirmed !== "Vider le cache") {
        return;
      }
      await pipeline.clearAudioCache();
    }),
    vscode.commands.registerCommand("llmVoice.verifyLocalMode", () => pipeline.verifyLocalMode()),
    vscode.commands.registerCommand("llmVoice.installClaudeHook", () => pipeline.installClaudeHook()),
    vscode.commands.registerCommand("llmVoice.uninstallClaudeHook", () => pipeline.uninstallClaudeHook()),
    vscode.commands.registerCommand("llmVoice.installPiperVoice", () => pipeline.installPiperVoice()),
    vscode.commands.registerCommand("llmVoice.browseVoices", () => pipeline.browseVoices()),
    vscode.commands.registerCommand("llmVoice.useOwnVoice", () => pipeline.useOwnVoice()),
    vscode.commands.registerCommand("llmVoice.editProfile", () => pipeline.editProfile())
  ];
}
