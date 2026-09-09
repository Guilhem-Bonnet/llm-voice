import { describe, expect, it } from "vitest";
import {
  formatProviderHealthQuickPickItem,
  titleCaseProviderId
} from "../../../src/ui/providerStatusText.js";
import type { ProviderHealth } from "../../../src/core/health.js";

describe("titleCaseProviderId", () => {
  it("title-cases a hyphenated providerId", () => {
    expect(titleCaseProviderId("openai-compatible")).toBe("Openai Compatible");
  });

  it("title-cases a single-word providerId", () => {
    expect(titleCaseProviderId("chatterbox")).toBe("Chatterbox");
  });
});

describe("formatProviderHealthQuickPickItem (CdC §51)", () => {
  it("renders an ok/Ready provider with endpoint and latency", () => {
    const health: ProviderHealth = {
      providerId: "chatterbox",
      status: "ok",
      checkedAt: 0,
      endpoint: "localhost:8004",
      latencyMs: 120
    };
    const item = formatProviderHealthQuickPickItem("Chatterbox", health);
    expect(item.label).toBe("$(pass) Ready · Chatterbox");
    expect(item.detail).toBe("localhost:8004 · 120 ms");
  });

  it("renders an unreachable/Offline provider (offline must never crash, CdC §51)", () => {
    const health: ProviderHealth = {
      providerId: "ollama",
      status: "unreachable",
      checkedAt: 0,
      detail: "ECONNREFUSED"
    };
    const item = formatProviderHealthQuickPickItem("Ollama", health);
    expect(item.label).toBe("$(circle-slash) Offline · Ollama");
    expect(item.detail).toBe("ECONNREFUSED");
  });

  it("renders every other status with its icon", () => {
    const base: Omit<ProviderHealth, "status"> = { providerId: "x", checkedAt: 0 };
    expect(formatProviderHealthQuickPickItem("X", { ...base, status: "degraded" }).label).toBe(
      "$(sync~spin) Loading · X"
    );
    expect(formatProviderHealthQuickPickItem("X", { ...base, status: "unauthorized" }).label).toBe(
      "$(error) Error · X"
    );
    expect(formatProviderHealthQuickPickItem("X", { ...base, status: "unverified" }).label).toBe(
      "$(question) Unverified · X"
    );
  });
});
