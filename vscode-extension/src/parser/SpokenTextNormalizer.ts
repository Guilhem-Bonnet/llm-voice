/**
 * Turns semi-plain / markdown-ish text into text that reads naturally when
 * spoken, without ever sending raw Markdown syntax to a TTS engine (CdC §11,
 * ADR-006). It is deliberately independent from `MarkdownParser`: it also
 * has to cope with text that still carries raw markdown syntax (a selection
 * captured verbatim, clipboard text, ...), so every transform is idempotent
 * on already-clean text.
 */

const IMAGE_RE = /!\[([^\]]*)\]\([^()]*\)/g;
const LINK_RE = /\[([^\]]+)\]\([^()]*\)/g;
const BOLD_RE = /\*\*([^*]+)\*\*|__([^_]+)__/g;
const ITALIC_RE = /\*([^*]+)\*|_([^_]+)_/g;
const STRIKETHROUGH_RE = /~~([^~]+)~~/g;
const INLINE_CODE_RE = /`([^`]+)`/g;
const ARROW_RE = /->/g;
const BARE_URL_RE = /https?:\/\/([^\s/]+)[^\s]*/g;
const BULLET_RE = /^[ \t]*[-*+][ \t]+/gm;
const WHITESPACE_RE = /[ \t]+/g;
const BLANK_LINES_RE = /\n{2,}/g;

function isFrench(lang: string): boolean {
  return lang.toLowerCase().startsWith("fr");
}

/** Normalises spoken text for `lang` (BCP-47, e.g. `fr`, `fr-FR`, `en-US`). Defaults to French phrasing. */
export function normalize(text: string, lang = "fr"): string {
  const french = isFrench(lang);
  const codePhrase = french ? "code : $1" : "code: $1";
  const arrowWord = french ? " flèche " : " arrow ";

  let result = text;
  result = result.replace(IMAGE_RE, "$1");
  result = result.replace(LINK_RE, "$1");
  result = result.replace(INLINE_CODE_RE, codePhrase);
  result = result.replace(STRIKETHROUGH_RE, "$1");
  result = result.replace(BOLD_RE, (_match, a: string | undefined, b: string | undefined) => a ?? b ?? "");
  result = result.replace(ITALIC_RE, (_match, a: string | undefined, b: string | undefined) => a ?? b ?? "");
  result = result.replace(ARROW_RE, arrowWord);
  result = result.replace(BARE_URL_RE, "$1");
  result = result.replace(BULLET_RE, "");
  result = result.replace(BLANK_LINES_RE, " ");
  result = result.replace(/\n/g, " ");
  result = result.replace(WHITESPACE_RE, " ");
  return result.trim();
}
