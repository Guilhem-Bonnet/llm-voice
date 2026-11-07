import { describe, expect, it } from "vitest";
import { CastPanelController } from "../../../src/views/castPanel/CastPanelController.js";
import type { CastPanelState } from "../../../src/views/castPanel/castPanelModel.js";

const STATE: CastPanelState = {
  documentName: "07.md",
  engineLabel: "voix Qwen3",
  narrator: { voiceLabel: "Voix des essais", firstLine: "La Tour d'hiver" },
  rows: [{ roleId: "isaure", name: "Isaure", lines: 2, firstLine: "Alors il faut partir.", voiceId: "created-2", voiceLabel: "Isaure", byUser: true, shared: false, unavailable: false, narratorClash: false }],
  voices: [
    { id: "fr-essais-21-22", label: "Voix des essais", created: false, takenBy: [], narrator: true },
    { id: "created-2", label: "Isaure", created: true, takenBy: ["Isaure"], narrator: false }
  ],
  notice: undefined,
  canCreateVoice: true,
  slowFactor: 2,
  traitChoices: []
};

describe("CastPanelController : l'attente annoncée", () => {
  it("annonce au moins 30 s pour la première écoute d'une voix créée, puis l'estimation ordinaire", async () => {
    const posted: { type: string; [key: string]: unknown }[] = [];
    const controller = new CastPanelController(
      {
        loadState: () => Promise.resolve(STATE),
        listen: () => Promise.resolve({ uri: "file:///x.wav" }),
        sample: () => Promise.resolve({ uri: "file:///s.wav" }),
        assign: () => Promise.resolve(),
        createVoice: () => Promise.resolve({ id: "c", name: "c" }),
        read: () => Promise.resolve(),
        recast: () => Promise.resolve(),
        log: () => undefined
      },
      (message) => posted.push(message)
    );
    await controller.handle({ type: "ready" });
    expect(controller.estimate("Alors il faut partir.", "fr-essais-21-22")).toBe(2);
    await controller.handle({ type: "listen", roleId: "isaure", requestId: 1 });
    expect(posted.find((message) => message.type === "busy" && message.requestId === 1)?.estimateSeconds).toBe(30);
    await controller.handle({ type: "listen", roleId: "isaure", requestId: 2 });
    expect(posted.find((message) => message.type === "busy" && message.requestId === 2)?.estimateSeconds).toBe(2);
  });
});
