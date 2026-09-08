/**
 * Pure Markdown heading detection used by the "▶ Lire cette section" CodeLens
 * (CdC §69). Free of any `vscode` import so it can be unit tested in plain
 * Node.
 */

const HEADING_PATTERN = /^#{1,6}\s+\S/;

export function isHeadingLine(text: string): boolean {
  return HEADING_PATTERN.test(text);
}
