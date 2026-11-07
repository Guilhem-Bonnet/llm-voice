/** Amendement 2026-11-07 d'ADR-018 : des états écrits aux consignes jouées, par une table. */
import { describe, expect, it } from "vitest";
import { STAGE_PLAY_TABLE, directionsOf, isSendableDirection, playOfStates } from "../../../../src/direction/cast/stagePlay.js";
import { cacheKeyFor, bindingForChunk } from "../../../../src/playback/AudioQueue.js";

const st = (label: string) => ({ label });

describe("table d'états", () => {
  it.each([
    ["essoufflé", /out of breath/],
    ["en toussant", /coughing/],
    ["tousse", /coughing/],
    ["à voix basse", /Whispering/],
    ["chuchote", /Whispering/],
    ["soupire", /sigh/],
    ["en riant", /laughing/],
    ["furieux", /Angry/],
    ["en colère", /Angry/],
    ["à part", /inner thought/]
  ])("%s donne une consigne anglaise", (label, expected) => {
    const play = playOfStates([st(label)]);
    expect(play?.direction).toMatch(expected);
  });

  it("toutes les consignes de la table sont envoyables (ASCII, sans crochets)", () => {
    for (const row of STAGE_PLAY_TABLE) {
      expect(isSendableDirection(row.direction)).toBe(true);
    }
    expect(isSendableDirection("[Cough] hoarse")).toBe(false);
    expect(isSendableDirection("voix gênée")).toBe(false);
  });

  it("un état hors table ne donne rien : voix figée", () => {
    expect(playOfStates([st("tire son épée")])).toBeUndefined();
    expect(playOfStates(undefined)).toBeUndefined();
  });

  it("deux consignes au plus", () => {
    const play = playOfStates([st("essoufflé"), st("en toussant"), st("furieux")]);
    expect(play?.direction.split(". ").length).toBe(2);
  });
});

describe("contexte", () => {
  it("le souffle reste sur la réplique suivante du même personnage, puis s'éteint", () => {
    const lines = [
      { speakerId: "a", states: [st("essoufflé")] },
      { speakerId: "b" },
      { speakerId: "a" },
      { speakerId: "a" },
      { speakerId: "b" },
      { speakerId: "a" }
    ];
    const out = directionsOf(lines, "narrator");
    expect(out[0]).toMatch(/out of breath/);
    expect(out[1]).toBeUndefined();
    expect(out[2]).toMatch(/out of breath/);
    expect(out[3]).toMatch(/out of breath/);
    expect(out[5]).toBeUndefined();
  });

  it("un rire ne dure pas ; la narration ne joue jamais", () => {
    const out = directionsOf(
      [{ speakerId: "a", states: [st("en riant")] }, { speakerId: "narrator", states: [st("furieux")] }, { speakerId: "b" }, { speakerId: "a" }],
      "narrator"
    );
    expect(out[0]).toMatch(/laughing/);
    expect(out[1]).toBeUndefined();
    expect(out[3]).toBeUndefined();
  });
});

describe("clé de cache", () => {
  const binding = { voice: "v" };
  it("une même phrase jouée autrement a une autre clé ; sans consigne, la clé d'aujourd'hui", () => {
    const plain = cacheKeyFor("qwen3", bindingForChunk(binding, { speakerId: "a" }), "Bonjour.");
    const played = cacheKeyFor("qwen3", bindingForChunk(binding, { speakerId: "a", direction: "Whispering" }), "Bonjour.");
    const other = cacheKeyFor("qwen3", bindingForChunk(binding, { speakerId: "a", direction: "Angry" }), "Bonjour.");
    expect(played).not.toBe(plain);
    expect(other).not.toBe(played);
    expect(plain).toBe(cacheKeyFor("qwen3", binding, "Bonjour."));
  });
});
