/**
 * Fake TtsProvider (cahier-des-charges.md §23, §78).
 *
 * Generates tiny in-memory WAV buffers (as `data:` URIs) so the whole
 * chain (source → parser → queue → player) can be exercised in tests
 * without GPU or network access. Duration is deterministic and derived
 * from the request's word count, which makes assertions on playback
 * timing reproducible.
 */
import { delay, throwIfAborted } from "./contracts.js";
import type { AudioFrame, AudioResult, ProviderHealth, TtsCapabilities, TtsProvider, TtsRequest, Voice } from "./contracts.js";
import { makeSilentWav } from "./wav.js";

export interface FakeTtsProviderOptions {
  /** Milliseconds of synthesized audio per word. Default: 60ms/word. */
  msPerWord?: number;
  /** Sample rate of generated WAV buffers. Default: 16000. */
  sampleRate?: number;
  /** When set, every Nth call (1-indexed) throws a simulated failure. */
  failEveryNth?: number;
  /** Artificial latency (ms) applied before each response, abortable. */
  latencyMs?: number;
  /** Voices exposed by getCapabilities()/listVoices(). */
  voices?: Voice[];
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}

function toDataUri(wav: Buffer): string {
  return `data:audio/wav;base64,${wav.toString("base64")}`;
}

export class FakeTtsProvider implements TtsProvider {
  readonly id = "fake-tts";

  /** Journal of every request received by synthesize() or synthesizeStream(). */
  readonly requests: TtsRequest[] = [];

  private readonly msPerWord: number;
  private readonly sampleRate: number;
  private readonly failEveryNth: number | undefined;
  private readonly latencyMs: number;
  private readonly voices: Voice[];
  private callCount = 0;

  constructor(options: FakeTtsProviderOptions = {}) {
    this.msPerWord = options.msPerWord ?? 60;
    this.sampleRate = options.sampleRate ?? 16000;
    this.failEveryNth = options.failEveryNth;
    this.latencyMs = options.latencyMs ?? 0;
    this.voices = options.voices ?? [{ id: "fake-voice", name: "Fake Voice", language: "fr" }];
  }

  async health(): Promise<ProviderHealth> {
    return { ok: true };
  }

  async getCapabilities(): Promise<TtsCapabilities> {
    return { streaming: true, voices: this.voices };
  }

  async listVoices(): Promise<Voice[]> {
    return this.voices;
  }

  private durationMsFor(text: string): number {
    return Math.max(countWords(text), 1) * this.msPerWord;
  }

  private registerCall(request: TtsRequest): number {
    this.requests.push(request);
    this.callCount += 1;
    return this.callCount;
  }

  private maybeFail(callIndex: number): void {
    if (this.failEveryNth && this.failEveryNth > 0 && callIndex % this.failEveryNth === 0) {
      throw new Error(`FakeTtsProvider: simulated failure on request #${callIndex}`);
    }
  }

  async synthesize(request: TtsRequest, signal?: AbortSignal): Promise<AudioResult> {
    throwIfAborted(signal);
    const callIndex = this.registerCall(request);

    await delay(this.latencyMs, signal);
    throwIfAborted(signal);
    this.maybeFail(callIndex);

    const durationMs = this.durationMsFor(request.text);
    const wav = makeSilentWav(durationMs, this.sampleRate);

    return { audioUri: toDataUri(wav), durationMs, mimeType: "audio/wav" };
  }

  async *synthesizeStream(request: TtsRequest, signal?: AbortSignal): AsyncIterable<AudioFrame> {
    throwIfAborted(signal);
    const callIndex = this.registerCall(request);

    await delay(this.latencyMs, signal);
    throwIfAborted(signal);
    this.maybeFail(callIndex);

    const durationMs = this.durationMsFor(request.text);
    const wav = makeSilentWav(durationMs, this.sampleRate);

    const frameCount = 3;
    const chunkSize = Math.max(1, Math.ceil(wav.length / frameCount));

    for (let i = 0; i < frameCount; i++) {
      throwIfAborted(signal);
      const start = i * chunkSize;
      const end = i === frameCount - 1 ? wav.length : Math.min(start + chunkSize, wav.length);
      yield { data: wav.subarray(start, end), isFinal: i === frameCount - 1 };
    }
  }

  reset(): void {
    this.requests.length = 0;
    this.callCount = 0;
  }
}
