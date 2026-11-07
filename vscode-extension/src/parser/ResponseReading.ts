/**
 * A reply from an LLM, as it is said out loud (GAO-r-ponses-2-l-001). Only replies read
 * this way: a Markdown document keeps `Segmenter` and its profile's policy, a selection
 * keeps its text as written. A reply is written to be seen, and nobody chose its mark-up.
 *
 * Works on the MDAST tree rather than on `SourceBlock`s: `renderInline` has already
 * flattened links and inline code by then, and that is what is decided here.
 *
 * Thresholds, which only ever make a passage shorter:
 * - inline code stays read up to `INLINE_CODE_MAX_CHARS` and `INLINE_CODE_MAX_WORDS`,
 *   without any `INLINE_CODE_OPERATORS`; past that it is "un extrait de code";
 * - a table says `TABLE_MAX_ROWS` rows, then how many are left.
 *
 * The short pause of a list comes from the sentence end every item is given, and from
 * being its own passage: no engine here takes a silence as an instruction.
 */

import type { Root, RootContent, Table } from "mdast";
import type { SourceRange, SourceSegment, SourceSegmentType } from "../core/source.js";
import { parseMarkdownTree, toSourceRange } from "./MarkdownParser.js";
import { splitSentences } from "./SentenceSplitter.js";
import { spokenArrow } from "./SpokenTextNormalizer.js";

