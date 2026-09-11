import { describe, expect, it } from "vitest";
import type { ProviderHealth } from "../../../src/core/health.js";
import type { PiperInstallConsentDetails, PiperInstallOutcome } from "../../../src/tts/PiperSetup.js";
import {
  fallbackMessageFor,
  formatAutoVoiceInstallPrompt,
  INSTALL_VOICE_ACTION_LABEL,
  nextActionFor,
  shouldOfferAutoVoiceInstall
} from "../../../src/tts/AutoVoiceInstall.js";

function health(status: ProviderHealth["status"]): ProviderHealth {
  return { providerId: "system", status, checkedAt: Date.now() };
}

const DETAILS: PiperInstallConsentDetails = {
  totalBytes: 63 * 1024 * 1024,
  binaryUrl: "https://github.com/rhasspy/piper/releases/download/x/piper.tar.gz",
  binarySizeBytes: 20 * 1024 * 1024,
  voiceUrl: "https://huggingface.co/x/fr_FR-siwis-medium.onnx",
  voiceSizeBytes: 43 * 1024 * 1024,
  piperLicense: "MIT",
  piperSourceUrl: "https://github.com/rhasspy/piper",
  voiceLicense: "CC0",
  voiceSourceUrl: "https://huggingface.co/rhasspy/piper-voices",
  voiceId: "fr_FR-siwis-medium"
};

describe("shouldOfferAutoVoiceInstall", () => {
  it("offers the install only for the system tier with no usable engine (unreachable)", () => {
    expect(shouldOfferAutoVoiceInstall("system", health("unreachable"))).toBe(true);
  });

  it("never offers it once any system engine is usable (ok or degraded)", () => {
    expect(shouldOfferAutoVoiceInstall("system", health("ok"))).toBe(false);
    expect(shouldOfferAutoVoiceInstall("system", health("degraded"))).toBe(false);
  });

  it("never offers it for a non-system provider, even if unreachable (S8.3: Chatterbox/remote handle their own health UX)", () => {
    expect(shouldOfferAutoVoiceInstall("chatterbox", health("unreachable"))).toBe(false);
    expect(shouldOfferAutoVoiceInstall("piper-local", health("unreachable"))).toBe(false);
    expect(shouldOfferAutoVoiceInstall("openai-compatible", health("unreachable"))).toBe(false);
  });
});

describe("formatAutoVoiceInstallPrompt", () => {
  it("names the real total size, rounded to whole megabytes, and the voice id", () => {
    const message = formatAutoVoiceInstallPrompt(DETAILS);
    expect(message).toContain("63 Mo");
    expect(message).toContain("fr_FR-siwis-medium");
    expect(message).toContain(DETAILS.piperLicense);
  });

  it("never names Chatterbox", () => {
    expect(formatAutoVoiceInstallPrompt(DETAILS).toLowerCase()).not.toContain("chatterbox");
  });
});

describe("nextActionFor / fallbackMessageFor", () => {
  it("resumes only on a successful install", () => {
    const installed: PiperInstallOutcome = {
      status: "installed",
      binaryPath: "/x/bin/piper",
      voiceModelPath: "/x/voices/fr_FR-siwis-medium.onnx"
    };
    expect(nextActionFor(installed)).toBe("resumed");
  });

  it("falls back honestly on a decline — no network dependency, no error to log", () => {
    const declined: PiperInstallOutcome = { status: "declined" };
    expect(nextActionFor(declined)).toBe("fallback");
    expect(fallbackMessageFor(declined).toLowerCase()).not.toContain("chatterbox");
    expect(fallbackMessageFor(declined)).toContain("voix système");
  });

  it("falls back honestly when offline/download fails, quoting the real error", () => {
    const failed: PiperInstallOutcome = { status: "failed", message: "fetch failed" };
    expect(nextActionFor(failed)).toBe("fallback");
    const message = fallbackMessageFor(failed);
    expect(message).toContain("fetch failed");
    expect(message.toLowerCase()).not.toContain("chatterbox");
  });

  it("falls back honestly on an unsupported platform, without naming Chatterbox", () => {
    const unsupported: PiperInstallOutcome = { status: "unsupported-platform" };
    expect(nextActionFor(unsupported)).toBe("fallback");
    expect(fallbackMessageFor(unsupported).toLowerCase()).not.toContain("chatterbox");
  });
});

describe("INSTALL_VOICE_ACTION_LABEL", () => {
  it("is the one and only button label — no second/third choice", () => {
    expect(INSTALL_VOICE_ACTION_LABEL.length).toBeGreaterThan(0);
  });
});
