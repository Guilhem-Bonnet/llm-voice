/**
 * Des phrases voisines de même voix, en une seule requête (GAO-jeu-d-acteur-001). Mesuré sur
 * Kyutai TTS 1.6B : une synthèse coûte 2,28 s fixes + 0,0412 s par caractère, et « Tenez. » seul
 * est mal transcrit 4 fois sur 4. Pur, sans `vscode`.
 *
 * Seuls le jeu d'acteurs et les réponses y passent. Une lecture simple de document garde le
 * découpage de `Segmenter` : son cache et la clé d'un passage du narrateur en dépendent.
 *
 * Aucun mot ne change : le seul ajout possible est le point d'un titre qui n'en a pas.
 */

import type { NarrationSegment } from "../core/narration.js";
import { splitSentences } from "../parser/SentenceSplitter.js";

/**
 * Environ 4,7 s d'audio à 17 caractères par seconde (proposé, non mesuré comme seuil). Le coût
 * rejoint le temps réel vers 130 caractères (2,28 / (1/17 - 0,0412)), mais un passage plus long
 * éloigne Suivant et Précédent : on s'arrête dès que le passage tient debout.
 */
export const MIN_PASSAGE_CHARS = 80;
/** Garde-fou pour un regroupement : `maxSentences` ne borne pas des phrases longues (proposé). */
export const MAX_PASSAGE_CHARS = 300;

export interface GroupPassagesOptions {
  /** `profile.chunking.maxSentences`, le plafond existant : à 1, rien n'est regroupé. */
  readonly maxSentences: number;
  readonly lang: string;
  /** Ce passage ne se joint à rien, par exemple une ligne de code lue. */
  readonly keepApart?: (segment: NarrationSegment) => boolean;
}

/** Qui parle, à quelle voix, dans quel état : le moindre écart coupe. */
function voiceKey(segment: NarrationSegment): string {
  return JSON.stringify(segment.metadata?.["cast"] ?? null);
}

function joined(left: string, right: string): string {
  return /[\p{L}\p{N}]$/u.test(left.trimEnd()) ? `${left.trimEnd()}. ${right}` : `${left.trimEnd()} ${right}`;
}

export function groupPassages(segments: readonly NarrationSegment[], options: GroupPassagesOptions): NarrationSegment[] {
  const sentencesOf = (text: string): number => Math.max(1, splitSentences(text, options.lang).length);
  const groups: NarrationSegment[] = [];
  let sentences = 0;
  for (const segment of segments) {
    const last = groups[groups.length - 1];
    const count = sentencesOf(segment.spokenText);
    const fits =
      last !== undefined &&
      options.keepApart?.(last) !== true &&
      options.keepApart?.(segment) !== true &&
      voiceKey(last) === voiceKey(segment) &&
      (last.spokenText.length < MIN_PASSAGE_CHARS || segment.spokenText.length < MIN_PASSAGE_CHARS) &&
      sentences + count <= options.maxSentences &&
      joined(last.spokenText, segment.spokenText).length <= MAX_PASSAGE_CHARS;
    if (fits) {
      groups[groups.length - 1] = {
        ...last,
        spokenText: joined(last.spokenText, segment.spokenText),
        sourceSegmentIds: [...last.sourceSegmentIds, ...segment.sourceSegmentIds],
        sourceRanges: [...last.sourceRanges, ...segment.sourceRanges]
      };
      sentences += count;
    } else {
      groups.push(segment);
      sentences = count;
    }
  }
  return groups;
}
