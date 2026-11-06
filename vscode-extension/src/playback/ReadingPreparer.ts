/**
 * Préparer la lecture (ADR-018 §5.2) : la même `AudioQueue`, les mêmes clés, et rien pour
 * jouer : il remplit le cache et s'arrête. Un passage à la fois, jamais de file parallèle.
 * Le budget du cache et la reprise après le mode jeu restent à l'étape 6 d'ADR-018.
 */

import type { AudioChunk } from "../core/playback.js";
import type { TtsHoldReason, TtsProvider } from "../core/tts.js";
import type { AudioCacheStore } from "./AudioCache.js";
import { AudioQueue, type AudioQueueBinding, type AudioQueueOptions } from "./AudioQueue.js";

export type PreparationOutcome =
  | { status: "ready"; done: number; total: number }
  | { status: "cancelled"; done: number; total: number }
  | { status: "held"; holdReason: TtsHoldReason; done: number; total: number }
  | { status: "failed"; done: number; total: number };

export interface ReadingPreparerDeps {
  tts: TtsProvider;
  cache: AudioCacheStore;
  binding: AudioQueueBinding;
}

export class ReadingPreparer {
  private readonly queue: AudioQueue;
  private cancelled = false;

  constructor(deps: ReadingPreparerDeps, options: AudioQueueOptions = {}) {
    this.queue = new AudioQueue(deps, { ...options, prefetchChunks: 0 });
  }

  cancel(): void {
    this.cancelled = true;
    this.queue.cancelAll();
  }

  async run(chunks: readonly AudioChunk[], onProgress?: (done: number, total: number) => void): Promise<PreparationOutcome> {
    const total = chunks.length;
    this.queue.reset(chunks);
    let done = 0;
    try {
      for (let index = 0; index < total; index += 1) {
        if (this.cancelled) {
          return { status: "cancelled", done, total };
        }
        this.queue.setCursor(index);
        const chunk = await this.queue.waitFor(index);
        if (this.cancelled) {
          return { status: "cancelled", done, total };
        }
        if (chunk.status === "error") {
          return chunk.holdReason !== undefined
            ? { status: "held", holdReason: chunk.holdReason, done, total }
            : { status: "failed", done, total };
        }
        done += 1;
        onProgress?.(done, total);
      }
      return this.cancelled ? { status: "cancelled", done, total } : { status: "ready", done, total };
    } finally {
      this.queue.dispose();
    }
  }
}
