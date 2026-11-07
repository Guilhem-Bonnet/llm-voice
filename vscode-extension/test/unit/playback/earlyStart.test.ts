/** GAO-metteur-en-s-001 : le son part dès que le reste sera prêt avant d'être écouté. */
import { describe, expect, it } from "vitest";
import { canStartEarly } from "../../../src/playback/earlyStart.js";

// Mesuré sur la préparation de référence : 202 s de synthèse pour 96 s d'audio, 1 610 caractères.
const SLOW = [
  { audioSeconds: 6, synthesisSeconds: 12.6, chars: 100 },
  { audioSeconds: 6, synthesisSeconds: 12.6, chars: 100 }
];
const FAST = [
  { audioSeconds: 6, synthesisSeconds: 2, chars: 100 },
  { audioSeconds: 6, synthesisSeconds: 2, chars: 100 }
];

describe("démarrage anticipé", () => {
  it("sans mesure suffisante, on attend tout", () => {
    expect(canStartEarly({ readyAudioSeconds: 50, remainingChars: [100], measured: SLOW.slice(0, 1) })).toBe(false);
  });
  it("plus rien à générer : on part", () => {
    expect(canStartEarly({ readyAudioSeconds: 0, remainingChars: [], measured: [] })).toBe(true);
  });
  it("moteur plus lent que l'écoute : il faut une avance qui couvre le reste, marge comprise", () => {
    // reste 1 000 caractères : 126 s de synthèse × 1,3 ≈ 164 s, écoute avant le dernier passage = prêt + 54 s
    expect(canStartEarly({ readyAudioSeconds: 60, remainingChars: Array(10).fill(100), measured: SLOW })).toBe(false);
    expect(canStartEarly({ readyAudioSeconds: 115, remainingChars: Array(10).fill(100), measured: SLOW })).toBe(true);
  });
  it("moteur plus rapide que l'écoute : deux passages prêts suffisent", () => {
    expect(canStartEarly({ readyAudioSeconds: 12, remainingChars: Array(10).fill(100), measured: FAST })).toBe(true);
  });
  it("la marge refuse un départ tout juste suffisant sans elle", () => {
    // sans marge : 12,6 s pour un passage, 14,6 s avec le coussin ; avec marge : 18,4 s
    expect(canStartEarly({ readyAudioSeconds: 15, remainingChars: [100], measured: SLOW })).toBe(false);
    expect(canStartEarly({ readyAudioSeconds: 19, remainingChars: [100], measured: SLOW })).toBe(true);
  });
});
