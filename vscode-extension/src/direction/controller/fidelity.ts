/**
 * Deterministic fidelity checks of the partition controller (ADR-015 §6 and
 * §2, role 5). Production TypeScript twin of the checks the narrator
 * measurement script applies (numbers, including spelled-out ones; negations
 * within 8 words; identifiers; digits absent from the source). The script's
 * checks compare an output to hand-written expectations (`mustKeep`,
 * `negations`); here nothing is annotated, so the expectations are derived
 * from the source text itself.
 *
 * Pure: no `vscode`, no I/O, no LLM. Findings carry `detail` strings that
 * quote the source (they feed the re-prompt to the director) — callers must
 * never log them (ADR-015 §4, "Oubli").
 *
 * Known limits, kept on purpose (a false alarm costs one re-prompt, a miss
 * lets a wrong figure be read aloud):
 * - a number of a million or more, or a long identifier of digits, must stay
 *   in digits (or be read digit by digit);
 * - the groups of a version or decimal ("3.22.4") are matched in order, each
 *   as digits or as words, the separator word ("point", "virgule") is free;
 * - identifiers are checked by their letter parts (`parseNarration` →
 *   parse, narration), so `v1.2` or a regular expression checks nothing here
 *   (their digits are covered by the number rule).
 */

export type FidelityKind =
  | "number-lost"
  | "number-invented"
  | "identifier-lost"
  | "negation-lost"
  | "lexical-drop"
  | "lexical-add";

export interface FidelityFinding {
  readonly kind: FidelityKind;
  /** May quote the source text: for the re-prompt only, never logged. */
  readonly detail: string;
}

const MAX_LISTED = 5;

function listed(items: readonly string[]): string {
  const shown = items.slice(0, MAX_LISTED).join(", ");
  return items.length > MAX_LISTED ? `${shown}, … (${items.length} in all)` : shown;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

const COMBINING_MARKS = /[\u0300-\u036f]/g;

export function stripAccents(text: string): string {
  return text.replace(/œ/g, "oe").replace(/Œ/g, "OE").replace(/æ/g, "ae").normalize("NFD").replace(COMBINING_MARKS, "");
}

/**
 * "22 050" → "22050" (French thousands separator, also no-break spaces). A
 * group is not merged into a decimal's fraction ("1,2 127") nor into a dotted
 * number ("127.0.0.1").
 */
export function collapseThousands(text: string): string {
  return text.replace(/(?<![\d.,])(\d{1,3})[ \u00a0\u202f](?=\d{3}(?!\d|\.\d))/g, "$1");
}

function splitCamel(text: string): string {
  return text.replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2").replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, "$1 $2");
}

function splitAlnum(text: string): string {
  return text.replace(/(\p{L})(\d)/gu, "$1 $2").replace(/(\d)(\p{L})/gu, "$1 $2");
}

interface TokenizeOptions {
  readonly camel?: boolean;
  readonly alnum?: boolean;
}

/** Lower-case ASCII words: accents, punctuation and case ignored. */
export function tokenize(text: string, options: TokenizeOptions = {}): string[] {
  let prepared = collapseThousands(text);
  if (options.camel === true) {
    prepared = splitCamel(prepared);
  }
  if (options.alnum === true) {
    prepared = splitAlnum(prepared);
  }
  return stripAccents(prepared)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((token) => token.length > 0);
}

/** Runs of single letters ("s q l") joined into one token ("sql"). */
function collapseSingles(tokens: readonly string[]): string[] {
  const out: string[] = [];
  let run = "";
  const flush = (): void => {
    if (run.length > 0) {
      out.push(run);
      run = "";
    }
  };
  for (const token of tokens) {
    if (/^[a-z]$/.test(token)) {
      run += token;
    } else {
      flush();
      out.push(token);
    }
  }
  flush();
  return out;
}

/** Every reading of a text a spelled-out or split identifier could be found in. */
function wordSetOf(text: string): Set<string> {
  const set = new Set<string>();
  for (const options of [{}, { alnum: true }, { camel: true, alnum: true }] as const) {
    const tokens = tokenize(text, options);
    for (const token of tokens) {
      set.add(token);
    }
    for (const token of collapseSingles(tokens)) {
      set.add(token);
    }
  }
  return set;
}

/**
 * Tolerant key of a word: plural mark dropped, then the first 5 letters
 * ("chats" / "chat", "fusionne" / "fusionner" / "fusion").
 */
function stemOf(token: string): string {
  const singular = token.length > 3 && /[sx]$/.test(token) ? token.slice(0, -1) : token;
  return singular.slice(0, 5);
}

class StemIndex {
  private readonly exact: Set<string>;
  private readonly stems: Set<string>;

  constructor(tokens: Iterable<string>) {
    this.exact = new Set(tokens);
    this.stems = new Set([...this.exact].filter((token) => token.length >= 4).map(stemOf));
  }

  has(token: string): boolean {
    return this.exact.has(token) || (token.length >= 4 && this.stems.has(stemOf(token)));
  }
}

// ---------------------------------------------------------------------------
// Numbers spelled out (French, and English for English documents), 0..999 999
// ---------------------------------------------------------------------------

const FR_UNITS = [
  "zero", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize",
  "quatorze", "quinze", "seize", "dix sept", "dix huit", "dix neuf"
];
const FR_TENS: Readonly<Record<number, string>> = { 20: "vingt", 30: "trente", 40: "quarante", 50: "cinquante", 60: "soixante" };
const EN_UNITS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen",
  "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"
];
const EN_TENS: Readonly<Record<number, string>> = {
  20: "twenty", 30: "thirty", 40: "forty", 50: "fifty", 60: "sixty", 70: "seventy", 80: "eighty", 90: "ninety"
};

