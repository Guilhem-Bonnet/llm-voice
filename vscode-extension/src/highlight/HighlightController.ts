/**
 * Editor highlight driven by chunk transitions, never by `timeupdate`
 * (ADR-002, D4). Two decoration types: `current` (playing segment) and
 * `stale` (segment invalidated by an edit, D6).
 */

import * as vscode from "vscode";
import type { SourceRange } from "../core/source.js";
import { shouldReveal, type PlainRange } from "./viewport.js";

export { shouldReveal } from "./viewport.js";

export function sourceRangeToRange(sourceRange: SourceRange): vscode.Range {
  return new vscode.Range(
    sourceRange.startLine,
    sourceRange.startColumn,
    sourceRange.endLine,
    sourceRange.endColumn
  );
}

function toPlainRange(range: vscode.Range): PlainRange {
  return {
    start: { line: range.start.line, column: range.start.character },
    end: { line: range.end.line, column: range.end.character }
  };
}

interface UriHighlightState {
  current: vscode.Range[];
  stale: vscode.Range[];
}

export class HighlightController implements vscode.Disposable {
  private readonly currentType: vscode.TextEditorDecorationType;
  private readonly staleType: vscode.TextEditorDecorationType;
  private readonly byUri = new Map<string, UriHighlightState>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly isEnabled: () => boolean = () => true) {
    this.currentType = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
      overviewRulerColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
      overviewRulerLane: vscode.OverviewRulerLane.Center,
      isWholeLine: false
    });
    this.staleType = vscode.window.createTextEditorDecorationType({
      textDecoration: "underline dotted",
      overviewRulerColor: new vscode.ThemeColor("editorWarning.foreground"),
      overviewRulerLane: vscode.OverviewRulerLane.Center
    });

    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors(() => this.reapplyAll())
    );
  }

  /** Poses the `current` decoration on every visible editor for `uri`. */
  show(uri: vscode.Uri, ranges: readonly SourceRange[], reveal = true): void {
    this.set(uri, "current", ranges, reveal);
  }

  /** Poses the `stale` decoration (D6): an edit touched an unread segment. */
  showStale(uri: vscode.Uri, ranges: readonly SourceRange[]): void {
    this.set(uri, "stale", ranges, false);
  }

  /** Removes both decoration kinds for `uri`, or every tracked uri if absent. */
  clear(uri?: vscode.Uri): void {
    if (uri) {
      this.byUri.delete(uri.toString());
    } else {
      this.byUri.clear();
    }
    this.reapplyAll();
  }

  /** Snapshot of decorations currently tracked for `uri`. Test hook. */
  getRanges(uri: vscode.Uri): { current: vscode.Range[]; stale: vscode.Range[] } | undefined {
    const state = this.byUri.get(uri.toString());
    return state ? { current: [...state.current], stale: [...state.stale] } : undefined;
  }

  dispose(): void {
    this.currentType.dispose();
    this.staleType.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private set(
    uri: vscode.Uri,
    kind: keyof UriHighlightState,
    sourceRanges: readonly SourceRange[],
    reveal: boolean
  ): void {
    if (!this.isEnabled()) {
      return;
    }
    const key = uri.toString();
    const state = this.byUri.get(key) ?? { current: [], stale: [] };
    const ranges = sourceRanges.map(sourceRangeToRange);
    state[kind] = ranges;
    if (kind === "current") {
      state.stale = [];
    } else {
      state.current = [];
    }
    this.byUri.set(key, state);
    this.applyToEditors(uri, state, reveal);
  }

  private reapplyAll(): void {
    for (const [key, state] of this.byUri) {
      this.applyToEditors(vscode.Uri.parse(key), state, false);
    }
    // Editors no longer tracked must have their decorations cleared too.
    for (const editor of vscode.window.visibleTextEditors) {
      if (!this.byUri.has(editor.document.uri.toString())) {
        editor.setDecorations(this.currentType, []);
        editor.setDecorations(this.staleType, []);
      }
    }
  }

  private applyToEditors(uri: vscode.Uri, state: UriHighlightState, reveal: boolean): void {
    const editors = vscode.window.visibleTextEditors.filter(
      (editor) => editor.document.uri.toString() === uri.toString()
    );
    for (const editor of editors) {
      editor.setDecorations(this.currentType, state.current);
      editor.setDecorations(this.staleType, state.stale);
      if (reveal && state.current.length > 0) {
        const range = state.current[0];
        const visible = editor.visibleRanges.map(toPlainRange);
        if (range && shouldReveal(toPlainRange(range), visible)) {
          editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        }
      }
    }
  }
}
