/**
 * How long until the first sound, before it comes: a realistic estimate, a bar
 * that fills on it, and the wording around it. No `vscode` import: the Pipeline
 * supplies the clock's readings, `globalState` and the display.
 *
 * Only durations and rates ever enter a `WaitMeasureStore`, never any text. The
 * estimate is presented as one ("environ"), and the bar never claims the sound is
 * there before it is: it stops at `BAR_CAP_PERCENT` until `complete()`.
 */

/** Loading a model nobody has measured yet on this machine (Kyutai 1.6B: 40 to 60 s). */
export const DEFAULT_MODEL_LOAD_MS = 45_000;
/** About 8 s to generate 8 s of audio, at 15 characters per spoken second. To refine with measures. */
export const DEFAULT_SYNTHESIS_MS_PER_CHAR = 1000 / 15;
export const BAR_CAP_PERCENT = 95;
/** Past this multiple of the estimate, the wording admits it: nothing gets cancelled for it. */
export const SLOW_FACTOR = 2;
/** Weight of the latest measure in the moving average. */
export const MEASURE_WEIGHT = 0.3;

export interface EngineWaitMeasures {
  loadMs?: number;
  narrationMsPerChar?: number;
  synthesisMsPerChar?: number;
}

/** By engine id. */
export type WaitMeasureStore = Readonly<Record<string, EngineWaitMeasures>>;
export type WaitMeasureKind = keyof EngineWaitMeasures;

const MEASURE_KINDS: readonly WaitMeasureKind[] = ["loadMs", "narrationMsPerChar", "synthesisMsPerChar"];

function isPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Moving average of `value` into `store`, in a new object. A nonsensical measure changes nothing. */
export function recordWaitMeasure(
  store: WaitMeasureStore,
  engineId: string,
  kind: WaitMeasureKind,
  value: number
): WaitMeasureStore {
  if (!isPositive(value)) {
    return store;
  }
  const engine = store[engineId] ?? {};
  const previous = engine[kind];
  const next = previous === undefined ? value : previous * (1 - MEASURE_WEIGHT) + value * MEASURE_WEIGHT;
  return { ...store, [engineId]: { ...engine, [kind]: next } };
}

/** What `globalState` holds is not trusted: only known kinds with positive numbers survive. */
export function sanitizeWaitMeasures(raw: unknown): WaitMeasureStore {
  if (typeof raw !== "object" || raw === null) {
    return {};
  }
  const store: Record<string, EngineWaitMeasures> = {};
  for (const [engineId, value] of Object.entries(raw)) {
    if (typeof value !== "object" || value === null) {
      continue;
    }
    const engine: EngineWaitMeasures = {};
    for (const kind of MEASURE_KINDS) {
      const measure = (value as Record<string, unknown>)[kind];
      if (isPositive(measure)) {
        engine[kind] = measure;
      }
    }
    store[engineId] = engine;
  }
  return store;
}

export interface WaitEstimateInput {
  measures: EngineWaitMeasures | undefined;
  /** False only when the engine says its model is not loaded yet. */
  modelLoaded: boolean;
  /** How long the engine has already been loading, when it says so. */
  loadingSinceMs?: number;
  narrated: boolean;
  /** Characters handed to the AI before the first sound. */
  narrationChars: number;
  /** Characters of the passages generated before the first sound. */
  firstPassagesChars: number;
  /** A floor for those passages, when each one costs more than its length (ADR-018 §1.3). */
  firstPassagesMinMs?: number;
}

export interface WaitEstimate {
  totalMs: number;
  loadMs: number;
  narrationMs: number;
  generationMs: number;
  /** False when a narrated reading has no measure yet: the AI's time is then left out, and the panel says so. */
  narrationCounted: boolean;
}

export function estimateWait(input: WaitEstimateInput): WaitEstimate {
  const load = input.measures?.loadMs ?? DEFAULT_MODEL_LOAD_MS;
  const loadMs = input.modelLoaded ? 0 : Math.max(0, load - (input.loadingSinceMs ?? 0));
  const narrationRate = input.measures?.narrationMsPerChar;
  const narrationMs = input.narrated && narrationRate !== undefined ? input.narrationChars * narrationRate : 0;
  const generationMs = Math.max(
    input.firstPassagesChars * (input.measures?.synthesisMsPerChar ?? DEFAULT_SYNTHESIS_MS_PER_CHAR),
    input.firstPassagesMinMs ?? 0
  );
  return {
    totalMs: loadMs + narrationMs + generationMs,
    loadMs,
    narrationMs,
    generationMs,
    narrationCounted: !input.narrated || narrationRate !== undefined
  };
}

export type WaitStep = "engine" | "narration" | "first-passage" | "next-passage" | "whole-reading";

const STEP_LABELS: Readonly<Record<WaitStep, string>> = {
  engine: "Démarrage du moteur…",
  narration: "Préparation du texte par l'IA…",
  "first-passage": "Génération du premier passage…",
  "next-passage": "Passage suivant…",
  "whole-reading": "Préparation de toute la lecture…"
};

const STEP_SHORT_LABELS: Readonly<Record<WaitStep, string>> = {
  engine: "Moteur en démarrage…",
  narration: "IA…",
  "first-passage": "Premier passage…",
  "next-passage": "Passage suivant…",
  "whole-reading": "Préparation…"
};

