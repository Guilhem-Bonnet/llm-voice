/**
 * Error-UX notifications (CdC §52), factored out of `Pipeline` so the
 * *decision logic* is unit-testable in plain Node: every function here takes
 * the `vscode.window.show*Message` implementation as an explicit parameter
 * (`ShowMessage`) instead of importing `vscode` — `Pipeline` is the only
 * real caller and always passes the genuine
 * `vscode.window.showErrorMessage`/`showWarningMessage`; tests pass a stub
 * that resolves to a fixed button label, exactly like clicking it.
 *
 * `NotificationGate` is the anti-spam guard CdC §52 asks for ("une seule
 * notification par session par type"): each `NotificationType` may notify
 * once per `Pipeline.start()` session, so a document that keeps failing the
 * same way for 50 chunks does not stack 50 dialogs.
 */

/**
 * Mirrors `vscode.window.show{Error,Warning,Information}Message`'s shape
 * closely enough for every call site here — a message plus button labels,
 * resolving to the label clicked or `undefined` if dismissed.
 * `vscode.Thenable<T>` is defined as `extends PromiseLike<T> {}`
 * (`node_modules/@types/vscode`), so `PromiseLike` is structurally identical
 * and lets this module skip a runtime `vscode` import entirely.
 */
export type ShowMessage = (message: string, ...items: string[]) => PromiseLike<string | undefined>;

/**
 * S7.3: replaces the previous "Chatterbox is unavailable." — that wording
 * named one specific provider regardless of which one the active profile
 * actually configures, and gave no actionable next step besides Retry (of
 * limited use when the real problem is "nothing is configured at all", the
 * most common cause of AC-01 chunk-0 failures on a fresh install).
 */
export const TTS_UNAVAILABLE_MESSAGE = "LLM Voice : aucune voix configurée.";
export const NARRATOR_UNAVAILABLE_MESSAGE = "LLM Voice: Narrator unavailable";

export const CHOOSE_VOICE_LABEL = "Choisir une voix";
export const OPEN_TTS_SETTINGS_LABEL = "Voir les réglages";
export const RETRY_LABEL = "Réessayer";

export type TtsUnavailableChoice = "setupVoice" | "openSettings" | "retry" | "dismissed";

/**
 * CdC §52 "TTS indisponible" (S7.3 wording): "Choisir une voix" (runs
 * `llmVoice.setupVoice` if that command is registered, else opens the
 * provider docs — decided by the caller, which is the only side that can
 * check `vscode.commands.getCommands()`) / "Voir les réglages" / "Réessayer"
 * (re-attempts only the chunk that failed, CdC §52 "sans recréer la
 * session" — kept for a TTS server that is merely down/loading rather than
 * genuinely unconfigured).
 */
export async function notifyTtsUnavailable(showErrorMessage: ShowMessage): Promise<TtsUnavailableChoice> {
  const choice = await showErrorMessage(
    TTS_UNAVAILABLE_MESSAGE,
    CHOOSE_VOICE_LABEL,
    OPEN_TTS_SETTINGS_LABEL,
    RETRY_LABEL
  );
  if (choice === CHOOSE_VOICE_LABEL) {
    return "setupVoice";
  }
  if (choice === OPEN_TTS_SETTINGS_LABEL) {
    return "openSettings";
  }
  if (choice === RETRY_LABEL) {
    return "retry";
  }
  return "dismissed";
}

export type NarratorUnavailableChoice = "retry" | "readWithoutNarration" | "cancel" | "dismissed";

/** CdC §52 "Narrator indisponible": Retry / Read without narration / Cancel. */
export async function notifyNarratorUnavailable(
  showWarningMessage: ShowMessage
): Promise<NarratorUnavailableChoice> {
  const choice = await showWarningMessage(
    NARRATOR_UNAVAILABLE_MESSAGE,
    "Retry",
    "Read without narration",
    "Cancel"
  );
  if (choice === "Retry") {
    return "retry";
  }
  if (choice === "Read without narration") {
    return "readWithoutNarration";
  }
  if (choice === "Cancel") {
    return "cancel";
  }
  return "dismissed";
}

export type ChunkErrorChoice = "skip" | "stop";

/**
 * CdC §52 "Chunk TTS invalide" (after `maxRetries`, default 2): Skip / Stop.
 * A dismissed dialog (closed without a click) defaults to `"stop"` — the
 * safe choice, since silently skipping audio the user never agreed to skip
 * would be a worse surprise than pausing.
 */
export async function notifyChunkInvalid(
  showErrorMessage: ShowMessage,
  maxRetries: number
): Promise<ChunkErrorChoice> {
  const choice = await showErrorMessage(
    `LLM Voice: audio chunk failed after ${maxRetries} ${maxRetries === 1 ? "retry" : "retries"}.`,
    "Skip",
    "Stop"
  );
  return choice === "Skip" ? "skip" : "stop";
}

/** One failure family CdC §52 describes; see `NotificationGate`. */
export type NotificationType = "ttsUnavailable" | "narratorUnavailable" | "chunkInvalid";

/**
 * Anti-spam guard: each `NotificationType` may notify once until `reset()`
 * (a new `Pipeline.start()` session) or `clear()` (the user's own `Retry`
 * re-arms that type, so a *second* genuine failure after a retry still gets
 * a dialog instead of silently defaulting).
 */
export class NotificationGate {
  private readonly shown = new Set<NotificationType>();

  /** `true` the first time this session sees `type`; `false` after. */
  shouldNotify(type: NotificationType): boolean {
    return !this.shown.has(type);
  }

  markShown(type: NotificationType): void {
    this.shown.add(type);
  }

  /** Re-arms `type` — used after a `Retry` that clears the failure it guarded. */
  clear(type: NotificationType): void {
    this.shown.delete(type);
  }

  /** New session: every type may notify once again. */
  reset(): void {
    this.shown.clear();
  }
}
