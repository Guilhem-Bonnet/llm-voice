/**
 * Garde de fidélité (ADR-018 §1, révisée le 2026-11-06) : tous les mots dits par l'auteur sont
 * prononcés, dans l'ordre ; aucun mot n'est ajouté, remplacé ou répété. Une étiquette et une
 * indication jouée ne se disent pas : chacune s'efface une fois, à sa place dans le texte, et
 * nulle part ailleurs. Un écart abandonne le jeu d'acteurs pour cette lecture : on perd les
 * voix, jamais des mots.
 */

import { tokenize } from "../controller/fidelity.js";

/** Largement au-delà d'un texte réel : le pire cas revient à un refus, donc à une seule voix. */
const MAX_STEPS = 5_000_000;

export function sameWordsApartFromLabels(simple: readonly string[], cast: readonly string[], labels: readonly string[]): boolean {
  const said = simple.flatMap((text) => tokenize(text));
  const kept = cast.flatMap((text) => tokenize(text));
  const queue = labels.map((label) => tokenize(label)).filter((tokens) => tokens.length > 0);
  // `ALMA : Alma, viens.` : le mot peut être celui de l'étiquette ou de la réplique. On garde le choix.
  const choices: Array<readonly [number, number, number]> = [];
  let i = 0;
  let j = 0;
  let next = 0;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    if (i >= said.length && j === kept.length && next === queue.length) {
      return true;
    }
    const label = queue[next];
    const labelFits = label !== undefined && label.every((token, offset) => said[i + offset] === token);
    const wordFits = i < said.length && j < kept.length && said[i] === kept[j];
    if (wordFits) {
      if (labelFits) {
        choices.push([i, j, next]);
      }
      i += 1;
      j += 1;
    } else if (labelFits) {
      i += label.length;
      next += 1;
    } else {
      const choice = choices.pop();
      if (choice === undefined) {
        return false;
      }
      [i, j, next] = choice;
      i += queue[next]?.length ?? 0;
      next += 1;
    }
  }
  return false;
}
