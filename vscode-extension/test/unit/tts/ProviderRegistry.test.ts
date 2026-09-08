import { describe, expect, it } from "vitest";
import type { ProviderHealth } from "../../../src/core/health.js";
import { InMemoryProviderRegistry, TtsProviderRegistry, type HealthCheckable } from "../../../src/tts/ProviderRegistry.js";

class FakeHealthCheckable implements HealthCheckable {
  constructor(
    readonly id: string,
    private readonly outcome: ProviderHealth | "throw"
  ) {}

  async health(): Promise<ProviderHealth> {
    if (this.outcome === "throw") {
      throw new Error("boom");
    }
    return this.outcome;
  }
}

describe("InMemoryProviderRegistry (ADR-005)", () => {
  it("registers, looks up and lists by id", () => {
    const registry = new InMemoryProviderRegistry<FakeHealthCheckable>();
    const provider = new FakeHealthCheckable("chatterbox", {
      providerId: "chatterbox",
      status: "ok",
      checkedAt: 0
    });
    registry.register(provider);

    expect(registry.has("chatterbox")).toBe(true);
    expect(registry.get("chatterbox")).toBe(provider);
    expect(registry.get("missing")).toBeUndefined();
    expect(registry.list()).toEqual([provider]);
  });
});

describe("TtsProviderRegistry.healthAll() (CdC §51 — Provider Status)", () => {
  it("probes every registered provider in parallel", async () => {
    const registry = new TtsProviderRegistry<FakeHealthCheckable>();
    registry.register(
      new FakeHealthCheckable("chatterbox", { providerId: "chatterbox", status: "ok", checkedAt: 0 })
    );
    registry.register(
      new FakeHealthCheckable("kokoro", { providerId: "kokoro", status: "degraded", checkedAt: 0 })
    );

    const results = await registry.healthAll();
    expect(results.map((health) => health.status).sort()).toEqual(["degraded", "ok"]);
  });

  it("never lets a throwing provider crash the probe (CdC §51: offline provider must not crash the extension)", async () => {
    const registry = new TtsProviderRegistry<FakeHealthCheckable>();
    registry.register(new FakeHealthCheckable("broken", "throw"));

    const results = await registry.healthAll();
    expect(results).toEqual([
      expect.objectContaining({ providerId: "broken", status: "unreachable", detail: "boom" })
    ]);
  });
});
