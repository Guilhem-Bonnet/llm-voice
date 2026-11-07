import { describe, expect, it } from "vitest";
import { castNotice, composeVoiceDescription, parseCastPanelMessage } from "../../../src/views/castPanel/castPanelModel.js";

describe("le panneau Distribution : messages et voix à créer", () => {
  it("compose une consigne anglaise à partir des choix simples", () => {
    expect(composeVoiceDescription({ gender: "woman", age: "young", timbre: "high", character: "fière, inquiète" })).toBe(
      'A young woman with a high-pitched, bright voice, speaking French naturally. Character: "fière, inquiète".'
    );
    expect(composeVoiceDescription({ gender: "man", age: "elderly", timbre: "deep", character: "" })).toBe(
      "An elderly man with a deep, low-pitched voice, speaking French naturally."
    );
    expect(composeVoiceDescription({ gender: "unspecified", age: "adult", timbre: "medium", character: "x".repeat(500) }).length).toBeLessThanOrEqual(300);
  });

  it("refuse un message mal formé et garde les bons", () => {
    expect(parseCastPanelMessage({ type: "assign", roleId: "isaure", voiceId: "v1" })).toEqual({ type: "assign", roleId: "isaure", voiceId: "v1" });
    expect(parseCastPanelMessage({ type: "assign", roleId: "", voiceId: "v1" })).toBeUndefined();
    expect(parseCastPanelMessage({ type: "createVoice", name: " ".repeat(3), recipe: { gender: "woman", age: "adult", timbre: "deep", character: "" }, requestId: 1 })).toBeUndefined();
    expect(parseCastPanelMessage({ type: "createVoice", name: "Isaure", recipe: { gender: "robot", age: "adult", timbre: "deep", character: "" }, requestId: 1 })).toBeUndefined();
    expect(parseCastPanelMessage({ type: "createVoice", name: "Isaure", recipe: { gender: "woman", age: "adult", timbre: "deep", character: "" }, requestId: 2, forRoleId: "isaure" })).toMatchObject({ name: "Isaure", forRoleId: "isaure" });
    expect(parseCastPanelMessage({ type: "rm -rf" })).toBeUndefined();
  });

  it("dit quoi faire quand les voix manquent, sans renvoyer ailleurs", () => {
    expect(castNotice({ multiVoice: true, canCreateVoice: true, characters: 2, freeVoices: 0 })).toContain("Créez une voix");
    expect(castNotice({ multiVoice: true, canCreateVoice: false, characters: 2, freeVoices: 3 })).toBeUndefined();
    expect(castNotice({ multiVoice: false, canCreateVoice: true, characters: 2, freeVoices: 0 })).toContain("Créez une voix");
  });
});
