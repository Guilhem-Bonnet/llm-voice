/**
 * Explicit "no narration" provider (AC-09: zero network requests).
 *
 * Distinct from an *absent* `narrator` binding: `SessionFactory.buildSession`
 * already special-cases `narrator === undefined` as "faithful only" without
 * needing an instance. `NoNarrator` exists for the other case — a
 * `"narrated"` profile whose *resolved* provider is explicitly `"none"`
 * (empty `llmVoice.narrator.provider`, or a profile that opts out) — so
 * `createNarratorProvider` always returns a real `NarratorProvider`, and so
 * tests can assert zero calls through an actual instance rather than relying
 * on `undefined`.
 */

import type { ProviderHealth } from "../core/health.js";
import type { NarrationRequest, NarrationResult, NarratorCapabilities, NarratorProvider } from "../core/narration.js";
import { faithfulSegment } from "./shared.js";

export class NoNarrator implements NarratorProvider {
  readonly id: string;

  constructor(id = "none") {
    this.id = id;
  }

  /** Never touches the network: there is nothing to be unreachable from. */
  async health(): Promise<ProviderHealth> {
    return { providerId: this.id, status: "ok", checkedAt: Date.now() };
  }

  async getCapabilities(): Promise<NarratorCapabilities> {
    return { structuredOutput: false };
  }

  /** 1:1 faithful mapping, synchronously resolved, no request ever issued. */
  async transform(request: NarrationRequest): Promise<NarrationResult> {
    return { segments: request.segments.map(faithfulSegment), degraded: false };
  }
}
