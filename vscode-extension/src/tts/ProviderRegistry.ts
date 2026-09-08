/**
 * Concrete `ProviderRegistry<T>` (ADR-005 §"SourceAdapter, santé et registre"):
 * profiles reference a `providerId`, never a class, so `FakeTtsProvider` can
 * be registered under the same id a real provider would use.
 */

import type { Identified, ProviderRegistry } from "../core/health.js";

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
