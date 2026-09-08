/**
 * Minimal synchronous event emitter used by the playback layer.
 *
 * Deliberately not `vscode.EventEmitter`: nothing under `src/playback` may
 * import `vscode` (ADR-005), so the whole state machine stays unit testable in
 * plain Node.
 */

/** Detaches a listener; calling it twice is harmless. */
export type Unsubscribe = () => void;

/** Handler of a single emitter payload. */
export type Listener<T> = (payload: T) => void;

/** One-payload, synchronous, unicast-safe emitter. */
export class Emitter<T> {
  private readonly listeners = new Set<Listener<T>>();

  /** Registers `listener` and returns its unsubscribe function. */
  on(listener: Listener<T>): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Notifies a snapshot of the listeners, so handlers may unsubscribe safely. */
  emit(payload: T): void {
    for (const listener of [...this.listeners]) {
      listener(payload);
    }
  }

  /** Drops every listener; used by `dispose()`. */
  clear(): void {
    this.listeners.clear();
  }
}
