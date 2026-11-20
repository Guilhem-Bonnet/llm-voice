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
 *
 * Puis `readStage` dit si elle se dit (décision du 2026-11-06). Lexique fermé et formes, jamais
 * un LLM. Hors du lexique, elle reste narrée : une action muette effacée perd de l'information,
 * et un mot de plus coûte moins qu'un mot perdu. `(à part)` aussi, tant que le moteur ne sait pas
 * marquer à qui l'on parle : sans lui, le sens de la réplique devient faux.
 */

import type { StageState } from "../../core/source.js";

function wordSet(text: string): ReadonlySet<string> {
  return new Set(text.trim().split(/\s+/u));
}

/** Masculin et féminin écrits : un adjectif seul ne se reconnaît pas à sa forme. */
const MANNER_ADJECTIVES = wordSet(`
  essoufflé essoufflée haletant haletante furieux furieuse irrité irritée agacé agacée exaspéré exaspérée excédé excédée
  énervé énervée fâché fâchée indigné indignée outré outrée rageur rageuse triste attristé attristée désolé désolée
  ému émue bouleversé bouleversée joyeux joyeuse gai gaie enjoué enjouée ravi ravie radieux radieuse amusé amusée
  moqueur moqueuse narquois narquoise ironique sarcastique railleur railleuse tendre doux douce sec sèche froid froide
  glacial glaciale grave solennel solennelle timide gêné gênée embarrassé embarrassée confus confuse hésitant hésitante
  inquiet inquiète anxieux anxieuse angoissé angoissée effrayé effrayée terrifié terrifiée apeuré apeurée paniqué paniquée
  étonné étonnée surpris surprise stupéfait stupéfaite ébahi ébahie incrédule perplexe songeur songeuse rêveur rêveuse
  pensif pensive las lasse fatigué fatiguée épuisé épuisée ivre enroué enrouée tremblant tremblante suppliant suppliante
  implorant implorante souriant souriante riant riante pleurant sanglotant bégayant balbutiant chuchotant murmurant criant
  hurlant hautain hautaine méprisant méprisante menaçant menaçante résigné résignée soulagé soulagée impatient impatiente
  nerveux nerveuse calme posé posée vif vive enthousiaste mélancolique honteux honteuse fier fière jaloux jalouse sincère
`);
const MANNER_ADVERBS = wordSet(`
  bas haut fort doucement tristement vivement lentement froidement sèchement gaiement tendrement timidement ironiquement
  sourdement nerveusement calmement posément faiblement amèrement gravement violemment rageusement joyeusement fièrement sévèrement
`);
const MANNER_PHRASES = /^(?:à (?:voix (?:basse|haute|étouffée)|mi-voix|demi-voix)|en (?:colère|larmes|pleurs)|avec (?:colère|tendresse|douceur|ironie|mépris|émotion|peine|joie|rage|fureur|tristesse|lassitude)|d'une voix (?:basse|blanche|tremblante|étouffée|rauque|douce|sourde|forte|brisée|éteinte))$/u;
/** `en …ant` sur une liste : `(en sortant)`, `(en lui donnant la lettre)` sont des actions à dire. */
const MANNER_GERUNDS = wordSet(`
  riant souriant pleurant sanglotant criant hurlant chuchotant murmurant tremblant bégayant balbutiant haletant gémissant grognant
  suffoquant bredouillant grommelant marmonnant pouffant rougissant frissonnant grelottant plaisantant pleurnichant hésitant
  insistant implorant suppliant raillant tonnant soufflant
`);
const SOUND_GERUNDS = wordSet("toussant soupirant reniflant bâillant hoquetant ricanant");
const MANNER_VERBS = wordSet("murmure chuchote crie hurle bégaie bafouille balbutie bredouille marmonne grommelle");
const SOUND_VERBS = wordSet("tousse toussote soupire rit ricane glousse pleure sanglote gémit halète renifle bâille éternue grogne hoquette râle pouffe suffoque");
const SOUND_VERB_PHRASES = /^(?:s'esclaffe|s'étrangle|se racle la gorge|s'éclaircit la voix)$/u;
const SOUND_NOUNS = wordSet("rire rires soupir toux sanglot sanglots pleurs");
const INTENSIFIER = /^(?:très|tout|toute|si|un peu|à peine|presque) /u;
const SUBJECT = /^(?:il|elle) /u;
/** Un nom devant un verbe : `(Anselme tousse.)`. `on` et le pluriel ne désignent pas ce personnage. */
const NAME_SUBJECT = /^\p{Lu}\p{L}+ /u;
const CLAUSE_SEPARATOR = /\s*[,;]\s*|\s+(?:puis|et|mais)\s+/u;
const LEADING_LINK = /^(?:puis|et|mais|alors) /u;
const END_PUNCTUATION = /[\s.!?…]+$/u;

type ClauseState = Pick<StageState, "label" | "kind">;

function verbState(words: string): ClauseState | undefined {
  if (MANNER_VERBS.has(words)) {
    return { label: words, kind: "manner" };
  }
  return SOUND_VERBS.has(words) || SOUND_VERB_PHRASES.test(words) ? { label: words, kind: "sound" } : undefined;
}

function clauseState(raw: string): ClauseState | undefined {
  const written = raw.replace(END_PUNCTUATION, "").replace(/’/gu, "'").trim();
  const clause = written.toLocaleLowerCase("fr").replace(LEADING_LINK, "");
  const bare = clause.replace(INTENSIFIER, "");
  if (MANNER_ADJECTIVES.has(bare) || MANNER_ADVERBS.has(bare) || MANNER_PHRASES.test(clause)) {
    return { label: clause, kind: "manner" };
  }
  if (SOUND_NOUNS.has(clause)) {
    return { label: clause, kind: "sound" };
  }
  const gerund = /^en (.+)$/u.exec(clause)?.[1];
  if (gerund !== undefined && (MANNER_GERUNDS.has(gerund) || SOUND_GERUNDS.has(gerund))) {
    return { label: clause, kind: SOUND_GERUNDS.has(gerund) ? "sound" : "manner" };
  }
  const verb = clause.replace(SUBJECT, "");
  if (verb !== clause || !NAME_SUBJECT.test(written)) {
    return verbState(verb);
  }
  return verbState(written.replace(NAME_SUBJECT, "").toLocaleLowerCase("fr"));
}

export interface StageReading {
  /** Dite par le narrateur : tout sauf ce que le lexique reconnaît en entier. */
  readonly said: boolean;
  readonly states: readonly StageState[];
}

/** `body` avec ses parenthèses. */
export function readStage(body: string): StageReading {
  const inner = body.slice(1, -1).trim();
  const clauses = inner.split(CLAUSE_SEPARATOR).filter((clause) => clause.length > 0);
  const known = clauses.map(clauseState);
  const states = known.flatMap((state) => (state !== undefined ? [{ ...state, quote: body }] : []));
  return { said: states.length < clauses.length || clauses.length === 0, states };
}

function isPlayed(body: string): boolean {
  return !readStage(body).said;
}

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
  return position === "between" || hasStageForm(inner) || isPlayed(body);
}
