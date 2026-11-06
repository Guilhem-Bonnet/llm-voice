/**
 * Reconnaissance déterministe du théâtre et des balises (ADR-018 §1), sans `vscode`, sans
 * réseau, sans modèle. Coupe un bloc en sous-blocs portant un `speakerId` optionnel ;
 * `segment()` reste l'unique découpeur. Les noms viennent du contenu : jamais journalisés.
 *
 * Un document où rien n'est reconnu ressort tel quel, objet pour objet : la lecture à une
 * voix ne peut pas en être changée.
 */

import { NARRATOR_SPEAKER_ID } from "../../core/direction.js";
import type { SourceRange } from "../../core/source.js";
import type { SourceBlock } from "../../parser/types.js";
import { toRoleId } from "../director/Analyst.js";
import { isStageParenthesis, stagePosition } from "./stageDirection.js";

export interface ScriptRole {
  readonly roleId: string;
  /** Pour l'affichage : `ROMÉO` devient `Roméo`. */
  readonly name: string;
  /** Répliques étiquetées. */
  readonly lines: number;
}

export interface ScriptDeclaration {
  readonly roleId: string;
  /** Tel qu'écrit : identifiant ou prénom, résolu par la distribution, qui connaît les voix. */
  readonly voiceText: string;
}

export interface ScriptParse {
  /** Au moins un personnage : sinon `blocks` est l'entrée, inchangée. */
  readonly active: boolean;
  readonly form: "theatre" | "tags" | "none";
  readonly blocks: readonly SourceBlock[];
  /** Par ordre d'apparition. */
  readonly roles: readonly ScriptRole[];
  readonly declarations: readonly ScriptDeclaration[];
  /** Ce qui n'est pas dit, pour la garde de fidélité. */
  readonly labels: readonly string[];
  /** Paragraphes de dialogue de roman, lus par le narrateur en tranche 1. */
  readonly dialogueBlocks: number;
}

/** Seuils proposés par ADR-018 §1, non mesurés. */
const MIN_CAPS_NAMES = 2;
const MIN_LINES_PER_NAME = 2;
const MIN_CAPS_LINES = 4;
const MAX_NAME_CHARS = 40;
const MAX_NAME_WORDS = 4;
/** Un nom présent une seule fois, en `NOM : réplique` : plus court, c'est un sigle (`FAQ`, `API`). */
const MIN_LETTERS_ONCE = 4;

/** Les mots de la structure d'un texte, et les sigles qui ont l'air de noms. Le premier mot suffit. */
const NOT_A_NAME = new Set([
  "NOTE", "NOTES", "ATTENTION", "TODO", "FIXME", "WARNING", "IMPORTANT", "INFO", "ERREUR", "PERSONNAGES", "DISTRIBUTION",
  "ACTE", "SCÈNE", "SCENE", "TABLEAU", "CHAPITRE", "PARTIE", "FIN", "RIDEAU", "PROLOGUE", "ÉPILOGUE", "EPILOGUE", "ENTRACTE", "INTERLUDE",
  "PRÉFACE", "PREFACE", "POSTFACE", "ANNEXE", "SOMMAIRE", "INTRODUCTION", "CONCLUSION", "RÉSUMÉ", "RESUME", "REMARQUE", "RAPPEL", "EXEMPLE", "EXEMPLES", "SOURCE", "SOURCES",
  "NB", "PS", "OK", "FAQ"
]);
const NARRATOR_ALIASES = new Set(["narrateur", "narratrice", "narrator", "recitant"]);

