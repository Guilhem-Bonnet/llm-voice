/**
 * Markdown → `SourceBlock[]` (CdC §11-12, ADR-006).
 *
 * Module loading note: `unified`, `remark-parse`, `remark-gfm`,
 * `remark-frontmatter` and `mdast-util-to-string` are ESM-only packages
 * (their published `package.json` declares `"type": "module"`). This
 * package compiles to CommonJS (`tsconfig.json` has no `"type": "module"`
 * and `module`/`moduleResolution` are `Node16`, which follows
 * `package.json#type`, itself absent here, so it defaults to CJS). A CJS
 * module cannot `require()` an ESM-only package, so this module loads them
 * with a cached dynamic `import()` instead of a static `import`, and
 * `typeof import("unified")`-style type queries carry an explicit
 * `resolution-mode: "import"` attribute (TS requires it for type-only
 * references into an ESM package from a CJS file). `parseMarkdown` is
 * therefore `async`. Everything that does not need those packages
 * (`treeToBlocks`, `renderInline`, ...) stays a plain synchronous function,
 * with a small built-in fallback for the one thing normally delegated to
 * `mdast-util-to-string`, so it can be unit tested without the loader.
 */

import type { Root, RootContent, Table, TableRow } from "mdast";
import type { SourceRange } from "../core/source.js";
import type { SourceBlock, TableContent } from "./types.js";

interface MarkdownModules {
  unified: typeof import("unified", { with: { "resolution-mode": "import" } }).unified;
  remarkParse: typeof import("remark-parse", { with: { "resolution-mode": "import" } }).default;
  remarkGfm: typeof import("remark-gfm", { with: { "resolution-mode": "import" } }).default;
  remarkFrontmatter: typeof import("remark-frontmatter", { with: { "resolution-mode": "import" } }).default;
  toPlainText: PlainTextFn;
}

let modulesPromise: Promise<MarkdownModules> | undefined;

async function loadMarkdownModules(): Promise<MarkdownModules> {
  modulesPromise ??= (async () => {
    const [{ unified }, remarkParseModule, remarkGfmModule, remarkFrontmatterModule, toStringModule] =
      await Promise.all([
        import("unified"),
        import("remark-parse"),
        import("remark-gfm"),
        import("remark-frontmatter"),
        import("mdast-util-to-string")
      ]);
    return {
      unified,
      remarkParse: remarkParseModule.default,
      remarkGfm: remarkGfmModule.default,
      remarkFrontmatter: remarkFrontmatterModule.default,
      toPlainText: toStringModule.toString
    };
  })();
  return modulesPromise;
}

/** Parses `text` into an MDAST tree, without walking it yet. */
async function parseToTree(text: string): Promise<{ tree: Root; toPlainText: PlainTextFn }> {
  const { unified, remarkParse, remarkGfm, remarkFrontmatter, toPlainText } = await loadMarkdownModules();
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ["yaml"]);
  return { tree: processor.parse(text) as Root, toPlainText };
}

/**
 * Parses a Markdown document into a flat list of top-level `SourceBlock`s.
 * `uri` is accepted for call-site symmetry with `SourceAdapter.capture` but
 * is not stored on the block: `sourceUri` is stamped by the caller when
 * building `SourceSegment`s (see `src/core/source.ts`), keeping `SourceBlock`
 * itself free of any per-document identity concern.
 */
export async function parseMarkdown(text: string, _uri?: string): Promise<SourceBlock[]> {
  const { tree, toPlainText } = await parseToTree(text);
  return treeToBlocks(tree, text, toPlainText);
}

/** Serializes the plain-text content of a node; used for link/reference labels and as a last-resort fallback. */
type PlainTextFn = (node: unknown) => string;

/**
 * Minimal, dependency-free equivalent of `mdast-util-to-string` (prefers
 * `value`, then a non-empty `alt`, then recurses into `children`). Used as
 * the default `toPlainText` so `treeToBlocks` stays synchronously testable;
 * production calls (`parseMarkdown`) inject the real `mdast-util-to-string`
 * instead, which is the story's required dependency.
 */
function fallbackToPlainText(node: unknown): string {
  if (node && typeof node === "object") {
    const record = node as { value?: unknown; alt?: unknown; children?: unknown };
    if (typeof record.value === "string") {
      return record.value;
    }
    if (typeof record.alt === "string" && record.alt) {
      return record.alt;
    }
    if (Array.isArray(record.children)) {
      return record.children.map(fallbackToPlainText).join("");
    }
  }
  return "";
}

