/** Shared fixtures of the translator suite: the real capabilities of the real providers, and cue builders. */
import type { Cue } from "../../../../src/core/direction.js";
import type { TtsCapabilities } from "../../../../src/core/tts.js";
import { createEgressGuard } from "../../../../src/net/EgressGuard.js";
import { ChatterboxProvider } from "../../../../src/tts/ChatterboxProvider.js";
import { KokoroProvider } from "../../../../src/tts/KokoroProvider.js";
import { OpenAICompatibleTtsProvider } from "../../../../src/tts/OpenAICompatibleTtsProvider.js";
import { SystemTtsProvider } from "../../../../src/tts/SystemTtsProvider.js";
import { EspeakOnlyRunner } from "../../../fakes/FakeSystemTtsRunner.js";
import { MockTtsServer } from "../../../fakes/mockTtsServer.js";

export interface RealCapabilities {
  readonly chatterbox: TtsCapabilities;
  readonly kokoro: TtsCapabilities;
  readonly openai: TtsCapabilities;
  readonly system: TtsCapabilities;
  /** An engine that declares no `direction` at all (a third-party provider, ADR-005). */
  readonly undeclared: TtsCapabilities;
}

/** `getCapabilities()` of each provider, as the extension reads it (mock HTTP server on loopback for the HTTP ones). */
export async function loadRealCapabilities(): Promise<RealCapabilities> {
  const server = new MockTtsServer();
  const baseUrl = await server.listen();
  try {
    const egress = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
    const chatterbox = await new ChatterboxProvider({ baseUrl, egress }).getCapabilities();
    const kokoro = await new KokoroProvider({ baseUrl, egress }).getCapabilities();
    const openai = await new OpenAICompatibleTtsProvider({ id: "openai", baseUrl, egress }).getCapabilities();
    const system = await new SystemTtsProvider({
      platform: "linux",
      runner: new EspeakOnlyRunner(),
      isFlatpak: false,
      homeDir: "/nonexistent-home"
    }).getCapabilities();
    const { direction: _dropped, ...rest } = system;
    void _dropped;
    return { chatterbox, kokoro, openai, system, undeclared: rest };
  } finally {
    await server.close();
  }
}

export function cue(cueId: string, overrides: Partial<Cue> = {}): Cue {
  return { cueId, sourceIds: [`src-${cueId}`], speakerId: "narrator", spokenText: `Texte ${cueId}.`, ...overrides };
}

/** Small deterministic PRNG: a failing property test is reproducible from the seed in its name. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
