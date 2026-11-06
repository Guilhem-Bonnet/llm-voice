/**
 * Garde de fidélité (ADR-018 §1) : les mots de la lecture à plusieurs voix sont ceux de la
 * lecture simple, étiquettes retirées. Un écart abandonne le jeu d'acteurs pour cette
 * lecture : on perd les voix, jamais des mots.
 */

import { tokenize } from "../controller/fidelity.js";

export function sameWordsApartFromLabels(simple: readonly string[], cast: readonly string[], labels: readonly string[]): boolean {
  const said = simple.flatMap((text) => tokenize(text));
  const kept = cast.flatMap((text) => tokenize(text));
  const known = new Map<string, readonly string[]>();
  for (const label of labels) {
    const tokens = tokenize(label);
    if (tokens.length > 0) {
      known.set(tokens.join(" "), tokens);
    }
  }
  const skippable = [...known.values()].sort((a, b) => b.length - a.length);
  let i = 0;
  let j = 0;
  while (i < said.length) {
    if (j < kept.length && said[i] === kept[j]) {
      i += 1;
      j += 1;
      continue;
    }
    const label = skippable.find((tokens) => tokens.every((token, offset) => said[i + offset] === token));
    if (label === undefined) {
      return false;
    }
    i += label.length;
  }
  return j === kept.length;
}
