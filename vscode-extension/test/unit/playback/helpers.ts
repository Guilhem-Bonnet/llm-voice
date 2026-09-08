/**
 * Shared fixtures for the playback unit suite: a minimal profile, segment
 * builders, and a TTS decorator that records concurrency and abort signals.
 */
import type {
  AudioResult,
  NarrationSegment,
  ProviderHealth,
  SourceSegment,
  TtsCapabilities,
  TtsProvider,
  TtsRequest,
  VoiceProfile,
  Voice
} from "../../../src/core/index.js";

export function makeProfile(overrides: Partial<VoiceProfile> = {}): VoiceProfile {
  return {
    id: "profile-test",
    label: "Test",
    mode: "faithful",
    language: "fr",
    tts: {
      providerId: "fake-tts",
      baseUrl: "http://127.0.0.1:8004",
      model: "test-model",
      voice: "fake-voice"
    },
    chunking: { unit: "sentence", maxSentences: 3, prefetchChunks: 2 },
    playback: { rate: 1, volume: 1 },
    ...overrides
  };
}

export function makeSegments(count: number, prefix = "seg"): NarrationSegment[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    spokenText: `Phrase numero ${index}.`,
    sourceSegmentIds: [`src-${index}`],
    sourceRanges: [
      { startLine: index, startColumn: 0, endLine: index, endColumn: 10 }
    ]
  }));
}

export function makeSourceSegments(count: number): SourceSegment[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `src-${index}`,
    type: "sentence" as const,
    rawText: `Bloc source ${index}.`,
    sourceRange: {
      startLine: index,
      startColumn: 0,
      endLine: index,
      endColumn: 12
    }
  }));
}

/**
 * Wraps a `TtsProvider` to record the abort signal of every call and the
 * maximum number of calls in flight at once — the two facts CdC §62 and §65
 * turn into assertions.
 */
export class RecordingTtsProvider implements TtsProvider {
  readonly signals: (AbortSignal | undefined)[] = [];
  readonly texts: string[] = [];
  maxConcurrent = 0;
  private inFlight = 0;

  /** Spoken texts for which every attempt fails, whatever the inner provider. */
  readonly failTexts: Set<string>;

  constructor(
    private readonly inner: TtsProvider,
    failTexts: readonly string[] = []
  ) {
    this.failTexts = new Set(failTexts);
  }

  get id(): string {
    return this.inner.id;
  }

  get callCount(): number {
    return this.texts.length;
  }

  health(signal?: AbortSignal): Promise<ProviderHealth> {
    return this.inner.health(signal);
  }

  getCapabilities(signal?: AbortSignal): Promise<TtsCapabilities> {
    return this.inner.getCapabilities(signal);
  }

  listVoices(signal?: AbortSignal): Promise<Voice[]> {
    return this.inner.listVoices?.(signal) ?? Promise.resolve([]);
  }

  async synthesize(request: TtsRequest, signal?: AbortSignal): Promise<AudioResult> {
    this.signals.push(signal);
    this.texts.push(request.text);
    this.inFlight += 1;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.inFlight);
    try {
      if (this.failTexts.has(request.text)) {
        throw new Error(`RecordingTtsProvider: forced failure on "${request.text}"`);
      }
      return await this.inner.synthesize(request, signal);
    } finally {
      this.inFlight -= 1;
    }
  }
}
