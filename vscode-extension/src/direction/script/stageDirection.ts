/**
 * Une parenthèse de réplique est-elle une indication scénique (ADR-018 §1) ? Rien ne le dit
 * sûrement : on regarde où elle tombe, puis à quoi elle ressemble. Une erreur ne coûte qu'un
 * changement de voix, jamais un mot ; dans le doute, elle reste à la voix du personnage.
 *
 * - Collée à un mot, `ami(e)s`, `(re)lecture`, `f(x)` : non.
 * - Une référence, `(2)`, `(page 3)`, `(sic)`, `(ONU)`, une adresse : non.
 * - Elle coupe une phrase qui continue sans ponctuation, `Je (ne) sais` : non.
 * - En tête de réplique ou entre deux phrases, `(essoufflé) J'ai couru` : oui.
 * - Ailleurs, `Viens (bas) ?`, `Non, (bas) je reste` : seulement si elle a la forme d'une
 *   indication, `(Elle soupire.)`, `(il sort)`, `(à part)`, `(en riant)`.
 */

const MAX_FRAGMENT_WORDS = 8;
const MAX_SENTENCE_WORDS = 20;

const GLUED_BEFORE = /[\p{L}\p{N}\\]$/u;
const GLUED_AFTER = /^[\p{L}\p{N}]/u;
const SENTENCE_END = /[.!?…:][»”"'’)\]]*$/u;
const CLAUSE_END = /[,;—–]$/u;
const CONTINUES = /^[\p{Ll}\p{N}]/u;
const NEW_SENTENCE = /^[\p{Lu}—–«(*_]/u;

const REFERENCE = /\p{N}|https?:|www\.|[/=\\_`<>@#]|^(?:sic|cf|etc|ibid|voir|ex|nb|note|i\.e|e\.g)\b/iu;
const ALL_CAPS = /^[\p{Lu}\p{M}\s'’.-]+$/u;
const SENTENCE = /^\p{Lu}.*[.!?…]$/su;
const STAGE_WORDS = /^(?:à part|à voix (?:basse|haute)|à mi-voix|à (?:lui|elle)-même|au public|aux autres|bas|haut|tout (?:bas|haut)|fort|seule?|en \p{L}+ant)$/iu;
const SUBJECT_AND_VERB = /^(?:il|elle|ils|elles|on)\s+\p{L}/iu;
/** `(souriant)`. Pas `-é` : `(proposé)`, `(archivé)` sont bien plus souvent une précision du texte. */
const PARTICIPLE = /^\p{L}{3,}ant$/iu;

export type StagePosition = "cut" | "between" | "inside";

/** Où tombe un passage : `before` depuis le début de la réplique ou la dernière indication. */
export function stagePosition(before: string, after: string): StagePosition {
  const left = before.trimEnd();
  const right = after.trimStart();
  const sentenceBefore = left === "" || SENTENCE_END.test(left);
  if (!sentenceBefore && !CLAUSE_END.test(left) && CONTINUES.test(right)) {
    return "cut";
  }
  return left === "" || (sentenceBefore && (right === "" || NEW_SENTENCE.test(right))) ? "between" : "inside";
}

function wordsOf(text: string): number {
  return text.trim().split(/\s+/u).length;
}

function isReference(inner: string): boolean {
  return REFERENCE.test(inner) || ALL_CAPS.test(inner) || inner.replace(/[^\p{L}]/gu, "").length < 2;
}

function hasStageForm(inner: string): boolean {
  return SENTENCE.test(inner) || STAGE_WORDS.test(inner) || SUBJECT_AND_VERB.test(inner) || (wordsOf(inner) === 1 && PARTICIPLE.test(inner));
}

/** `body` avec ses parenthèses ; `before` et `after`, le reste de la ligne autour d'elle. */
export function isStageParenthesis(body: string, before: string, after: string): boolean {
  const inner = body.slice(1, -1).trim();
  if (GLUED_BEFORE.test(before) || GLUED_AFTER.test(after) || isReference(inner)) {
    return false;
  }
  const position = stagePosition(before, after);
  if (position === "cut") {
    return false;
  }
  if (wordsOf(inner) > (SENTENCE.test(inner) ? MAX_SENTENCE_WORDS : MAX_FRAGMENT_WORDS)) {
    return false;
  }
  return position === "between" || hasStageForm(inner);
}