/** Pure, synchronous walk of an already-parsed MDAST tree. Exported for tests. */
export function treeToBlocks(tree: Root, sourceText: string, toPlainText: PlainTextFn = fallbackToPlainText): SourceBlock[] {
  const blocks: SourceBlock[] = [];
  for (const node of tree.children) {
    const block = nodeToBlock(node, sourceText, toPlainText);
    if (block) {
      blocks.push(block);
    }
  }
  return blocks;
}

function toSourceRange(position: NonNullable<RootContent["position"]>): SourceRange {
  return {
    startLine: position.start.line - 1,
    startColumn: position.start.column - 1,
    endLine: position.end.line - 1,
    endColumn: position.end.column - 1
  };
}

function isStandaloneImage(children: RootContent[]): boolean {
  return children.length === 1 && (children[0]?.type === "image" || children[0]?.type === "imageReference");
}

/** Renders inline content (children of a paragraph/heading/cell) to semi-plain text. */
function renderInline(node: RootContent, toPlainText: PlainTextFn): string {
  switch (node.type) {
    case "text":
      return node.value;
    case "inlineCode":
      return `\`${node.value}\``;
    case "link":
    case "linkReference":
      return toPlainText(node);
    case "image":
    case "imageReference":
      return "alt" in node && node.alt ? node.alt : "";
    case "break":
      return " ";
    case "html":
      return node.value;
    default:
      if ("children" in node && Array.isArray(node.children)) {
        return (node.children as RootContent[]).map((child) => renderInline(child, toPlainText)).join("");
      }
      return toPlainText(node);
  }
}

function renderChildrenText(children: RootContent[], toPlainText: PlainTextFn): string {
  return children.map((child) => renderInline(child, toPlainText)).join("").trim();
}

function extractTable(node: Table, toPlainText: PlainTextFn): TableContent {
  const [headerRow, ...dataRows] = node.children;
  const rowToCells = (row: TableRow | undefined): string[] =>
    row ? row.children.map((cell) => renderChildrenText(cell.children, toPlainText)) : [];
  return {
    headers: rowToCells(headerRow),
    rows: dataRows.map(rowToCells)
  };
}

function slice(sourceText: string, position: NonNullable<RootContent["position"]>): {
  startOffset: number;
  endOffset: number;
  rawSource: string;
} {
  const startOffset = position.start.offset ?? 0;
  const endOffset = position.end.offset ?? startOffset;
  return { startOffset, endOffset, rawSource: sourceText.slice(startOffset, endOffset) };
}

function nodeToBlock(node: RootContent, sourceText: string, toPlainText: PlainTextFn): SourceBlock | null {
  const position = node.position;
  if (!position) {
    return null;
  }
  const base = {
    sourceRange: toSourceRange(position),
    ...slice(sourceText, position)
  };

  switch (node.type) {
    case "heading":
      return {
        ...base,
        type: "heading",
        depth: node.depth,
        text: renderChildrenText(node.children, toPlainText)
      };

    case "paragraph": {
      if (isStandaloneImage(node.children)) {
        const image = node.children[0] as Extract<RootContent, { type: "image" }>;
        return {
          ...base,
          type: "image",
          text: image.alt ?? "",
          ...(image.url ? { url: image.url } : {})
        };
      }
      return { ...base, type: "paragraph", text: renderChildrenText(node.children, toPlainText) };
    }

    case "blockquote": {
      const children = node.children
        .map((child) => nodeToBlock(child, sourceText, toPlainText))
        .filter((child): child is SourceBlock => child !== null);
      return {
        ...base,
        type: "blockquote",
        text: children.map((child) => child.text).join(" "),
        children
      };
    }

    case "list": {
      const children = node.children
        .map((item) => nodeToBlock(item, sourceText, toPlainText))
        .filter((child): child is SourceBlock => child !== null);
      return {
        ...base,
        type: "list",
        text: children.map((child) => child.text).join("; "),
        children
      };
    }

    case "listItem": {
      const children = node.children
        .map((child) => nodeToBlock(child, sourceText, toPlainText))
        .filter((child): child is SourceBlock => child !== null);
      return {
        ...base,
        type: "listItem",
        text: children.map((child) => child.text).join(" "),
        children
      };
    }

    case "code":
      return {
        ...base,
        type: "code",
        text: node.value,
        ...(node.lang ? { lang: node.lang } : {})
      };

    case "table": {
      const table = extractTable(node, toPlainText);
      return {
        ...base,
        type: "table",
        text: [...table.headers, ...table.rows.flat()].join(" | "),
        table
      };
    }

    case "thematicBreak":
      return { ...base, type: "thematicBreak", text: "" };

    case "html":
      return { ...base, type: "html", text: node.value };

    case "yaml":
      return { ...base, type: "frontmatter", text: node.value };

    default:
      return null;
  }
}
