/**
 * Registers every command from CdC §7. Commands that need the synthesis
 * pipeline (not wired until S3.5) call through the injected `PipelineFacade`;
 * `clearHighlight` is the only one handled purely locally.
 */

import { matchPreviewSource, previewFileName } from "./previewSource.js";
import * as vscode from "vscode";
import { normalizeSelections, type CaptureContext, type CaptureScope, type SourceRange } from "../core/source.js";
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

/** The document behind the focused Markdown preview, which is a webview with no text editor. */
async function markdownPreviewContext(): Promise<Pick<CaptureContext, "uri" | "languageId">> {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (!(tab?.input instanceof vscode.TabInputWebview) || !tab.input.viewType.includes("markdown.preview")) {
    return {};
  }
  const name = previewFileName(tab.label);
  if (name === undefined) {
    return {};
  }
  const open = vscode.workspace.textDocuments.map((document) => document.uri.toString());
  const inTabs = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .flatMap((other) => (other.input instanceof vscode.TabInputText ? [other.input.uri.toString()] : []));
  let source = matchPreviewSource(name, [...open, ...inTabs]);
  if (source.kind === "none") {
    const glob = `**/${name.replace(/[[\]{}*?]/g, "?")}`;
    const files = await vscode.workspace.findFiles(glob, "**/node_modules/**", 5);
    source = matchPreviewSource(name, files.map((uri) => uri.toString()));
  }
  if (source.kind === "found") {
    return { uri: source.uri, languageId: "markdown" };
  }
  void vscode.window.showInformationMessage(
    source.kind === "ambiguous"
      ? `LLM Voice : plusieurs fichiers s'appellent « ${name} ». Ouvrez le bon fichier, puis lancez la lecture.`
      : `LLM Voice : fichier « ${name} » introuvable. Ouvrez-le, puis lancez la lecture.`
  );
  return {};
}

/** Registers all `llmVoice.*` commands and returns their disposables. */
export function registerCommands(deps: CommandDependencies): vscode.Disposable[] {
  const { pipeline, highlight, player } = deps;

  const runCapture = async (
    scope: CaptureScope,
    extra: Partial<CaptureContext> = {}
  ): Promise<void> => {
    const editorContext = activeEditorContext();
    const context: CaptureContext = {
      scope,
      ...(editorContext.uri === undefined && scope === "document" ? await markdownPreviewContext() : editorContext),
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
      const passages = editor === undefined ? [] : normalizeSelections(editor.selections.map(selectionToSourceRange));
      const first = passages[0];
      if (first === undefined) {
        const choice = await vscode.window.showInformationMessage(
          "LLM Voice : aucune sélection. Lire le document entier ?",
          "Lire le document"
        );
        if (choice === "Lire le document") {
          await runCapture("document");
        }
        return;
      }
      await runCapture("selection", {
        selection: first,
        ...(passages.length > 1 ? { selections: passages } : {})
      });
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
    // ADR-017 §3: an id once published stays executable, a user's shortcut may name
    // it. An alias does the same thing and is hidden from the palette.
    vscode.commands.registerCommand("llmVoice.chooseMode", () => pipeline.chooseMode()),
    vscode.commands.registerCommand("llmVoice.selectProfile", () => pipeline.chooseMode()),
    vscode.commands.registerCommand("llmVoice.chooseVoice", () => pipeline.chooseVoice()),
    vscode.commands.registerCommand("llmVoice.setupVoice", () => pipeline.chooseVoice()),
    vscode.commands.registerCommand("llmVoice.openVoiceGallery", () => pipeline.openVoiceGallery()),
    vscode.commands.registerCommand("llmVoice.browseVoices", () => pipeline.openVoiceGallery()),
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
    vscode.commands.registerCommand("llmVoice.useOwnVoice", () => pipeline.useOwnVoice()),
    vscode.commands.registerCommand("llmVoice.editProfile", () => pipeline.editProfile())
  ];
}
