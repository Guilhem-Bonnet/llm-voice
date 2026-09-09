import { describe, expect, it } from "vitest";
import {
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
