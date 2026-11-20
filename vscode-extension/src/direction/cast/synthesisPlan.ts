/**
 * Ce qu'une lecture à plusieurs voix demande d'avance (ADR-018 §1.3 et §5.1). Pur.
 * Le coût est déduit du banc, pas ajusté : l'étape 0 d'ADR-018 le confirmera.
 */

/** Temps de synthèse ≈ 1,8 s + 0,84 × durée audio. */
const FIXED_SECONDS = 1.8;
const SECONDS_PER_AUDIO_SECOND = 0.84;
/** Déduit des textes du banc. */
const CHARS_PER_SECOND = 17;
/** Au-delà, rien ne part sans le demander (proposé). */
const MAX_WAIT_SECONDS = 20;
/** La fenêtre compte des passages, et il faut compter des secondes (proposé). */
const WINDOW_AUDIO_SECONDS = 120;
const MIN_WINDOW_CHUNKS = 2;

export function estimateAudioSeconds(chars: number): number {
  return chars / CHARS_PER_SECOND;
}

export function estimateSynthesisSeconds(audioSeconds: number): number {
  return FIXED_SECONDS + SECONDS_PER_AUDIO_SECOND * audioSeconds;
}

/** `D = max_k ( Σ(i ≤ k) synthèse_i − Σ(i < k) audio_i )`. */
export function minimumLeadSeconds(passages: readonly { readonly audioSeconds: number; readonly synthesisSeconds: number }[]): number {
  let lead = 0;
  let made = 0;
  let played = 0;
  for (const passage of passages) {
    made += passage.synthesisSeconds;
    lead = Math.max(lead, made - played);
    played += passage.audioSeconds;
  }
  return lead;
}

export interface PlannedPassage {
  readonly chars: number;
  readonly cached: boolean;
}

export interface ReadingPlan {
  readonly decision: "immediate" | "lead" | "ask";
  readonly leadSeconds: number;
  /** Passages à avoir prêts au-delà du premier avant le son. */
  readonly leadChunks: number;
  /** La fenêtre de la file pour cette session. */
  readonly prefetchChunks: number;
  readonly missing: number;
  /** Tout ce qui reste à générer. */
  readonly synthesisSeconds: number;
}

export function planReading(passages: readonly PlannedPassage[]): ReadingPlan {
  const rows = passages.map((passage) => {
    const audioSeconds = estimateAudioSeconds(passage.chars);
    return { audioSeconds, synthesisSeconds: passage.cached ? 0 : estimateSynthesisSeconds(audioSeconds) };
  });
  const leadSeconds = minimumLeadSeconds(rows);
  const missing = passages.filter((passage) => !passage.cached).length;
  let leadChunks = 0;
  let made = 0;
  for (let index = 0; index < rows.length; index += 1) {
    made += rows[index]?.synthesisSeconds ?? 0;
    leadChunks = index;
    if (made >= leadSeconds) {
      break;
    }
  }
  const audioTotal = rows.reduce((sum, row) => sum + row.audioSeconds, 0);
  const average = rows.length > 0 ? audioTotal / rows.length : 0;
  const windowChunks = average > 0 ? Math.max(MIN_WINDOW_CHUNKS, Math.ceil(WINDOW_AUDIO_SECONDS / average)) : MIN_WINDOW_CHUNKS;
  return {
    decision: missing === 0 ? "immediate" : leadSeconds > MAX_WAIT_SECONDS ? "ask" : "lead",
    leadSeconds,
    leadChunks,
    prefetchChunks: Math.max(windowChunks, leadChunks),
    missing,
    synthesisSeconds: rows.reduce((sum, row) => sum + row.synthesisSeconds, 0)
  };
}
