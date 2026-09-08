import { describe, expect, it } from "vitest";
import { verifyLocalMode, type VerifyLocalModeInputs } from "../../../src/net/verifyLocalMode.js";

const ALL_GREEN_INPUTS: VerifyLocalModeInputs = {
  ttsBaseUrl: "http://127.0.0.1:8004",
  narratorBaseUrl: "http://localhost:11434",
  egressMode: "local",
  strictLocalEnv: true,
  trustedHosts: [],
  trustedHostsConfirmed: false,
  webviewConnectSrc: "default-src 'none'; connect-src 'none'",
  webviewLocalResourceRoots: ["/home/user/.llm-voice/media"],
  productionDependencies: ["zod"],
  directNetworkCallDetected: false,
  huggingFaceOfflineEnv: true
};

describe("verifyLocalMode", () => {
  it("badges 'local' when every blocking check is ok", () => {
    const result = verifyLocalMode(ALL_GREEN_INPUTS);

    expect(result.checks).toHaveLength(10);
    expect(result.checks.every((check) => check.status === "ok")).toBe(true);
    expect(result.badge).toBe("local");
  });

  it("badges 'unverified' when a blocking check fails", () => {
    const result = verifyLocalMode({ ...ALL_GREEN_INPUTS, egressMode: "trusted" });

    const egressCheck = result.checks.find((check) => check.id === 3);
    expect(egressCheck?.status).toBe("fail");
    expect(result.badge).toBe("unverified");

    // Non-blocking checks staying green does not rescue the badge.
    expect(result.checks.filter((check) => check.id !== 3).every((check) => check.status === "ok")).toBe(true);
  });

  it("badges 'unverified' (never a silent pass) when a blocking check is only unverifiable", () => {
    const inputs: VerifyLocalModeInputs = { ...ALL_GREEN_INPUTS };
    delete inputs.productionDependencies;
    const result = verifyLocalMode(inputs);

    const telemetryCheck = result.checks.find((check) => check.id === 8);
    expect(telemetryCheck?.status).toBe("unverifiable");
    expect(result.badge).toBe("unverified");
  });

  it("does not fail the badge on a non-blocking warn (e.g. strict-local env off)", () => {
    const result = verifyLocalMode({ ...ALL_GREEN_INPUTS, strictLocalEnv: false });

    const strictCheck = result.checks.find((check) => check.id === 5);
    expect(strictCheck?.status).toBe("warn");
    expect(result.badge).toBe("local");
  });

  it("treats an absent narrator binding as satisfying the narrator loopback check", () => {
    const inputs: VerifyLocalModeInputs = { ...ALL_GREEN_INPUTS };
    delete inputs.narratorBaseUrl;
    const result = verifyLocalMode(inputs);

    const narratorCheck = result.checks.find((check) => check.id === 2);
    expect(narratorCheck?.status).toBe("ok");
    expect(result.badge).toBe("local");
  });

  it("fails the TTS loopback check for a remote endpoint", () => {
    const result = verifyLocalMode({ ...ALL_GREEN_INPUTS, ttsBaseUrl: "https://tts.example.com" });

    const ttsCheck = result.checks.find((check) => check.id === 1);
    expect(ttsCheck?.status).toBe("fail");
    expect(result.badge).toBe("unverified");
  });
});
