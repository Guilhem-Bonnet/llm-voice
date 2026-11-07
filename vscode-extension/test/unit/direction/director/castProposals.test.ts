/** Amendement 2026-11-07 d'ADR-018 : propositions d'après le texte, citations vérifiées par le code. */
import { describe, expect, it } from "vitest";
import { nearestVoice, proposeCast, quoteProblem, verifyProposals } from "../../../../src/direction/director/castProposals.js";

const TEXT = `ISAURE

Quel vent sur les remparts ! Et cependant, seigneur, vous n'avez rien appris.

*Elle pose sa lampe sur la table.*

LE COMTE

Madame, on a trouvé sa lettre et son empreinte.

PIERRE

Bonjour.`;
const ROLES = [
  { roleId: "isaure", name: "Isaure" },
  { roleId: "le-comte", name: "Le Comte" },
  { roleId: "pierre", name: "Pierre" }
];

describe("citations", () => {
  it("une citation présente est gardée, même avec l'astérisque ou l'apostrophe typographique", () => {
    expect(quoteProblem("Elle pose sa lampe", TEXT, ROLES)).toBeUndefined();
    expect(quoteProblem("Madame", TEXT, ROLES)).toBeUndefined();
    expect(quoteProblem("vous n’avez rien appris", TEXT, ROLES)).toBeUndefined();
  });

  it("une citation inexistante est rejetée", () => {
    const check = verifyProposals({ roles: [{ roleId: "isaure", gender: { value: "woman", quote: "la jeune dame" }, age: null, character: null }] }, TEXT, ROLES);
    expect(check.proposals).toEqual([]);
    expect(check.rejected).toEqual([{ roleId: "isaure", field: "gender", reason: "quote-absent" }]);
  });

  it("le prénom seul ne fonde aucune proposition", () => {
    const check = verifyProposals(
      { roles: [{ roleId: "pierre", gender: { value: "man", quote: "PIERRE" }, age: { value: "adult", quote: "Pierre" }, character: null }] },
      TEXT,
      ROLES
    );
    expect(check.proposals).toEqual([]);
    expect(check.rejected.map((item) => item.reason)).toEqual(["name-only", "name-only"]);
  });

  it("sans indice, rien ; une valeur hors liste est rejetée", () => {
    const check = verifyProposals(
      { roles: [{ roleId: "isaure", gender: { value: "woman", quote: "Madame" }, age: { value: "ancient", quote: "Madame" }, character: null }, { roleId: "pierre", gender: null, age: null, character: null }] },
      TEXT,
      ROLES
    );
    expect(check.proposals).toEqual([{ roleId: "isaure", gender: { value: "woman", quote: "Madame" } }]);
    expect(check.rejected).toEqual([{ roleId: "isaure", field: "age", reason: "invalid-value" }]);
  });
});

describe("citation rattachée au personnage", () => {
  const REGIONS = [
    { roleId: "isaure", text: "Quel vent sur les remparts ! Et cependant, seigneur, vous n'avez rien appris." },
    { text: "Elle pose sa lampe sur la table." },
    { roleId: "le-comte", text: "Madame, on a trouvé sa lettre et son empreinte." },
    { heading: true, text: "Acte II" },
    { roleId: "pierre", text: "Bonjour." }
  ];
  it("« Madame », dit par le comte juste après elle, et l'indication qui la suit, se rattachent à Isaure", () => {
    const check = verifyProposals(
      { roles: [{ roleId: "isaure", gender: { value: "woman", quote: "Elle pose sa lampe" }, age: null, character: null }, { roleId: "le-comte", gender: { value: "man", quote: "seigneur" }, age: null, character: null }] },
      TEXT,
      ROLES,
      REGIONS
    );
    expect(check.rejected).toEqual([]);
    expect(check.proposals.map((p) => p.roleId)).toEqual(["isaure", "le-comte"]);
  });
  it("tout le tour de parole de l'autre compte, et une citation entre parenthèses est reconnue", () => {
    const regions = [
      { roleId: "isaure", text: "Et cependant, seigneur, vous n'avez rien appris." },
      { text: "Elle pose sa lampe sur la table." },
      { roleId: "isaure", text: "Parlez." },
      { roleId: "le-comte", text: "Madame, on a trouvé sa lettre et son empreinte." }
    ];
    const check = verifyProposals({ roles: [{ roleId: "le-comte", gender: { value: "man", quote: "seigneur" }, age: null, character: null }, { roleId: "isaure", gender: { value: "woman", quote: "(Elle pose sa lampe" }, age: null, character: null }] }, TEXT, ROLES, regions);
    expect(check.rejected).toEqual([]);
  });

  it("une citation présente mais sans lien avec le personnage est rejetée (quote-unrelated)", () => {
    const check = verifyProposals(
      { roles: [{ roleId: "pierre", gender: { value: "woman", quote: "Madame" }, age: null, character: null }, { roleId: "le-comte", gender: { value: "woman", quote: "Madame" }, age: null, character: null }] },
      TEXT,
      ROLES,
      REGIONS
    );
    expect(check.proposals).toEqual([]);
    expect(check.rejected.map((r) => `${r.roleId}:${r.reason}`)).toEqual(["pierre:quote-unrelated", "le-comte:quote-unrelated"]);
  });
});

describe("voix la plus proche", () => {
  const voices = [
    { id: "narr", label: "Narratrice", description: "A French woman, calm narrator" },
    { id: "f-old", label: "Femme âgée chaleureuse", description: "A French elderly woman with a warm, kind voice" },
    { id: "f-young", label: "Jeune femme claire", description: "A French young woman with a high-pitched, bright voice" },
    { id: "m-old", label: "Homme âgé rauque", description: "A French elderly man with a rough voice" },
    { id: "nodesc", label: "Sans description" }
  ];
  it("par les mots de la description, jamais la narratrice", () => {
    expect(nearestVoice({ roleId: "a", gender: { value: "woman", quote: "q" }, age: { value: "elderly", quote: "q" } }, voices, { narratorVoice: "narr" })?.id).toBe("f-old");
    expect(nearestVoice({ roleId: "a", gender: { value: "man", quote: "q" }, age: { value: "elderly", quote: "q" } }, voices, { narratorVoice: "narr" })?.id).toBe("m-old");
    expect(nearestVoice({ roleId: "a", gender: { value: "woman", quote: "q" }, age: { value: "young", quote: "q" } }, voices, { narratorVoice: "narr" })?.id).toBe("f-young");
  });
  it("à égalité, une voix libre passe devant", () => {
    const pick = nearestVoice({ roleId: "a", gender: { value: "woman", quote: "q" } }, voices, { narratorVoice: "narr", taken: new Set(["f-old"]) });
    expect(pick?.id).toBe("f-young");
  });
});

describe("appel", () => {
  it("mode jeu : aucun appel", async () => {
    let calls = 0;
    const outcome = await proposeCast(TEXT, ROLES, { model: "m", structured: async () => { calls += 1; return {}; } }, { gpuYield: () => true });
    expect(outcome.status).toBe("gpu-yield");
    expect(calls).toBe(0);
  });
  it("panne : aucune proposition", async () => {
    const outcome = await proposeCast(TEXT, ROLES, { model: "m", structured: async () => { throw new Error("down"); } }, { gpuYield: () => false });
    expect(outcome.status).toBe("failed");
  });
});
