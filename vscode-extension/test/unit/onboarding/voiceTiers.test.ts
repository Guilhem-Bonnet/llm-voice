import { describe, expect, it } from "vitest";
import {
  CHATTERBOX_COMPOSE_COMMAND,
  CHATTERBOX_DOCS_URL,
  INSTALL_PIPER_VOICE_COMMAND,
  SYSTEM_VOICE_READY_MESSAGE,
  PIPER_VOICE_SIZE_LABEL,
  VOICE_TIER_OPTIONS
} from "../../../src/onboarding/voiceTiers.js";

describe("VOICE_TIER_OPTIONS", () => {
  it("has exactly three tiers, in the order the S7.2 story asks for", () => {
    expect(VOICE_TIER_OPTIONS.map((option) => option.tier)).toEqual(["system", "piper", "chatterbox"]);
  });

  it("never claims 'system' needs an install", () => {
    const system = VOICE_TIER_OPTIONS.find((option) => option.tier === "system");
    expect(system?.description.toLowerCase()).toContain("disponible tout de suite");
    expect(system?.detail.toLowerCase()).toContain("aucune installation");
  });

  it("is honest about piper's download size", () => {
    const piper = VOICE_TIER_OPTIONS.find((option) => option.tier === "piper");
    expect(piper?.description).toContain(PIPER_VOICE_SIZE_LABEL);
  });

  it("tells the user chatterbox needs Docker", () => {
    const chatterbox = VOICE_TIER_OPTIONS.find((option) => option.tier === "chatterbox");
    expect(chatterbox?.description.toLowerCase()).toContain("docker");
    expect(chatterbox?.detail.toLowerCase()).toContain("docker");
  });

  it("S8.3: labels chatterbox as an explicit advanced/Docker-only entry, never the default", () => {
    const chatterbox = VOICE_TIER_OPTIONS.find((option) => option.tier === "chatterbox");
    expect(chatterbox?.label).toContain("avancé — nécessite Docker");
  });

  it("S8.3: recommends the self-contained Piper tier as the no-Docker default", () => {
    const piper = VOICE_TIER_OPTIONS.find((option) => option.tier === "piper");
    expect(piper?.label.toLowerCase()).toContain("recommandé");
    expect(piper?.detail.toLowerCase()).toContain("aucun docker");
    expect(piper?.detail.toLowerCase()).not.toContain("chatterbox");
  });

  it("every label uses a codicon, never an emoji (ADR-011 theming)", () => {
    for (const option of VOICE_TIER_OPTIONS) {
      expect(option.label).toMatch(/^\$\([a-z-]+\)\s/);
    }
  });
});

describe("Chatterbox instructions", () => {
  it("points at the real docker-compose service (deploy/docker-compose.tts.yml)", () => {
    expect(CHATTERBOX_COMPOSE_COMMAND).toBe("docker compose -f deploy/docker-compose.tts.yml up -d chatterbox");
  });

  it("the docs link is a resolvable https URL", () => {
    expect(() => new URL(CHATTERBOX_DOCS_URL)).not.toThrow();
    expect(CHATTERBOX_DOCS_URL.startsWith("https://")).toBe(true);
  });
});

describe("S7.1 delegation constants", () => {
  it("names the real command SetupVoice delegates to for the piper tier", () => {
    expect(INSTALL_PIPER_VOICE_COMMAND).toBe("llmVoice.installPiperVoice");
  });

  it("has a non-empty, user-facing 'nothing to install' message for the system tier", () => {
    expect(SYSTEM_VOICE_READY_MESSAGE.length).toBeGreaterThan(0);
  });
});