function frBelow100(n: number, et: boolean): string {
  if (n < 20) {
    return FR_UNITS[n] ?? "";
  }
  if (n < 70) {
    const tens = Math.floor(n / 10) * 10;
    const unit = n % 10;
    const head = FR_TENS[tens] ?? "";
    return unit === 0 ? head : `${head}${unit === 1 && et ? " et " : " "}${FR_UNITS[unit] ?? ""}`;
  }
  if (n < 80) {
    return n === 71 && et ? "soixante et onze" : `soixante ${frBelow100(n - 60, et)}`;
  }
  if (n === 80) {
    return "quatre vingts";
  }
  return `quatre vingt ${frBelow100(n - 80, et)}`;
}

function frBelow1000(n: number, et: boolean, plural: boolean): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const head = hundreds === 0 ? "" : hundreds === 1 ? "cent" : `${FR_UNITS[hundreds] ?? ""} cent${rest === 0 && plural ? "s" : ""}`;
  return rest === 0 ? head : `${head} ${frBelow100(rest, et)}`.trim();
}

function enBelow1000(n: number, and: boolean): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const below100 = (value: number): string => {
    if (value < 20) {
      return EN_UNITS[value] ?? "";
    }
    const unit = value % 10;
    return `${EN_TENS[Math.floor(value / 10) * 10] ?? ""}${unit === 0 ? "" : ` ${EN_UNITS[unit] ?? ""}`}`;
  };
  if (hundreds === 0) {
    return below100(rest);
  }
  const head = `${EN_UNITS[hundreds] ?? ""} hundred`;
  return rest === 0 ? head : `${head}${and ? " and" : ""} ${below100(rest)}`;
}

/**
 * Normalised spelled-out forms of `n` (accents and hyphens dropped, as
 * `tokenize` produces them), French then English variants ("et", plural of
 * "cent", "and"). Empty at a million or above.
 */
export function numberWords(n: number): string[] {
  if (!Number.isInteger(n) || n < 0 || n >= 1_000_000) {
    return [];
  }
  if (n === 0) {
    return ["zero"];
  }
  const out = new Set<string>();
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  for (const et of [true, false]) {
    for (const plural of [true, false]) {
      let fr = "";
      if (thousands > 0) {
        fr = thousands === 1 ? "mille" : `${frBelow1000(thousands, et, false)} mille`;
      }
      if (rest > 0 || thousands === 0) {
        fr = `${fr} ${frBelow1000(rest, et, plural)}`.trim();
      }
      out.add(fr.replace(/\s+/g, " "));
    }
  }
  for (const and of [true, false]) {
    let en = "";
    if (thousands > 0) {
      en = `${enBelow1000(thousands, false)} thousand`;
    }
    if (rest > 0 || thousands === 0) {
      en = `${en} ${enBelow1000(rest, and)}`.trim();
    }
    out.add(en.replace(/\s+/g, " "));
  }
  if (n === 1) {
    out.add("une");
  }
  return [...out].filter((form) => form.length > 0);
}