const SPACE = "[\\s\\u00a0]*";
const BOLD = "(?:\\*\\*|__)?";
const NAME = "[^:*_()\\n.,;!?—–=]{2,44}?";
const PARENS = "(\\([^()\\n]{1,80}\\))?";
const TAG = /^@([\p{L}\p{N}][\p{L}\p{N}'’ -]{0,39}?)[\s ]*:[\s ]*(.*)$/u;
const DECLARATION = /^%[\s ]*([\p{L}\p{N}][\p{L}\p{N}'’ -]{0,39}?)[\s ]*=[\s ]*(\S(?:[^\n]{0,60}\S)?)[\s ]*$/u;
const INLINE_LABEL = new RegExp(`^${BOLD}(${NAME})${BOLD}${SPACE}${PARENS}${SPACE}${BOLD}${SPACE}(?::|\\.${SPACE}[—–])${BOLD}${SPACE}`, "u");
const ALONE_LABEL = new RegExp(`^${BOLD}(${NAME})${BOLD}${SPACE}${PARENS}${SPACE}[.:]?${BOLD}${SPACE}$`, "u");
const CAPS = /^\p{Lu}[\p{Lu}\p{M}'’  -]*$/u;
const VOWEL = /[AEIOUYÆŒ]/u;
const ROMAN = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;
const WHOLE_STAGE_LINE = /^(?:\([^()\n]+\)|\*[^*\n]+\*|_[^_\n]+_)[.!?…]?$/u;
/** Une parenthèse, ou un italique qui fait une phrase : `*jamais*` reste une emphase. */
const INLINE_STAGE = /\([^()\n]{1,300}\)|(?<![*\p{L}\p{N}])\*(?=\p{Lu})[^*\n]{1,300}?[.!?…]\*(?!\*)|(?<![_\p{L}\p{N}])_(?=\p{Lu})[^_\n]{1,300}?[.!?…]_(?![_\p{L}\p{N}])/gu;
const DIALOGUE_START = /^[—–«]/u;
const WORD = /[\p{L}\p{N}]/u;
/** Ce qu'une parenthèse ne peut pas ouvrir : la cible d'un lien, du code, une adresse. */
const SHIELDED = /!?\[[^\]\n]*\]\((?:[^()\n]|\([^()\n]*\))*\)|`[^`\n]+`|<[^<>\s]+>|https?:\/\/\S+/gu;
/** La ponctuation seule qui suit une indication : elle n'est pas à elle. */
const PUNCTUATION_ALONE = /^[\s\u00a0]*[.!?…,;:]+(?=[\s\u00a0]|$)/u;
const ENDS_SENTENCE = /[.!?…:]$/u;

interface SourceLine {
  /** Décalage dans `rawSource`. */
  readonly start: number;
  readonly text: string;
}

interface Part {
  readonly speakerId: string | undefined;
  readonly start: number;
  readonly end: number;
  /** Une indication : sa parenthèse n'est pas du texte. */
  readonly stage: boolean;
  /** La ponctuation qui suivait l'indication et finit cette réplique : `Viens (bas) ?`. */
  readonly closing?: string;
}

type Label =
  | { readonly kind: "declaration"; readonly roleId: string | undefined; readonly voiceText: string }
  | { readonly kind: "line"; readonly speakerId: string | undefined; readonly name: string; readonly source: "tag" | "caps"; readonly labelEnd: number; readonly replyStart: number; readonly aside?: { start: number; end: number } }
  | { readonly kind: "alone"; readonly speakerId: string | undefined; readonly name: string; readonly source: "caps"; readonly labelEnd: number; readonly aside?: { start: number; end: number } };

function slug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function speakerOfName(name: string): { known: boolean; speakerId: string | undefined } {
  if (NARRATOR_ALIASES.has(slug(name))) {
    return { known: true, speakerId: undefined };
  }
  const roleId = toRoleId(name);
  return { known: roleId !== undefined, speakerId: roleId };
}

function lettersOf(name: string): string {
  return name.normalize("NFD").replace(/[^\p{L}]/gu, "");
}

/** Des capitales, 4 mots et 40 caractères au plus, ni mot de structure, ni sigle sans voyelle. */
function isCapsName(rawName: string): boolean {
  const name = rawName.replace(/\u00a0/g, " ").trim();
  if (name.length < 2 || name.length > MAX_NAME_CHARS || !CAPS.test(name)) {
    return false;
  }
  const words = name.split(/\s+/);
  const first = words[0] ?? "";
  return words.length <= MAX_NAME_WORDS && !NOT_A_NAME.has(first) && !NOT_A_NAME.has(name) && !ROMAN.test(name) && VOWEL.test(lettersOf(name));
}

function isStructuralLine(line: string): boolean {
  const first = line.replace(/[*_]/g, "").trim().split(/[\s\u00a0]+/)[0] ?? "";
  return first === "ACTE" || first === "SCÈNE" || first === "SCENE";
}

/** Une ligne qui a la forme d'un nom seul sans en être un : comme un titre, elle coupe le locuteur courant. */
function isCapsCaption(line: string): boolean {
  const alone = ALONE_LABEL.exec(line);
  return alone !== null && CAPS.test((alone[1] ?? "").replace(/\u00a0/g, " ").trim());
}

function isInsideShield(text: string, at: number): boolean {
  for (const match of text.matchAll(SHIELDED)) {
    if (match.index <= at && at < match.index + match[0].length) {
      return true;
    }
  }
  return false;
}

function asideOf(line: string, match: RegExpExecArray, group: number): { start: number; end: number } | undefined {
  const text = match[group];
  if (text === undefined) {
    return undefined;
  }
  const start = line.indexOf(text);
  return start === -1 ? undefined : { start, end: start + text.length };
}

function linesOf(raw: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  for (const piece of raw.split("\n")) {
    lines.push({ start, text: piece.endsWith("\r") ? piece.slice(0, -1) : piece });
    start += piece.length + 1;
  }
  return lines;
}

type NameForm = "inline" | "alone";

/** Les formes d'une ligne, sans décider si le document les retient. */
function labelOf(line: string, accept: (name: string, form: NameForm) => boolean): Label | undefined {
  const declaration = DECLARATION.exec(line);
  if (declaration !== null) {
    const { known, speakerId } = speakerOfName(declaration[1] ?? "");
    return { kind: "declaration", roleId: known ? speakerId : undefined, voiceText: declaration[2] ?? "" };
  }
  const tag = TAG.exec(line);
  if (tag !== null) {
    const name = tag[1] ?? "";
    const { known, speakerId } = speakerOfName(name);
    if (known) {
      const reply = tag[2] ?? "";
      const replyStart = line.length - reply.length;
      return { kind: "line", speakerId, name, source: "tag", labelEnd: replyStart, replyStart };
    }
    return undefined;
  }
  const inline = INLINE_LABEL.exec(line);
  const replyStart = inline?.[0].length ?? 0;
  if (inline !== null && accept(inline[1] ?? "", line.slice(replyStart).trim().length === 0 ? "alone" : "inline")) {
    const name = (inline[1] ?? "").trim();
    const { known, speakerId } = speakerOfName(name);
    const aside = asideOf(line, inline, 2);
    if (known) {
      if (line.slice(replyStart).trim().length === 0) {
        return { kind: "alone", speakerId, name, source: "caps", labelEnd: line.length, ...(aside !== undefined ? { aside } : {}) };
      }
      return { kind: "line", speakerId, name, source: "caps", labelEnd: aside?.start ?? replyStart, replyStart, ...(aside !== undefined ? { aside } : {}) };
    }
    return undefined;
  }
  const alone = ALONE_LABEL.exec(line);
  if (alone !== null && accept(alone[1] ?? "", "alone") && isCapsName(alone[1] ?? "")) {
    const name = (alone[1] ?? "").trim();
    const { known, speakerId } = speakerOfName(name);
    const aside = asideOf(line, alone, 2);
    return known ? { kind: "alone", speakerId, name, source: "caps", labelEnd: line.length, ...(aside !== undefined ? { aside } : {}) } : undefined;
  }
  return undefined;
}

function displayName(raw: string): string {
  const name = raw.replace(/ /g, " ").trim();
  if (name !== name.toUpperCase()) {
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  return name.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());
}

function advance(start: { line: number; column: number }, text: string, upTo: number): { line: number; column: number } {
  let { line, column } = start;
  for (let index = 0; index < upTo && index < text.length; index += 1) {
    if (text[index] === "\n") {
      line += 1;
      column = 0;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function rangeWithin(block: SourceBlock, start: number, end: number): SourceRange {
  const origin = { line: block.sourceRange.startLine, column: block.sourceRange.startColumn };
  const from = advance(origin, block.rawSource, start);
  const to = advance(origin, block.rawSource, end);
  return { startLine: from.line, startColumn: from.column, endLine: to.line, endColumn: to.column };
}

/** Le rendu de `MarkdownParser` pour une tranche de bloc : la garde de fidélité le vérifie. */
export function inlineText(raw: string): string {
  return raw
    .replace(/!\[([^\]]*)\]\((?:[^()\n]|\([^()\n]*\))*\)/g, "$1")
    .replace(/\[([^\]]*)\]\((?:[^()\n]|\([^()\n]*\))*\)/g, "$1")
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, "$2")
    .replace(/\*(?=\S)([^*\n]+?)(?<=\S)\*/g, "$1")
    .replace(/(?<![\p{L}\p{N}])_(?=\S)([^_\n]+?)(?<=\S)_(?![\p{L}\p{N}])/gu, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, "$1");
}

function stageText(raw: string, plainText: boolean): string {
  const text = plainText ? raw.replace(/^([*_])(.*)\1$/su, "$2") : inlineText(raw);
  return text.replace(/^\(\s*/, "").replace(/\s*\)([.!?…]?)$/, "$1");
}

function isStage(body: string, before: string, after: string): boolean {
  return body.startsWith("(") ? isStageParenthesis(body, before, after) : stagePosition(before, after) !== "cut";
}

/** Une réplique, coupée autour de ses indications. */
function replyParts(text: string, offset: number, speakerId: string | undefined): Part[] {
  if (speakerId === undefined) {
    return [{ speakerId, start: offset, end: offset + text.length, stage: false }];
  }
  const parts: Part[] = [];
  let cursor = 0;
  for (const match of text.matchAll(INLINE_STAGE)) {
    const at = match.index;
    const body = match[0];
    const end = at + body.length;
    const before = text.slice(cursor, at);
    const after = text.slice(end);
    if (isInsideShield(text, at) || !isStage(body, before, after)) {
      continue;
    }
    const closing = PUNCTUATION_ALONE.exec(after)?.[0];
    const said = WORD.test(before);
    const toReply = closing !== undefined && said && !ENDS_SENTENCE.test(before.trimEnd());
    if (at > cursor) {
      parts.push({ speakerId, start: offset + cursor, end: offset + at, stage: false, ...(toReply ? { closing } : {}) });
    }
    parts.push({ speakerId: undefined, start: offset + at, end: offset + end, stage: true, ...(closing !== undefined && !toReply ? { closing } : {}) });
    cursor = end + (closing?.length ?? 0);
  }
  if (cursor < text.length) {
    parts.push({ speakerId, start: offset + cursor, end: offset + text.length, stage: false });
  }
  return parts;
}

function trimmed(raw: string, part: Part): Part | undefined {
  let { start, end } = part;
  while (start < end && /\s/u.test(raw.charAt(start))) {
    start += 1;
  }
  while (end > start && /\s/u.test(raw.charAt(end - 1))) {
    end -= 1;
  }
  return WORD.test(raw.slice(start, end)) ? { ...part, start, end } : undefined;
}

function mergeParts(raw: string, parts: readonly Part[]): Part[] {
  const merged: Part[] = [];
  for (const part of parts) {
    const last = merged[merged.length - 1];
    if (last !== undefined && last.closing === undefined && last.speakerId === part.speakerId && !last.stage && !part.stage && raw.slice(last.end, part.start).trim().length === 0) {
      merged[merged.length - 1] = { ...last, end: part.end };
    } else {
      merged.push(part);
    }
  }
  return merged;
}

function isAnalysed(block: SourceBlock): boolean {
  return block.type === "paragraph";
}

/** Les noms déclarés par `%` ou `@` : seuls à valoir hors capitales. */
function collectDeclaredNames(blocks: readonly SourceBlock[]): Set<string> {
  const declared = new Set<string>();
  for (const block of blocks) {
    if (!isAnalysed(block)) {
      continue;
    }
    for (const { text } of linesOf(block.rawSource)) {
      const trimmedLine = text.trimStart();
      const form = trimmedLine.startsWith("@") ? TAG.exec(trimmedLine) : trimmedLine.startsWith("%") ? DECLARATION.exec(trimmedLine) : null;
      if (form !== null) {
        const roleId = toRoleId(form[1] ?? "");
        if (roleId !== undefined && !NARRATOR_ALIASES.has(slug(form[1] ?? ""))) {
          declared.add(roleId);
        }
      }
    }
  }
  return declared;
}

/** Combien de fois chaque nom en capitales apparaît, et si le document tient la forme théâtre. */
function capsCensus(blocks: readonly SourceBlock[]): { holds: boolean; counts: ReadonlyMap<string, number> } {
  const counts = new Map<string, number>();
  let total = 0;
  for (const block of blocks) {
    if (!isAnalysed(block)) {
      continue;
    }
    for (const { text } of linesOf(block.rawSource)) {
      const label = labelOf(text.trimStart(), (name) => isCapsName(name));
      if (label !== undefined && label.kind !== "declaration" && label.source === "caps" && label.speakerId !== undefined) {
        counts.set(label.speakerId, (counts.get(label.speakerId) ?? 0) + 1);
        total += 1;
      }
    }
  }
  const named = [...counts.values()].filter((count) => count >= MIN_LINES_PER_NAME).length;
  return { holds: named >= MIN_CAPS_NAMES && total >= MIN_CAPS_LINES, counts };
}

export interface ParseScriptOptions {
  /** Un fichier texte : sa lecture simple dit le texte brut, sans rendu Markdown. */
  readonly plainText?: boolean;
}

export function parseScript(blocks: readonly SourceBlock[], options: ParseScriptOptions = {}): ScriptParse {
  const dialogueBlocks = blocks.filter((block) => isAnalysed(block) && DIALOGUE_START.test(block.rawSource.trimStart())).length;
  const declared = collectDeclaredNames(blocks);
  const { holds: caps, counts } = capsCensus(blocks);
  const plainText = options.plainText === true;
  const accept = (name: string, form: NameForm): boolean => {
    const roleId = toRoleId(name);
    if (roleId !== undefined && declared.has(roleId)) {
      return true;
    }
    if (!caps || roleId === undefined || !isCapsName(name)) {
      return false;
    }
    // Une seule apparition : un vrai personnage parle (`LE MESSAGER : …`), un mot isolé ou un sigle non.
    return (counts.get(roleId) ?? 0) >= MIN_LINES_PER_NAME || (form === "inline" && lettersOf(name).length >= MIN_LETTERS_ONCE);
  };

  const roles = new Map<string, { name: string; lines: number }>();
  const declarations = new Map<string, string>();
  const labels: string[] = [];
  const out: SourceBlock[] = [];
  let tagged = false;
  // Le locuteur d'un `NOM` seul court d'un paragraphe à l'autre.
  let running: string | undefined;

  const meet = (speakerId: string | undefined, name: string): void => {
    if (speakerId === undefined) {
      return;
    }
    const role = roles.get(speakerId);
    roles.set(speakerId, { name: role?.name ?? displayName(name), lines: (role?.lines ?? 0) + 1 });
  };

  for (const block of blocks) {
    if (block.type === "heading" || block.type === "thematicBreak") {
      running = undefined;
    }
    if (!isAnalysed(block)) {
      out.push(block);
      continue;
    }
    const raw = block.rawSource;
    const parts: Part[] = [];
    let current = running;
    let touched = false;
    let firstLine = true;
    for (const { start, text } of linesOf(raw)) {
      const opensParagraph = firstLine;
      firstLine = false;
      const indent = text.length - text.trimStart().length;
      const line = text.slice(indent);
      const lineStart = start + indent;
      const label = labelOf(line, accept);
      if (label !== undefined) {
        touched = true;
      }
      if (label?.kind === "declaration") {
        labels.push(line);
        if (label.roleId !== undefined) {
          declarations.set(label.roleId, label.voiceText);
        }
        continue;
      }
      if (label?.kind === "line") {
        tagged = tagged || label.source === "tag";
        meet(label.speakerId, label.name);
        labels.push(line.slice(0, label.labelEnd));
        current = label.speakerId;
        running = undefined;
        if (label.aside !== undefined) {
          parts.push({ speakerId: undefined, start: lineStart + label.aside.start, end: lineStart + label.aside.end, stage: true });
          labels.push(line.slice(label.aside.end, label.replyStart));
        }
        parts.push(...replyParts(line.slice(label.replyStart), lineStart + label.replyStart, label.speakerId));
        continue;
      }
      if (label?.kind === "alone") {
        meet(label.speakerId, label.name);
        labels.push(line.slice(0, label.aside?.start ?? label.labelEnd));
        current = label.speakerId;
        running = label.speakerId;
        if (label.aside !== undefined) {
          parts.push({ speakerId: undefined, start: lineStart + label.aside.start, end: lineStart + label.aside.end, stage: true });
        }
        continue;
      }
      if (isStructuralLine(line) || (opensParagraph && isCapsCaption(line))) {
        current = undefined;
        running = undefined;
        parts.push({ speakerId: undefined, start: lineStart, end: lineStart + line.length, stage: false });
        continue;
      }
      if (WHOLE_STAGE_LINE.test(line.trim())) {
        parts.push({ speakerId: undefined, start: lineStart, end: lineStart + line.length, stage: true });
        continue;
      }
      parts.push(...replyParts(line, lineStart, current));
    }
    if (!touched && current === undefined && parts.every((part) => part.speakerId === undefined && !part.stage)) {
      // Rien à couper : le bloc garde son rendu d'origine.
      out.push(DIALOGUE_START.test(raw.trimStart()) ? { ...block, dialogue: true } : block);
      continue;
    }
    for (const part of mergeParts(raw, parts.flatMap((item) => trimmed(raw, item) ?? []))) {
      const slice = raw.slice(part.start, part.end);
      out.push({
        type: "paragraph",
        sourceRange: rangeWithin(block, part.start, part.end),
        startOffset: block.startOffset + part.start,
        endOffset: block.startOffset + part.end,
        text: (part.stage ? stageText(slice, plainText) : plainText ? slice : inlineText(slice)) + (part.closing ?? ""),
        rawSource: slice,
        ...(part.speakerId !== undefined && part.speakerId !== NARRATOR_SPEAKER_ID ? { speakerId: part.speakerId } : {})
      });
    }
  }

  if (roles.size === 0) {
    return { active: false, form: "none", blocks, roles: [], declarations: [], labels: [], dialogueBlocks };
  }
  return {
    active: true,
    form: caps && !tagged ? "theatre" : "tags",
    blocks: out,
    roles: [...roles].map(([roleId, role]) => ({ roleId, name: role.name, lines: role.lines })),
    declarations: [...declarations].map(([roleId, voiceText]) => ({ roleId, voiceText })),
    labels,
    dialogueBlocks
  };
}

/** Un fichier texte, paragraphe par paragraphe, pour la même grammaire que le Markdown. */
export function plainTextBlocks(text: string): SourceBlock[] {
  const blocks: SourceBlock[] = [];
  const separator = /(?:\r?\n[ \t]*){2,}/g;
  let start = 0;
  let line = 0;
  const push = (end: number): void => {
    const rawSource = text.slice(start, end);
    if (rawSource.trim().length === 0) {
      return;
    }
    const to = advance({ line, column: 0 }, rawSource, rawSource.length);
    blocks.push({
      type: "paragraph",
      sourceRange: { startLine: line, startColumn: 0, endLine: to.line, endColumn: to.column },
      startOffset: start,
      endOffset: end,
      text: rawSource,
      rawSource
    });
  };
  for (const match of text.matchAll(separator)) {
    push(match.index);
    const next = match.index + match[0].length;
    line += text.slice(start, next).split("\n").length - 1;
    start = next;
  }
  push(text.length);
  return blocks;
}
