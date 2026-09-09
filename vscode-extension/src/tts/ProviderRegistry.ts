/**
 * Concrete `ProviderRegistry<T>` (ADR-005 §"SourceAdapter, santé et registre"):
 * profiles reference a `providerId`, never a class, so `FakeTtsProvider` can
 * be registered under the same id a real provider would use.
 */

import type { Identified, ProviderHealth, ProviderRegistry } from "../core/health.js";

export class InMemoryProviderRegistry<T extends Identified> implements ProviderRegistry<T> {
  private readonly providers = new Map<string, T>();

  register(provider: T): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): T | undefined {
    return this.providers.get(id);
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  list(): readonly T[] {
    return [...this.providers.values()];
  }
}

/** Anything the `LLM Voice: Provider Status` quick pick (CdC §51) can probe. */
export interface HealthCheckable extends Identified {
  health(signal?: AbortSignal): Promise<ProviderHealth>;
}

/**
 * Probes `health()` on every provider given, in parallel. A provider that
 * throws instead of resolving is reported `unreachable` rather than crashing
 * the whole probe (CdC §51: "un provider hors ligne ne doit jamais faire
 * planter l'extension"). Shared by `TtsProviderRegistry.healthAll` and
 * `Pipeline.providerStatus` (which also probes the narrator provider,
 * outside any `TtsProviderRegistry`).
 */
export async function probeHealth(
  providers: readonly HealthCheckable[],
  signal?: AbortSignal
): Promise<ProviderHealth[]> {
  return Promise.all(
    providers.map(async (provider) => {
      try {
        return await provider.health(signal);
      } catch (error) {
        return {
          providerId: provider.id,
          status: "unreachable" as const,
          checkedAt: Date.now(),
          detail: error instanceof Error ? error.message : String(error)
        };
      }
    })
  );
}

/**
 * `TtsProviderRegistry`: the `InMemoryProviderRegistry<TtsProvider>` used by
 * the pipeline, with `healthAll()` added for `LLM Voice: Provider Status`
 * (CdC §51) and the status bar badge.
 */
export class TtsProviderRegistry<T extends HealthCheckable> extends InMemoryProviderRegistry<T> {
  async healthAll(signal?: AbortSignal): Promise<ProviderHealth[]> {
    return probeHealth(this.list(), signal);
  }
}
