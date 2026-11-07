import { describe, expect, it } from "vitest";
import { castNotice, composeVoiceDescription, parseCastPanelMessage, VOICE_TRAITS, type VoiceTrait } from "../../../src/views/castPanel/castPanelModel.js";

describe("le panneau Distribution : messages et voix à créer", () => {
  it("compose une consigne anglaise à partir des choix simples", () => {
    expect(composeVoiceDescription({ gender: "woman", age: "young", timbre: "high", traits: ["proud", "anxious"] })).toBe(
      "A young woman with a high-pitched, bright voice, speaking French naturally. Proud and haughty, anxious and worried."
    );
    expect(composeVoiceDescription({ gender: "man", age: "elderly", timbre: "deep", traits: [] })).toBe(
      "An elderly man with a deep, low-pitched voice, speaking French naturally."
    );
  });

  it("donne toujours une description ASCII imprimable, de 300 caractères au plus", () => {
    const traits = Object.keys(VOICE_TRAITS) as VoiceTrait[];
    for (const gender of ["woman", "man", "unspecified"] as const) {
      for (const age of ["child", "young", "adult", "elderly"] as const) {
        for (const timbre of ["deep", "medium", "high"] as const) {
          for (let start = 0; start < traits.length; start += 1) {
            const description = composeVoiceDescription({ gender, age, timbre, traits: traits.slice(start, start + 3) });
            expect(description).toMatch(/^[\x20-\x7e]+$/);
            expect(description.length).toBeLessThanOrEqual(300);
          }
        }
      }
    }
  });

  it("refuse un caractère inconnu ou saisi librement, et plus de trois caractères", () => {
    const base = { type: "createVoice", name: "Isaure", requestId: 1 };
    expect(parseCastPanelMessage({ ...base, recipe: { gender: "woman", age: "adult", timbre: "deep", traits: ["fière, inquiète"] } })).toBeUndefined();
    expect(parseCastPanelMessage({ ...base, recipe: { gender: "woman", age: "adult", timbre: "deep", traits: ["calm", "warm", "proud", "cold"] } })).toBeUndefined();
    expect(parseCastPanelMessage({ ...base, recipe: { gender: "woman", age: "adult", timbre: "deep", character: "libre" } })).toBeUndefined();
    expect(parseCastPanelMessage({ ...base, recipe: { gender: "woman", age: "adult", timbre: "deep", traits: ["toString"] } })).toBeUndefined();
  });

  it("refuse un message mal formé et garde les bons", () => {
    expect(parseCastPanelMessage({ type: "assign", roleId: "isaure", voiceId: "v1" })).toEqual({ type: "assign", roleId: "isaure", voiceId: "v1" });
    expect(parseCastPanelMessage({ type: "assign", roleId: "", voiceId: "v1" })).toBeUndefined();
    expect(parseCastPanelMessage({ type: "createVoice", name: " ".repeat(3), recipe: { gender: "woman", age: "adult", timbre: "deep", traits: [] }, requestId: 1 })).toBeUndefined();
    expect(parseCastPanelMessage({ type: "createVoice", name: "Isaure", recipe: { gender: "robot", age: "adult", timbre: "deep", traits: [] }, requestId: 1 })).toBeUndefined();
    expect(parseCastPanelMessage({ type: "createVoice", name: "Isaure", recipe: { gender: "woman", age: "adult", timbre: "deep", traits: [] }, requestId: 2, forRoleId: "isaure" })).toMatchObject({ name: "Isaure", forRoleId: "isaure" });
    expect(parseCastPanelMessage({ type: "rm -rf" })).toBeUndefined();
  });

  it("dit quoi faire quand les voix manquent, sans renvoyer ailleurs", () => {
    expect(castNotice({ multiVoice: true, canCreateVoice: true, characters: 2, freeVoices: 0 })).toContain("Créez une voix");
    expect(castNotice({ multiVoice: true, canCreateVoice: false, characters: 2, freeVoices: 3 })).toBeUndefined();
    expect(castNotice({ multiVoice: false, canCreateVoice: true, characters: 2, freeVoices: 0 })).toContain("Créez une voix");
  });
});
