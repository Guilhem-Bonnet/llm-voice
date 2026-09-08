/**
 * Public surface of the source-capture layer (CdC §10). Unlike `src/core`,
 * these adapters *do* import `vscode` — they are the integration layer that
 * turns a neutral `CaptureContext` into a `SourceDocument` by reading the
 * active editor, a selection, or the clipboard.
 */

export * from "./captureRange.js";
export * from "./MarkdownDocumentSource.js";
export * from "./TextSelectionSource.js";
export * from "./ClipboardSource.js";
