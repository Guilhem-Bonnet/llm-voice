/**
 * The Markdown preview is a webview: `activeTextEditor` is undefined there and its tab
 * exposes no document uri, only a label ("Preview notes.md", "Aperçu notes.md"). This
 * finds the source from that name, among what is open first, and refuses to guess when
 * two files share it.
 */

export function previewFileName(tabLabel: string): string | undefined {
  const name = tabLabel.trim().split(/\s+/).slice(1).join(" ");
  return name.length > 0 ? name : undefined;
}

export type PreviewSource =
  | { kind: "found"; uri: string }
  | { kind: "none" }
  | { kind: "ambiguous"; uris: readonly string[] };

export function matchPreviewSource(fileName: string, openUris: readonly string[]): PreviewSource {
  const suffix = `/${encodeURIComponent(fileName).replace(/%2F/g, "/")}`;
  const matches = [...new Set(openUris)].filter((uri) => uri.endsWith(suffix));
  if (matches.length === 0) {
    return { kind: "none" };
  }
  return matches.length === 1 ? { kind: "found", uri: matches[0] as string } : { kind: "ambiguous", uris: matches };
}
