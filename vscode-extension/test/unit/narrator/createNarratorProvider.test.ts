import { describe, expect, it } from "vitest";
import { createEgressGuard } from "../../../src/net/EgressGuard.js";
import { createNarratorProvider } from "../../../src/narrator/createNarratorProvider.js";
import { NoNarrator } from "../../../src/narrator/NoNarrator.js";
import { OllamaNarrator } from "../../../src/narrator/OllamaNarrator.js";
import { OpenAICompatibleNarrator } from "../../../src/narrator/OpenAICompatibleNarrator.js";

const egress = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });

describe("createNarratorProvider (CdC §20-22)", () => {
  it("builds an OllamaNarrator for providerId 'ollama'", () => {
    const provider = createNarratorProvider({
      providerId: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen2.5:7b",
      egress
    });
    expect(provider).toBeInstanceOf(OllamaNarrator);
  });

  it.each(["openai-compatible", "llama.cpp", "vllm", "litellm"])(
    "builds an OpenAICompatibleNarrator for providerId '%s'",
    (providerId) => {
      const provider = createNarratorProvider({
        providerId,
        baseUrl: "http://127.0.0.1:8081",
        model: "local-model",
        egress
      });
      expect(provider).toBeInstanceOf(OpenAICompatibleNarrator);
    }
  );

  it.each(["none", "", "unknown-provider"])("builds a NoNarrator for providerId '%s'", (providerId) => {
    const provider = createNarratorProvider({
      providerId,
      baseUrl: "http://127.0.0.1:11434",
      model: "",
      egress
    });
    expect(provider).toBeInstanceOf(NoNarrator);
  });

  it("uses the supplied id as the provider's own id (registry cache key)", () => {
    const provider = createNarratorProvider({
      id: "narrator:ollama@http://127.0.0.1:11434@qwen2.5:7b",
      providerId: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen2.5:7b",
      egress
    });
    expect(provider.id).toBe("narrator:ollama@http://127.0.0.1:11434@qwen2.5:7b");
  });
});