// ---------------------------------------------------------------------------
// Numbers: kept, lost, invented
// ---------------------------------------------------------------------------

/** A number, a decimal or a version: digit groups joined by `.` or `,`. */
const NUMBER_TOKEN = /\d+(?:[.,]\d+)*/g;

export function extractNumbers(text: string): string[] {
  const found = collapseThousands(text).match(NUMBER_TOKEN);
  return found === null ? [] : [...new Set(found)];
}

function stripLeadingZeros(digits: string): string {
  return digits.replace(/^0+(?=\d)/, "");
}

/** How a group of digits can be said: digits, words, or digit by digit. */
function groupForms(group: string): string[][] {
  const forms: string[][] = [[group], [stripLeadingZeros(group)]];
  if (group.length <= 6) {
    for (const words of numberWords(Number(group))) {
      forms.push(words.split(" "));
    }
  }
  if (group.length >= 2) {
    forms.push(group.split("").map((digit) => FR_UNITS[Number(digit)] ?? digit));
    forms.push(group.split("").map((digit) => EN_UNITS[Number(digit)] ?? digit));
  }
  return forms;
}

/** End index (exclusive) of the first occurrence of any form at or after `from`, or -1. */
function findForm(tokens: readonly string[], forms: readonly (readonly string[])[], from: number): number {
  let best = -1;
  let bestStart = Number.POSITIVE_INFINITY;
  for (const form of forms) {
    for (let start = from; start + form.length <= tokens.length && start < bestStart; start += 1) {
      if (form.every((word, offset) => tokens[start + offset] === word)) {
        best = start + form.length;
        bestStart = start;
        break;
      }
    }
  }
  return best;
}

function numberKept(spokenTokens: readonly string[], token: string): boolean {
  let position = 0;
  for (const group of token.split(/[.,]/)) {
    const end = findForm(spokenTokens, groupForms(group), position);
    if (end < 0) {
      return false;
    }
    position = end;
  }
  return true;
}

function digitRuns(text: string): Set<string> {
  const out = new Set<string>();
  for (const run of collapseThousands(text).match(/\d+/g) ?? []) {
    out.add(stripLeadingZeros(run));
  }
  return out;
}

/**
 * Every number of the source must still be in the spoken text, as digits or
 * spelled out (order of the groups of a version or decimal respected).
 */
export function findLostNumbers(reference: string, spoken: string): FidelityFinding[] {
  const tokens = tokenize(spoken, { alnum: true });
  const lost = extractNumbers(reference).filter((token) => !numberKept(tokens, token));
  return lost.length === 0
    ? []
    : [{ kind: "number-lost", detail: `number(s) of the source missing from the spoken text: ${listed(lost)}` }];
}

/**
 * No digit may appear in the spoken text that the source does not carry
 * (raw or with thousands collapsed), unless the source spells that number out.
 * `references` are all the texts the cue may legitimately draw from.
 */
export function findInventedNumbers(references: readonly string[], spoken: string): FidelityFinding[] {
  const allowed = new Set<string>();
  for (const reference of references) {
    for (const run of digitRuns(reference)) {
      allowed.add(run);
    }
    for (const run of reference.match(/\d+/g) ?? []) {
      allowed.add(stripLeadingZeros(run));
    }
  }
  const referenceTokens = references.map((reference) => tokenize(reference, { alnum: true }));
  const spelledInSource = (digits: string): boolean =>
    digits.length <= 6 &&
    numberWords(Number(digits)).some((form) => {
      const words = form.split(" ");
      return referenceTokens.some((tokens) => findForm(tokens, [words], 0) >= 0);
    });
  const invented = [...digitRuns(spoken)].filter((digits) => !allowed.has(digits) && !spelledInSource(digits));
  return invented.length === 0
    ? []
    : [{ kind: "number-invented", detail: `number(s) absent from the source: ${listed(invented)}` }];
}

