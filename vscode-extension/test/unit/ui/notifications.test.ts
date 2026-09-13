import { describe, expect, it } from "vitest";
import {
  chooseTtsUnavailableMessage,
  formatTtsUnavailableDiagnosticMessage,
  NotificationGate,
  notifyChunkInvalid,
  notifyNarratorUnavailable,
  notifyTtsUnavailable,
  TTS_UNAVAILABLE_MESSAGE,
  type ShowMessage
} from "../../../src/ui/notifications.js";

function stub(answer: string | undefined): ShowMessage {
  return () => Promise.resolve(answer);
}

describe("notifyTtsUnavailable (CdC §52 'TTS indisponible', S7.3 actionable wording)", () => {
  it("shows 'Aucune voix configurée' (not a hardcoded provider name) and maps 'Choisir une voix'", async () => {
    let seenMessage: string | undefined;
    const show: ShowMessage = (message) => {
      seenMessage = message;
      return Promise.resolve("Choisir une voix");
    };
    const choice = await notifyTtsUnavailable(show);
    expect(seenMessage).toBe(TTS_UNAVAILABLE_MESSAGE);
    expect(seenMessage).not.toContain("Chatterbox");
    expect(choice).toBe("setupVoice");
  });

  it("maps 'Voir les réglages', 'Réessayer', and a dismissed dialog", async () => {
    expect(await notifyTtsUnavailable(stub("Voir les réglages"))).toBe("openSettings");
    expect(await notifyTtsUnavailable(stub("Réessayer"))).toBe("retry");
    expect(await notifyTtsUnavailable(stub(undefined))).toBe("dismissed");
  });
});

describe("chooseTtsUnavailableMessage (bug fix: voice-selection-not-applied / infinite loop, 2026-09-12)", () => {
  it("simulates the real user's two consecutive failures: the second message differs from the first and names the cause", () => {
    // First chunk-0 failure this Pipeline instance has ever shown a dialog
    // for: no diagnostic yet, the plain actionable message.
    const firstMessage = chooseTtsUnavailableMessage(false, undefined);
    expect(firstMessage).toBe(TTS_UNAVAILABLE_MESSAGE);

    // User clicks "Choisir une voix", picks Chatterbox, retries — second
    // consecutive chunk-0 failure, same or different underlying cause.
    const secondMessage = chooseTtsUnavailableMessage(true, {
      providerId: "chatterbox",
      baseUrl: "http://localhost:8004",
      errorDetail: "ChatterboxProvider: HTTP 400 from http://localhost:8004/tts"
    });

    // The bug this test reproduces (fails before the fix): before
    // `chooseTtsUnavailableMessage` existed, both dialogs used the exact
    // same `TTS_UNAVAILABLE_MESSAGE` string — indistinguishable from the
    // user's point of view, "boucle infinie".
    expect(secondMessage).not.toBe(firstMessage);
    expect(secondMessage).toContain("chatterbox");
    expect(secondMessage).toContain("http://localhost:8004");
    expect(secondMessage).toContain("HTTP 400");
  });

  it("still falls back to the plain message when no diagnostic is available yet, even on a repeat", () => {
    expect(chooseTtsUnavailableMessage(true, undefined)).toBe(TTS_UNAVAILABLE_MESSAGE);
  });
});

describe("formatTtsUnavailableDiagnosticMessage", () => {
  it("names the provider, the endpoint and the real error", () => {
    const message = formatTtsUnavailableDiagnosticMessage({
      providerId: "piper-local",
      baseUrl: "http://localhost:5000",
      errorDetail: "HTTP 422 from http://localhost:5000/v1/audio/speech"
    });
    expect(message).toContain("piper-local");
    expect(message).toContain("http://localhost:5000");
    expect(message).toContain("HTTP 422");
    expect(message).not.toBe(TTS_UNAVAILABLE_MESSAGE);
  });

  it("uses a plain-language endpoint label for the system provider (empty baseUrl)", () => {
    const message = formatTtsUnavailableDiagnosticMessage({
      providerId: "system",
      baseUrl: "",
      errorDetail: "no local engine found"
    });
    expect(message).not.toContain("()");
    expect(message).toContain("system");
    expect(message).toContain("no local engine found");
  });
});

describe("notifyNarratorUnavailable (CdC §52 'Narrator indisponible')", () => {
  it("maps every one of the three choices, plus dismissed", async () => {
    expect(await notifyNarratorUnavailable(stub("Retry"))).toBe("retry");
    expect(await notifyNarratorUnavailable(stub("Read without narration"))).toBe("readWithoutNarration");
    expect(await notifyNarratorUnavailable(stub("Cancel"))).toBe("cancel");
    expect(await notifyNarratorUnavailable(stub(undefined))).toBe("dismissed");
  });
});

describe("notifyChunkInvalid (CdC §52 'Chunk TTS invalide', decision skip/stop)", () => {
  it("maps 'Skip' to 'skip'", async () => {
    expect(await notifyChunkInvalid(stub("Skip"), 2)).toBe("skip");
  });

  it("maps 'Stop' to 'stop'", async () => {
    expect(await notifyChunkInvalid(stub("Stop"), 2)).toBe("stop");
  });

  it("defaults a dismissed dialog to 'stop' (the safe choice)", async () => {
    expect(await notifyChunkInvalid(stub(undefined), 2)).toBe("stop");
  });

  it("mentions the configured maxRetries in the message", async () => {
    let seenMessage: string | undefined;
    const show: ShowMessage = (message) => {
      seenMessage = message;
      return Promise.resolve("Skip");
    };
    await notifyChunkInvalid(show, 5);
    expect(seenMessage).toContain("5");
  });
});

describe("NotificationGate (CdC §52 anti-spam: une seule notification par session par type)", () => {
  it("notifies the first time, then stays silent for the same type", () => {
    const gate = new NotificationGate();
    expect(gate.shouldNotify("ttsUnavailable")).toBe(true);
    gate.markShown("ttsUnavailable");
    expect(gate.shouldNotify("ttsUnavailable")).toBe(false);
  });

  it("keeps other types independent", () => {
    const gate = new NotificationGate();
    gate.markShown("ttsUnavailable");
    expect(gate.shouldNotify("narratorUnavailable")).toBe(true);
    expect(gate.shouldNotify("chunkInvalid")).toBe(true);
  });

  it("clear() re-arms a single type (Retry)", () => {
    const gate = new NotificationGate();
    gate.markShown("ttsUnavailable");
    gate.clear("ttsUnavailable");
    expect(gate.shouldNotify("ttsUnavailable")).toBe(true);
  });

  it("reset() re-arms every type (new session)", () => {
    const gate = new NotificationGate();
    gate.markShown("ttsUnavailable");
    gate.markShown("chunkInvalid");
    gate.reset();
    expect(gate.shouldNotify("ttsUnavailable")).toBe(true);
    expect(gate.shouldNotify("chunkInvalid")).toBe(true);
  });
});