export const INLINE_CODE_MAX_CHARS = 40;
export const INLINE_CODE_MAX_WORDS = 6;
const INLINE_CODE_OPERATORS = /[|&;<>$(){}[\]=*#"'`\\]/;
const TABLE_MAX_ROWS = 5;

export interface ResponseReadingOptions {
  /** `llmVoice.responses.readCode`, or the panel's chip: the code is read, not announced. */
  readCode: boolean;
  lang: string;
}

export interface ResponseReading {
  segments: SourceSegment[];
  /** A fenced block anywhere in the reply: without one the panel offers nothing. */
  hasCode: boolean;
}

interface Phrases {
  link: string;
  snippet: string;
  codeExamples(count: number): string;
  codeIntro(language: string | undefined): string;
  otherRows(count: number): string;
  columnValue(column: string, value: string): string;
}

const FRENCH_COUNTS: Record<number, string> = { 2: "deux", 3: "trois", 4: "quatre", 5: "cinq" };
const ENGLISH_COUNTS: Record<number, string> = { 2: "two", 3: "three", 4: "four", 5: "five" };

const FRENCH: Phrases = {
  link: "un lien",
  snippet: "un extrait de code",
  codeExamples: (count) => (count === 1 ? "un exemple de code." : `${FRENCH_COUNTS[count] ?? count} exemples de code.`),
  codeIntro: (language) => (language === undefined ? "un exemple de code :" : `un exemple de code en ${language} :`),
  otherRows: (count) => (count === 1 ? "et une autre ligne." : `et ${count} autres lignes.`),
  columnValue: (column, value) => `${column} : ${value}`
};

const ENGLISH: Phrases = {
  link: "a link",
  snippet: "a code snippet",
  codeExamples: (count) => (count === 1 ? "a code example." : `${ENGLISH_COUNTS[count] ?? count} code examples.`),
  codeIntro: (language) => (language === undefined ? "a code example:" : `a code example in ${language}:`),
  otherRows: (count) => (count === 1 ? "and one more row." : `and ${count} more rows.`),
  columnValue: (column, value) => `${column}: ${value}`
};

function phrasesFor(lang: string): Phrases {
  return lang.toLowerCase().startsWith("en") ? ENGLISH : FRENCH;
}

const LANGUAGE_NAMES: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  typescript: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  javascript: "JavaScript",
  py: "Python",
  python: "Python",
  rs: "Rust",
  rust: "Rust",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  shell: "shell",
  yaml: "YAML",
  yml: "YAML",
  json: "JSON",
  html: "HTML",
  css: "CSS",
  sql: "SQL",
  go: "Go",
  java: "Java",
  c: "C",
  cpp: "C++",
  "c++": "C++"
};
const NOT_A_LANGUAGE = new Set(["text", "txt", "plaintext", "plain"]);
const LANGUAGE_TAG = /^[A-Za-z0-9+#._-]{1,24}$/;

function spokenLanguage(tag: string | null | undefined): string | undefined {
  if (tag === null || tag === undefined || !LANGUAGE_TAG.test(tag) || NOT_A_LANGUAGE.has(tag.toLowerCase())) {
    return undefined;
  }
  return LANGUAGE_NAMES[tag.toLowerCase()] ?? tag;
}

// --- A word of prose -----------------------------------------------------------------

const AROUND_WORD = /^([(\[{«"'“`]*)(.*?)([)\]}»"'”`.,;:!?…]*)$/su;
const URL_WORD = /^(?:[a-z][a-z0-9+.-]*:\/\/\S+|www\.\S+\.\S+)$/i;
const LOCATION_SUFFIX = /(?::\d+){1,2}$|#L\d+(?:-L?\d+)?$/;
const PATH_PART = /^[\p{L}\p{N}_@.+-]+$/u;
const ASCII_PATH_PART = /^[A-Za-z0-9_@.+-]+$/;
const EXTENSION = /\.[A-Za-z][A-Za-z0-9]{0,7}$/;
const ROOTED = /^(?:~|\.{1,2})?\//;
const WINDOWS_ROOT = /^[A-Za-z]:[\\/]/;

/** The file a word names, or `undefined` when the word is not a path ("et/ou", "km/h", a date). */
function fileNameOf(word: string): string | undefined {
  const located = word.replace(LOCATION_SUFFIX, "");
  if (WINDOWS_ROOT.test(located) || (located.includes("\\") && EXTENSION.test(located))) {
    return located.split(/[\\/]/).pop() || undefined;
  }
  if (!located.includes("/")) {
    return undefined;
  }
  const isFolder = located.endsWith("/");
  const parts = located.replace(/\/$/, "").split("/");
  const last = parts.at(-1);
  if (last === undefined) {
    return undefined;
  }
  const inner = parts.filter((part, index) => !(index === 0 && (part === "" || part === "." || part === ".." || part === "~")));
  if (inner.length === 0 || !inner.every((part) => PATH_PART.test(part) && !/^\.\.?$/.test(part))) {
    return undefined;
  }
  if (!/\p{L}/u.test(last)) {
    return undefined;
  }
  if (ROOTED.test(located) || EXTENSION.test(last)) {
    return last;
  }
  // No root, no extension: "src/core/utils" is a path, "TCP/IP" and "entrée/sortie/erreur" are not.
  return (isFolder || inner.length >= 3) && inner.every((part) => ASCII_PATH_PART.test(part)) ? last : undefined;
}

function spokenWord(word: string, phrases: Phrases): string {
  const [, before = "", core = "", after = ""] = AROUND_WORD.exec(word) ?? [];
  if (URL_WORD.test(core)) {
    return `${before}${phrases.link}${after}`;
  }
  const file = fileNameOf(core);
  return file === undefined ? word : `${before}${file}${after}`;
}

/** Keeps the spaces at its edges: a text node sits between two others. */
function spokenText(text: string, lang: string): string {
  const phrases = phrasesFor(lang);
  return text
    .replace(/\s+/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(^|[^\p{L}\p{N}_\]])\[([^\]]+)\]/gu, "$1$2")
    .replace(/\S+/g, (word) => spokenWord(word, phrases))
    .replace(/\*{2,}|_{2,}|~~|`+/g, "")
    .replace(/->|=>|→/g, spokenArrow(lang));
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** What a run of prose says once it is out of the Markdown tree. */
export function spokenProse(text: string, lang: string): string {
  return collapse(spokenText(text, lang));
}

/** A command stays read while it can be said; past the thresholds it is only announced. */
export function spokenInlineCode(code: string, lang: string): string {
  const said = collapse(spokenText(code.trim().replace(/\(\)$/, ""), lang));
  const fits = said.length <= INLINE_CODE_MAX_CHARS && said.split(" ").length <= INLINE_CODE_MAX_WORDS;
  return fits && !INLINE_CODE_OPERATORS.test(code.trim().replace(/\(\)$/, "")) ? said : phrasesFor(lang).snippet;
}

/**
 * The spoken length of a reply, for the duration of its row: no parsing there, the row is
 * built synchronously. Counts code as ignored, whatever the chip says: this is an estimate.
 */
export function approximateResponseSpeech(message: string, lang = "fr"): string {
  const phrases = phrasesFor(lang);
  return message
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[ \t]*$|(?![\s\S]))/gm, phrases.codeExamples(1))
    .split("\n")
    .map((line) => spokenText(line, lang))
    .join("\n");
}

// --- Inline nodes --------------------------------------------------------------------

const SILENT_TAGS = new Set(
  "a abbr b br code details div em h1 h2 h3 h4 h5 h6 hr i img kbd li ol p pre s small span strong sub summary sup table tbody td th thead tr u ul".split(" ")
);

/** `<br>` and `</kbd>` say nothing; in `Array<string>` the name is the content. */
function spokenInlineHtml(value: string): string {
  if (value.startsWith("</")) {
    return "";
  }
  const name = /^<([A-Za-z][\w-]*)[^>]*>$/.exec(value.trim())?.[1];
  return name === undefined || SILENT_TAGS.has(name.toLowerCase()) ? " " : ` ${name}`;
}

function spokenInline(nodes: readonly RootContent[], lang: string): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return spokenText(node.value, lang);
        case "inlineCode":
          return spokenInlineCode(node.value, lang);
        case "link":
        case "linkReference":
          return collapse(spokenInline(node.children, lang)) || phrasesFor(lang).link;
        case "image":
        case "imageReference":
          return node.alt ? spokenText(node.alt, lang) : "";
        case "break":
          return " ";
        case "html":
          return spokenInlineHtml(node.value);
        case "footnoteReference":
          return "";
        default:
          return "children" in node ? spokenInline(node.children as RootContent[], lang) : "";
      }
    })
    .join("");
}

// --- Blocks --------------------------------------------------------------------------

type Spoken =
  | { kind: "text"; type: SourceSegmentType; text: string; range: SourceRange | undefined }
  | { kind: "code"; code: string; language: string | undefined; range: SourceRange | undefined };

function rangeOf(node: RootContent): SourceRange | undefined {
  return node.position === undefined ? undefined : toSourceRange(node.position);
}

function tableRows(node: Table, lang: string): string[] {
  const phrases = phrasesFor(lang);
  const cells = node.children.map((row) => row.children.map((cell) => collapse(spokenInline(cell.children, lang))));
  const [headers = [], ...rows] = cells;
  if (rows.length === 0) {
    const named = headers.filter((header) => header.length > 0);
    return named.length > 0 ? [`${named.join(", ")}.`] : [];
  }
  const lines = rows.slice(0, TABLE_MAX_ROWS).flatMap((row) => {
    const said = row.flatMap((value, column) => {
      const header = headers[column] ?? "";
      if (value.length === 0) {
        return [];
      }
      return [header.length > 0 ? phrases.columnValue(header, value) : value];
    });
    return said.length > 0 ? [`${said.join(", ")}.`] : [];
  });
  return rows.length > TABLE_MAX_ROWS ? [...lines, phrases.otherRows(rows.length - TABLE_MAX_ROWS)] : lines;
}

function isStandaloneImage(children: readonly RootContent[]): boolean {
  return children.length === 1 && (children[0]?.type === "image" || children[0]?.type === "imageReference");
}

function flatten(node: RootContent, inList: boolean, lang: string): Spoken[] {
  const range = rangeOf(node);
  const text = (type: SourceSegmentType, said: string): Spoken[] => [{ kind: "text", type, text: collapse(said), range }];
  switch (node.type) {
    case "heading":
      return text("heading", spokenInline(node.children, lang));
    case "paragraph":
      return text(inList ? "list" : isStandaloneImage(node.children) ? "other" : "sentence", spokenInline(node.children, lang));
    case "blockquote":
      return node.children.flatMap((child) => flatten(child, inList, lang));
    case "list":
      return node.children.flatMap((child) => flatten(child, true, lang));
    case "listItem":
      return node.children.flatMap((child) => flatten(child, true, lang));
    case "code":
      return [{ kind: "code", code: node.value, language: spokenLanguage(node.lang), range }];
    case "table":
      return tableRows(node, lang).map((row) => ({ kind: "text", type: "other", text: row, range }));
    case "html":
      return text("other", spokenText(node.value.replace(/<!--[\s\S]*?-->|<[^>]*>/g, " "), lang));
    default:
      // A rule, a front matter, a link definition, a footnote: nothing a voice would say.
      return [];
  }
}

function hasContent(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

function withStop(text: string): string {
  return /[.!?…:;]$/.test(text) ? text : `${text}.`;
}

function spanOf(first: SourceRange | undefined, last: SourceRange | undefined): SourceRange | undefined {
  return first === undefined || last === undefined
    ? first
    : { startLine: first.startLine, startColumn: first.startColumn, endLine: last.endLine, endColumn: last.endColumn };
}

function withoutSilence(items: readonly Spoken[]): Spoken[] {
  return items.filter((item) => item.kind === "code" || hasContent(item.text));
}

function toSegments(items: readonly Spoken[], options: ResponseReadingOptions): SourceSegment[] {
  const phrases = phrasesFor(options.lang);
  const segments: SourceSegment[] = [];
  const push = (type: SourceSegmentType, said: string, range: SourceRange | undefined): void => {
    segments.push({
      id: `reply-${segments.length}`,
      type,
      // A reply has no other text to keep: what the waits and a narrator count is what is said.
      rawText: said,
      spokenText: said,
      ...(range !== undefined ? { sourceRange: range } : {})
    });
  };
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item === undefined) {
      continue;
    }
    if (item.kind === "text") {
      for (const sentence of item.type === "heading" ? [{ text: item.text }] : splitSentences(item.text, options.lang)) {
        push(item.type, withStop(sentence.text), item.range);
      }
    } else if (options.readCode) {
      push("code", phrases.codeIntro(item.language), item.range);
      for (const line of item.code.split("\n").map((raw) => raw.trim()).filter(hasContent)) {
        push("code", line, item.range);
      }
    } else {
      // One announcement for blocks that follow each other: "un exemple de code" twice in a row says nothing.
      let last = item;
      let count = 1;
      for (let next = items[index + 1]; next?.kind === "code"; next = items[index + 1]) {
        last = next;
        count += 1;
        index += 1;
      }
      push("code", phrases.codeExamples(count), spanOf(item.range, last.range));
    }
  }
  return segments;
}

/** Pure walk of an already-parsed reply. */
export function responseReadingOfTree(tree: Root, options: ResponseReadingOptions): ResponseReading {
  const items = withoutSilence(tree.children.flatMap((node) => flatten(node, false, options.lang)));
  return { segments: toSegments(items, options), hasCode: items.some((item) => item.kind === "code") };
}

export async function readResponse(text: string, options: ResponseReadingOptions): Promise<ResponseReading> {
  return responseReadingOfTree(await parseMarkdownTree(text), options);
}