// ---------------------------------------------------------------------------
// Identifiers: files, commands, versions' names, code words, acronyms
// ---------------------------------------------------------------------------

const EDGE_PUNCTUATION_START = /^[("'«[]+/;
const EDGE_PUNCTUATION_END = /[.,;:!?)"'»\]]+$/;

function looksLikeIdentifier(word: string): boolean {
  return (
    /[/\\]/.test(word) ||
    /_/.test(word) ||
    /::/.test(word) ||
    /^--?[A-Za-z]/.test(word) ||
    /\p{Ll}\p{Lu}/u.test(word) ||
    /^[\w$~-][\w.$~/-]*\.[A-Za-z][A-Za-z0-9]{0,5}$/.test(word) ||
    /^[A-Z]{2,}[A-Z0-9_-]*$/.test(word)
  );
}

/**
 * Identifiers the spoken text must still contain: the content of inline code
 * spans, plus bare words that look like a path, a file, an option, a
 * camelCase or snake_case name, or an acronym. Fenced blocks are not read
 * word by word (the controller treats a `code` segment separately).
 */
export function extractIdentifiers(text: string): string[] {
  const withoutFences = text.replace(/```[\s\S]*?```/g, " ");
  const found = new Set<string>();
  for (const match of withoutFences.matchAll(/`([^`\n]+)`/g)) {
    const span = match[1]?.trim();
    if (span !== undefined && span.length > 0) {
      found.add(span);
    }
  }
  const bare = withoutFences.replace(/`[^`\n]*`/g, " ");
  for (const raw of bare.split(/\s+/)) {
    const word = raw.replace(EDGE_PUNCTUATION_START, "").replace(EDGE_PUNCTUATION_END, "");
    if (word.length >= 2 && looksLikeIdentifier(word)) {
      found.add(word);
    }
  }
  return [...found];
}

/** Letter parts of an identifier (≥ 2 letters): digits and symbols are not checked here. */
export function identifierParts(identifier: string): string[] {
  return stripAccents(splitCamel(identifier))
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((part) => part.length >= 2);
}

/**
 * An identifier is kept when its letter parts are all present (as words, or
 * spelled letter by letter, or split by camel case), or when they appear glued
 * as one word ("ESLint" said "eslint").
 */
export function findLostIdentifiers(reference: string, spoken: string): FidelityFinding[] {
  const words = wordSetOf(spoken);
  const lost = extractIdentifiers(reference).filter((identifier) => {
    const parts = identifierParts(identifier);
    return parts.length > 0 && !words.has(parts.join("")) && !parts.every((part) => words.has(part));
  });
  return lost.length === 0
    ? []
    : [{ kind: "identifier-lost", detail: `identifier(s) of the source missing from the spoken text: ${listed(lost)}` }];
}

// ---------------------------------------------------------------------------
// Negations and restrictions
// ---------------------------------------------------------------------------

/** Same family as the measurement script's negation/restriction cues, plus "ni". */
const NEGATION_CUE =
  /^(ne|n|pas|jamais|sans|aucun|aucune|non|interdit|interdite|evite|evitez|eviter|impossible|not|never|no|dont|don|without|cannot|refuse|refusee|refuses|rejette|rejete|rejetee|reject|rejected|ignore|ignoree|ignores|uniquement|seulement|nul|nulle|ni)$/;

const STOP_WORDS = new Set([
  "avec", "dans", "pour", "sont", "cette", "comme", "mais", "donc", "tout", "tous", "elle", "elles", "ils", "vous", "nous",
  "etre", "avoir", "fait", "faire", "peut", "plus", "apres", "avant", "this", "that", "with", "from", "must", "should",
  "does", "will", "would", "have", "been", "were", "each", "than", "then", "when", "them", "they", "your", "only"
]);

const NEGATION_WINDOW = 8;
/** Markers at most this many words apart belong to one negation ("ne … pas"). */
const SITE_GAP = 3;
const ANCHORS_PER_SITE = 3;

export interface NegationSite {
  /** Content words around the marker, nearest first. */
  readonly anchors: readonly string[];
  readonly first: number;
  readonly last: number;
}

export function negationSites(text: string): NegationSite[] {
  // Sentence by sentence: "Ne lance pas X. Ne touche jamais Y." is two negations.
  const tokens: string[] = [];
  const sentenceOf: number[] = [];
  text.split(/(?<=[.!?…;])\s+|\n+/).forEach((sentence, sentenceIndex) => {
    for (const token of tokenize(sentence)) {
      tokens.push(token);
      sentenceOf.push(sentenceIndex);
    }
  });
  const sites: NegationSite[] = [];
  let group: number[] = [];
  const close = (): void => {
    const first = group[0];
    const last = group[group.length - 1];
    if (first !== undefined && last !== undefined) {
      const candidates: Array<{ token: string; distance: number }> = [];
      for (let index = Math.max(0, first - 3); index <= Math.min(tokens.length - 1, last + SITE_GAP); index += 1) {
        const token = tokens[index] ?? "";
        if (token.length >= 4 && !/^\d/.test(token) && !NEGATION_CUE.test(token) && !STOP_WORDS.has(token)) {
          candidates.push({ token, distance: index < first ? first - index : index > last ? index - last : 0 });
        }
      }
      candidates.sort((x, y) => x.distance - y.distance);
      const anchors = [...new Set(candidates.map((candidate) => candidate.token))].slice(0, ANCHORS_PER_SITE);
      sites.push({ anchors, first, last });
    }
    group = [];
  };
  tokens.forEach((token, index) => {
    if (!NEGATION_CUE.test(token)) {
      return;
    }
    const previous = group[group.length - 1];
    if (previous !== undefined && (index - previous > SITE_GAP || sentenceOf[index] !== sentenceOf[previous])) {
      close();
    }
    group.push(index);
  });
  close();
  return sites;
}

function negationNear(tokens: readonly string[], index: number): boolean {
  const from = Math.max(0, index - NEGATION_WINDOW);
  const to = Math.min(tokens.length - 1, index + NEGATION_WINDOW);
  for (let cursor = from; cursor <= to; cursor += 1) {
    if (NEGATION_CUE.test(tokens[cursor] ?? "")) {
      return true;
    }
  }
  return false;
}

/**
 * Each negation or restriction of the source must survive in the spoken text:
 * one of its content words is found with a negation cue within 8 words, or —
 * when none of its words was kept — the spoken text still holds a negation at
 * all. The number of negations may not drop either (a second, distant one lost).
 */
export function findLostNegations(reference: string, spoken: string): FidelityFinding[] {
  const sites = negationSites(reference);
  if (sites.length === 0) {
    return [];
  }
  const tokens = tokenize(spoken);
  const spokenSites = negationSites(spoken);
  const lost: string[] = [];
  for (const site of sites) {
    const stems = new Set(site.anchors.map(stemOf));
    const occurrences = tokens.flatMap((token, index) => (token.length >= 4 && stems.has(stemOf(token)) ? [index] : []));
    const kept =
      occurrences.length > 0 ? occurrences.some((index) => negationNear(tokens, index)) : spokenSites.length > 0;
    if (!kept) {
      lost.push(site.anchors.length > 0 ? `near "${site.anchors.join(" ")}"` : "unanchored negation");
    }
  }
  if (lost.length === 0 && spokenSites.length < sites.length) {
    lost.push(`${sites.length - spokenSites.length} of ${sites.length} negation(s)`);
  }
  return lost.length === 0
    ? []
    : [{ kind: "negation-lost", detail: `negation(s) or restriction(s) of the source lost: ${listed(lost)}` }];
}

// ---------------------------------------------------------------------------
// Faithful profile: lexical equivalence modulo the spoken form (ADR-015 §6)
// ---------------------------------------------------------------------------

/** Symbols and units a spoken form writes out; anything else added is a new word. */
const ORAL_EXTRA = [
  "pour", "cent", "cents", "pourcent", "percent", "point", "points", "virgule", "comma", "dot", "barre", "oblique",
  "slash", "tiret", "souligne", "underscore", "dash", "arobase", "diese", "egal", "equals", "plus", "moins", "minus",
  "etoile", "star", "parenthese", "guillemets", "deux", "version", "seconde", "secondes", "second", "seconds",
  "milliseconde", "millisecondes", "millisecond", "milliseconds", "minute", "minutes", "heure", "heures", "hour", "hours",
  "hertz", "kilohertz", "octet", "octets", "kilooctet", "kilooctets", "megaoctet", "megaoctets", "gigaoctet", "gigaoctets",
  "mebioctet", "mebioctets", "byte", "bytes", "kilobyte", "megabyte", "gigabyte", "euro", "euros", "dollar", "dollars",
  "degre", "degres", "et", "and", "mille", "million", "millions", "milliard", "milliards", "thousand", "hundred"
];

const ORAL_VOCABULARY: ReadonlySet<string> = new Set([
  ...ORAL_EXTRA,
  ...FR_UNITS.flatMap((unit) => unit.split(" ")),
  ...Object.values(FR_TENS),
  ...EN_UNITS,
  ...Object.values(EN_TENS),
  "vingts", "septante", "octante", "nonante"
]);

/** Units a source writes short ("Mo", "Hz") that the spoken form writes out. */
const UNIT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  ms: ["milliseconde", "millisecondes", "millisecond", "milliseconds"],
  hz: ["hertz"],
  khz: ["kilohertz"],
  mo: ["megaoctet", "megaoctets", "mo"],
  go: ["gigaoctet", "gigaoctets", "go"],
  ko: ["kilooctet", "kilooctets", "ko"],
  mib: ["mebioctet", "mebioctets", "mib", "mebibyte"],
  kib: ["kibioctet", "kibioctets", "kib", "kibibyte"],
  gib: ["gibioctet", "gibioctets", "gib", "gibibyte"],
  mb: ["megabyte", "megabytes", "megaoctet", "megaoctets", "mb"],
  gb: ["gigabyte", "gigabytes", "gigaoctet", "gigaoctets", "gb"],
  kb: ["kilobyte", "kilobytes", "kilooctet", "kilooctets", "kb"]
};

function letterWords(text: string): string[] {
  return tokenize(text, { camel: true, alnum: true }).filter((token) => /^[a-z]{2,}$/.test(token));
}

/**
 * Lexical equivalence, modulo the spoken form only: no word of the source may
 * vanish, and no new word may appear beyond the writing-out of numbers,
 * symbols and units. Inflections of the same word (first five letters) count
 * as the same. It answers "faithful" profiles, where the director changes the
 * voice, the pauses and the tempo but never the words.
 */
export function findLexicalDifferences(reference: string, spoken: string): FidelityFinding[] {
  const spokenIndex = new StemIndex(wordSetOf(spoken));
  const referenceIndex = new StemIndex(wordSetOf(reference));
  const dropped = [...new Set(letterWords(reference))].filter(
    (word) => !spokenIndex.has(word) && !(UNIT_ALIASES[word] ?? []).some((alias) => spokenIndex.has(alias))
  );
  const added = [...new Set(letterWords(spoken))].filter(
    (word) => word.length >= 3 && !referenceIndex.has(word) && !ORAL_VOCABULARY.has(word)
  );
  const findings: FidelityFinding[] = [];
  if (dropped.length > 0) {
    findings.push({ kind: "lexical-drop", detail: `word(s) of the source missing: ${listed(dropped)}` });
  }
  if (added.length > 0) {
    findings.push({ kind: "lexical-add", detail: `word(s) not in the source: ${listed(added)}` });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// One call for what a segment must keep
// ---------------------------------------------------------------------------

/** Numbers, identifiers and negations of `reference` that `spoken` lost. */
export function findLostContent(reference: string, spoken: string): FidelityFinding[] {
  return [...findLostNumbers(reference, spoken), ...findLostIdentifiers(reference, spoken), ...findLostNegations(reference, spoken)];
}
