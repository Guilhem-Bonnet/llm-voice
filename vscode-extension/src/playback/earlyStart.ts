/**
 * Démarrage anticipé d'une lecture préparée (GAO-metteur-en-s-001) : le son part dès que le
 * reste peut être généré avant d'être écouté, d'après la vitesse mesurée pendant cette
 * préparation même, avec une marge. Pur.
 */
export interface EarlyStartInput {
  /** Secondes d'audio prêtes à la suite, depuis le passage qui va jouer. */
  readonly readyAudioSeconds: number;
  /** Les passages qui restent à générer, dans l'ordre, et leur longueur. */
  readonly remainingChars: readonly number[];
  /** Mesures de cette préparation : audio obtenu, temps de synthèse, caractères. */
  readonly measured: readonly { readonly audioSeconds: number; readonly synthesisSeconds: number; readonly chars: number }[];
}

/** Multiplie le temps de synthèse estimé. */
export const EARLY_START_MARGIN = 1.3;
/** Secondes d'avance gardées en plus, à chaque passage. */
export const EARLY_START_CUSHION_SECONDS = 2;
/** Moins de mesures que cela : on ne devine pas, on attend tout. */
export const EARLY_START_MIN_MEASURES = 2;

export function canStartEarly(input: EarlyStartInput): boolean {
  if (input.remainingChars.length === 0) {
    return true;
  }
  const measures = input.measured.filter((row) => row.audioSeconds > 0 && row.chars > 0);
  if (measures.length < EARLY_START_MIN_MEASURES) {
    return false;
  }
  const audio = measures.reduce((sum, row) => sum + row.audioSeconds, 0);
  const synthesis = measures.reduce((sum, row) => sum + row.synthesisSeconds, 0);
  const chars = measures.reduce((sum, row) => sum + row.chars, 0);
  // Le coût fixe par passage est compris dans ce rapport : un passage court coûte plus, cher compté.
  const synthesisPerChar = (synthesis / chars) * EARLY_START_MARGIN;
  const audioPerChar = audio / chars;
  let made = 0;
  let heard = input.readyAudioSeconds;
  for (const length of input.remainingChars) {
    made += synthesisPerChar * length;
    if (made + EARLY_START_CUSHION_SECONDS > heard) {
      return false;
    }
    heard += audioPerChar * length;
  }
  return true;
}