const SLOW_TEXT = "Plus lent que d'habitude";
const NEARLY_TEXT = "Encore un instant…";
const NARRATION_NOT_COUNTED_TEXT = "Temps de l'IA non compté : pas encore mesuré.";

/** What the player and the status bar draw. Plain data, posted as is to the webview. */
export interface WaitView {
  step: WaitStep;
  label: string;
  shortLabel: string;
  /** Whole seconds in this step. Never placed in a live region. */
  elapsedSeconds: number;
  /** 0 to 100, never going back; 100 only once the sound has started. */
  percent: number;
  /** "Lecture dans environ 12 s", "Encore un instant…", "Plus lent que d'habitude", or empty after the sound. */
  text: string;
  /** Clear wording of the bar for `aria-valuetext`. */
  valueText: string;
  /** Changes only at a threshold or a change of step: the only text assistive technology announces. */
  announcement: string;
  /** Present only when a real measure exists. */
  typicalSeconds?: number;
  /** Present when the AI's time is left out of the estimate. */
  note?: string;
}

function aboutText(remainingMs: number): string {
  const seconds = Math.max(1, Math.ceil(remainingMs / 1000));
  if (seconds < 60) {
    return `Lecture dans environ ${seconds} s`;
  }
  return `Lecture dans environ ${Math.round(seconds / 60)} min`;
}

/**
 * One wait, from the request to the first sound. A revised estimate never moves
 * the bar backwards: the percentage already shown is its floor.
 */
export class WaitTracker {
  private readonly startedAt: number;
  private stepStartedAt: number;
  private estimateMs: number;
  private floorPercent = 0;
  private completed = false;
  private currentStep: WaitStep;
  private typicalMs: number | undefined;
  private noteText: string | undefined;
  /** Whole-reading preparation: the bar counts passages ready, never time. */
  private passages: { ready: number; total: number } | undefined;

  constructor(
    step: WaitStep,
    estimate: Pick<WaitEstimate, "totalMs" | "narrationCounted">,
    private readonly now: () => number,
    typicalMs?: number
  ) {
    this.startedAt = now();
    this.stepStartedAt = this.startedAt;
    this.estimateMs = estimate.totalMs;
    this.currentStep = step;
    this.typicalMs = typicalMs;
    this.noteText = estimate.narrationCounted ? undefined : NARRATION_NOT_COUNTED_TEXT;
  }

  get step(): WaitStep {
    return this.currentStep;
  }

  /** Time spent on the current step so far: what a measure records when the step ends. */
  get stepElapsedMs(): number {
    return this.now() - this.stepStartedAt;
  }

  /** A new phase, or a better idea of what remains: `remaining` counts from now. */
  revise(step: WaitStep, remaining: Pick<WaitEstimate, "totalMs" | "narrationCounted">, typicalMs?: number): void {
    this.floorPercent = this.view().percent;
    if (step !== this.currentStep) {
      this.stepStartedAt = this.now();
      this.currentStep = step;
    }
    this.estimateMs = this.now() - this.startedAt + remaining.totalMs;
    this.typicalMs = typicalMs;
    this.noteText = remaining.narrationCounted ? undefined : NARRATION_NOT_COUNTED_TEXT;
  }

  /**
   * GAO-qwen3-dans-l-001: from now on the bar is `ready / total` passages, a count and not an
   * estimate. It still stops below 100 until the sound starts (`complete()`).
   */
  setPassages(ready: number, total: number): void {
    this.passages = { ready: Math.max(0, Math.min(ready, total)), total: Math.max(1, total) };
  }

  /** The first real sound. */
  complete(): void {
    this.completed = true;
    this.floorPercent = 100;
  }

  view(): WaitView {
    const now = this.now();
    const elapsedMs = now - this.startedAt;
    const counted = this.passages;
    const raw = counted !== undefined
      ? (counted.ready / counted.total) * 100
      : this.estimateMs > 0 ? (elapsedMs / this.estimateMs) * 100 : BAR_CAP_PERCENT;
    const percent = this.completed
      ? 100
      : Math.max(this.floorPercent, Math.min(BAR_CAP_PERCENT, Math.floor(raw)));
    this.floorPercent = percent;

    const label = STEP_LABELS[this.currentStep];
    const slow = !this.completed && counted === undefined && elapsedMs > this.estimateMs * SLOW_FACTOR;
    const nearly = !this.completed && !slow && percent >= BAR_CAP_PERCENT;
    const text = this.completed
      ? ""
      : counted !== undefined
        ? `${counted.ready} passages prêts sur ${counted.total}`
      : slow
        ? SLOW_TEXT
        : nearly
          ? NEARLY_TEXT
          : aboutText(this.estimateMs - elapsedMs);
    return {
      step: this.currentStep,
      label,
      shortLabel: STEP_SHORT_LABELS[this.currentStep],
      elapsedSeconds: Math.floor((now - this.stepStartedAt) / 1000),
      percent,
      text,
      valueText: this.completed ? "Lecture commencée" : `${label} ${text}`,
      announcement: this.completed ? "" : slow ? SLOW_TEXT : nearly ? NEARLY_TEXT : label,
      ...(this.typicalMs !== undefined ? { typicalSeconds: Math.round(this.typicalMs / 1000) } : {}),
      ...(this.noteText !== undefined ? { note: this.noteText } : {})
    };
  }
}
