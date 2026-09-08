// TODO align with src/core once merged
//
// Minimal local copies of the provider contracts described in
// cahier-des-charges.md §20 (NarratorProvider), §23 (TtsProvider),
// §61 (NarrationSegment) and the streaming preparation from
// decisions-cadrage-v1.md D2. These types exist only so the fakes/mocks in
// this directory can be written and type-checked without depending on
// `src/core`, which is being authored in parallel. Once `src/core` lands,
// delete this file and re-point imports at the real contracts.

export interface SourceRange {
  start: number;
  end: number;
}

export interface ProviderHealth {
  ok: boolean;
  message?: string;
}

// --- Narrator (CdC §20, §61) -----------------------------------------

export interface NarrationSegmentInput {
  id: string;
  text: string;
}

export interface NarrationRequest {
  segments: NarrationSegmentInput[];
  profileId?: string;
}

export interface NarrationSegment {
  id: string;
  spokenText: string;
  sourceSegmentIds: string[];
  sourceRanges: SourceRange[];
  metadata?: Record<string, unknown>;
}

export interface NarratorProvider {
  id: string;
  health(): Promise<ProviderHealth>;
  transform(request: NarrationRequest, signal?: AbortSignal): Promise<NarrationSegment[]>;
}

// --- TTS (CdC §23, D2 streaming preparation) --------------------------

export interface Voice {
  id: string;
  name: string;
  language?: string;
}

export interface TtsCapabilities {
  streaming: boolean;
  voices?: Voice[];
}

export interface TtsRequest {
  text: string;
  language?: string;
  voice?: string;
  speed?: number;
  parameters?: Record<string, unknown>;
}

export interface AudioResult {
  audioUri: string;
  durationMs?: number;
  mimeType?: string;
}

export interface AudioFrame {
  data: Uint8Array;
  isFinal: boolean;
}

export interface TtsProvider {
  id: string;
  health(): Promise<ProviderHealth>;
  getCapabilities(): Promise<TtsCapabilities>;
  listVoices?(): Promise<Voice[]>;
  synthesize(request: TtsRequest, signal?: AbortSignal): Promise<AudioResult>;
  synthesizeStream?(request: TtsRequest, signal?: AbortSignal): AsyncIterable<AudioFrame>;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    throwIfAborted(signal);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}
