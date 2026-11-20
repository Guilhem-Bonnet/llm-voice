/**
 * Décision du 2026-11-06 : « Quand il y a des termes comme essoufflé, ce n'est pas au narrateur
 * de prononcer le mot essoufflé. » Le classement, puis ce qu'il devient dans `parseScript`, puis
 * la garde : une indication jouée se traite comme une étiquette, et rien d'autre ne peut manquer.
 */
import { describe, expect, it } from "vitest";
import { parseScript, plainTextBlocks } from "../../../../src/direction/script/parseScript.js";
import { sameWordsApartFromLabels } from "../../../../src/direction/script/scriptFidelity.js";
import { readStage } from "../../../../src/direction/script/stageDirection.js";
import { plainScriptSegments, plainTextSegments } from "../../../../src/pipeline/textSegments.js";
import { parseMarkdown } from "../../../../src/parser/MarkdownParser.js";
import { segment } from "../../../../src/parser/Segmenter.js";
import type { SegmentationPolicy } from "../../../../src/parser/types.js";

const POLICY = {
  mode: "sentence",
  lang: "fr",
  maxSentencesPerChunk: 3,
  markdown: { headings: "read", code: "skip", tables: "skip", images: "skip", frontmatter: "skip", links: "label" }
} as unknown as SegmentationPolicy;

async function parsed(text: string) {
  const blocks = await parseMarkdown(text);
  const script = parseScript(blocks);
  const scripted = segment(script.blocks, POLICY);
  const words = (list: typeof scripted): string[] => list.map((seg) => seg.spokenText ?? "");
  return {
    script,
    scripted,
    passages: scripted.map((seg) => [seg.speakerId, seg.spokenText]),
    states: scripted.map((seg) => seg.stage?.map((state) => state.label)),
    faithful: sameWordsApartFromLabels(words(segment(blocks, POLICY)), words(scripted), script.labels)
  };
}

describe("readStage : le classement", () => {
  it.each([
    ["(essoufflé)", "essoufflé"],
    ["(essoufflée)", "essoufflée"],
    ["(Essoufflé.)", "essoufflé"],
    ["(tout essoufflé)", "tout essoufflé"],
    ["(très essoufflée)", "très essoufflée"],
    ["(en riant)", "en riant"],
    ["(En pleurant.)", "en pleurant"],
    ["(bas)", "bas"],
    ["(tout bas)", "tout bas"],
    ["(à voix basse)", "à voix basse"],
    ["(à mi-voix)", "à mi-voix"],
    ["(furieux)", "furieux"],
    ["(furieuse)", "furieuse"],
    ["(souriant)", "souriant"],
    ["(doucement)", "doucement"],
    ["(avec colère)", "avec colère"],
    ["(d'une voix tremblante)", "d'une voix tremblante"],
    ["(elle murmure)", "murmure"]
  ])("manière, jamais dite : %s", (body, label) => {
    expect(readStage(body)).toEqual({ said: false, states: [{ label, kind: "manner", quote: body }] });
  });

  it.each([
    ["(il tousse)", "tousse"],
    ["(tousse)", "tousse"],
    ["(soupire)", "soupire"],
    ["(Elle soupire.)", "soupire"],
    ["(Anselme tousse.)", "tousse"],
    ["(en toussant)", "en toussant"],
    ["(rires)", "rires"]
  ])("action vocale, jamais dite, de nature son : %s", (body, label) => {
    expect(readStage(body)).toEqual({ said: false, states: [{ label, kind: "sound", quote: body }] });
  });

  it("plusieurs manières à la fois : aucune n'est dite, toutes restent", () => {
    expect(readStage("(essoufflé, en riant)")).toEqual({
      said: false,
      states: [
        { label: "essoufflé", kind: "manner", quote: "(essoufflé, en riant)" },
        { label: "en riant", kind: "manner", quote: "(essoufflé, en riant)" }
      ]
    });
    expect(readStage("(furieux et essoufflé)").said).toBe(false);
  });

  it.each([
    "(à part)",
    "(au public)",
    "(à lui-même)",
    "(il sort)",
    "(Il sort.)",
    "(Elle prend son panier.)",
    "(Scapin entre en sifflant.)",
    "(La lanterne s'éteint.)",
    "(en sortant)",
    "(en entrant)",
    "(en attendant)",
    "(en lui donnant la lettre)",
    "(proposé)",
    "(archivé)",
    "(important)",
    "(maintenant)",
    "(seul)",
    "(on tousse)",
    "(ils toussent)",
    "(elle tousse longuement devant la porte)",
    "(on entend un cri)",
    "(un long silence)"
  ])("aparté, action muette, décor ou doute : dite, sans état : %s", (body) => {
    expect(readStage(body)).toEqual({ said: true, states: [] });
  });

  it.each([
    ["(Il tousse, puis sort.)", "tousse", "sound"],
    ["(il tousse et sort)", "tousse", "sound"],
    ["(furieux, il sort)", "furieux", "manner"],
    ["(à part, en riant)", "en riant", "manner"]
  ])("mixte, dite, avec en plus un état : %s", (body, label, kind) => {
    expect(readStage(body)).toEqual({ said: true, states: [{ label, kind, quote: body }] });
  });
});

describe("parseScript : ce qui est joué n'est pas dit, et l'état reste sur la réplique", () => {
  it.each([
    ["(essoufflé) J'ai couru.", [["a", "J'ai couru."]], [["essoufflé"]]],
    ["(il tousse) Pardon.", [["a", "Pardon."]], [["tousse"]]],
    ["(bas) (en riant) Viens.", [["a", "Viens."]], [["bas", "en riant"]]],
    ["Non. (Elle soupire.) Pas encore.", [["a", "Non."], ["a", "Pas encore."]], [undefined, ["soupire"]]],
    ["Non, (bas) je reste.", [["a", "Non,"], ["a", "je reste."]], [undefined, ["bas"]]],
    ["Viens (bas) ?", [["a", "Viens ?"]], [["bas"]]],
    ["Adieu (il tousse).", [["a", "Adieu."]], [["tousse"]]],
    ["Non. Oui. (furieux)", [["a", "Non. Oui."]], [["furieux"]]],
    ["(bas) Viens. (furieux) Non.", [["a", "Viens."], ["a", "Non."]], [["bas"], ["furieux"]]]
  ])("%s", async (reply, passages, states) => {
    const read = await parsed(`@a: ${reply}\n`);
    expect(read.passages).toEqual(passages);
    expect(read.states).toEqual(states);
    expect(read.faithful).toBe(true);
  });

  it("l'état garde le texte d'origine : une future partition peut le reprendre", async () => {
    const { scripted } = await parsed("@a: (Essoufflé.) J'ai couru.\n");
    expect(scripted[0]?.stage).toEqual([{ label: "essoufflé", kind: "manner", quote: "(Essoufflé.)" }]);
  });

  it.each([
    ["(à part) Il ne se doute de rien.", [[undefined, "à part"], ["a", "Il ne se doute de rien."]]],
    ["(Elle prend son panier.) Je reviens.", [[undefined, "Elle prend son panier."], ["a", "Je reviens."]]],
    ["Adieu (il sort).", [["a", "Adieu."], [undefined, "il sort"]]],
    ["(proposé) Oui.", [[undefined, "proposé"], ["a", "Oui."]]]
  ])("narrée, inchangée : %s", async (reply, passages) => {
    const read = await parsed(`@a: ${reply}\n`);
    expect(read.passages).toEqual(passages);
    expect(read.states.every((state) => state === undefined)).toBe(true);
    expect(read.faithful).toBe(true);
  });

  it("mixte : le narrateur dit tout, et la réplique porte l'état", async () => {
    const read = await parsed("@a: (Il tousse, puis sort.) Adieu.\n");
    expect(read.passages).toEqual([[undefined, "Il tousse, puis sort."], ["a", "Adieu."]]);
    expect(read.scripted[1]?.stage).toEqual([{ label: "tousse", kind: "sound", quote: "(Il tousse, puis sort.)" }]);
    expect(read.faithful).toBe(true);
  });

  it("une phrase coupée garde ses mots : la parenthèse reste à la voix du personnage", async () => {
    const read = await parsed("@a: Je parle (bas) maintenant.\n");
    expect(read.passages).toEqual([["a", "Je parle (bas) maintenant."]]);
    expect(read.faithful).toBe(true);
  });

  it("l'italique sert aussi à l'emphase : il reste narré, même sur un mot du lexique", async () => {
    const read = await parsed("@a: *Furieux.* Il était furieux.\n");
    expect(read.passages).toEqual([[undefined, "Furieux."], ["a", "Il était furieux."]]);
    expect(read.faithful).toBe(true);
  });

  it("`NOM (bas) :` : jouée, comme dans la réplique ; `NOM (à part) :` reste narrée", async () => {
    const scene = "ROMÉO (bas) : Quelle joie.\n\nJULIETTE (à part) : Hélas.\n\nROMÉO : Oui.\n\nJULIETTE : Non.\n";
    const read = await parsed(scene);
    expect(read.passages).toEqual([["romeo", "Quelle joie."], [undefined, "à part"], ["juliette", "Hélas."], ["romeo", "Oui."], ["juliette", "Non."]]);
    expect(read.states[0]).toEqual(["bas"]);
    expect(read.faithful).toBe(true);
  });

  it("`NOM` seul : l'indication sur sa ligne va à la réplique qui suit, même au paragraphe d'après", async () => {
    const scene = "ISAURE\n\n(bas)\n\nParlez.\n\nLE COMTE\n\nNon.\n\nISAURE (furieuse)\n\nAssez.\n\nLE COMTE\n\nJe reste.\n";
    const read = await parsed(scene);
    expect(read.passages).toEqual([["isaure", "Parlez."], ["le-comte", "Non."], ["isaure", "Assez."], ["le-comte", "Je reste."]]);
    expect(read.states).toEqual([["bas"], undefined, ["furieuse"], undefined]);
    expect(read.faithful).toBe(true);
  });

  it("une ligne d'indication sans personnage courant : on ne sait pas de qui, elle reste narrée", async () => {
    const scene = "ROMÉO : Bonjour.\n\n(Il tousse.)\n\nJULIETTE : Bonjour.\n\nROMÉO : Oui.\n\nJULIETTE : Non.\n";
    const read = await parsed(scene);
    expect(read.passages[1]).toEqual([undefined, "Il tousse."]);
    expect(read.faithful).toBe(true);
  });

  it("le changement d'état coupe : deux répliques voisines n'ont pas le même état", async () => {
    const read = await parsed("@a: (bas) Viens.\n@a: Reste.\n");
    expect(read.passages).toEqual([["a", "Viens."], ["a", "Reste."]]);
    expect(read.states).toEqual([["bas"], undefined]);
  });

  it("un fichier texte suit la même règle, et la garde compare au texte brut", () => {
    const text = "@a: (essoufflé) J'ai couru.\n\n(Il sort.)\n";
    const script = parseScript(plainTextBlocks(text), { plainText: true });
    const segments = plainScriptSegments(script.blocks);
    expect(segments.map((seg) => [seg.speakerId, seg.spokenText, seg.stage?.[0]?.label])).toEqual([
      ["a", "J'ai couru.", "essoufflé"],
      [undefined, "Il sort.", undefined]
    ]);
    expect(sameWordsApartFromLabels(plainTextSegments(text).map((seg) => seg.spokenText ?? ""), segments.map((seg) => seg.spokenText ?? ""), script.labels)).toBe(true);
  });
});

describe("la garde : tous les mots de l'auteur, dans l'ordre, sans ajout, sans remplacement, sans répétition", () => {
  const guard = sameWordsApartFromLabels;
  it("une indication jouée s'efface comme une étiquette, et rien d'autre", () => {
    expect(guard(["ANSELME : (essoufflé) J'ai couru."], ["J'ai couru."], ["ANSELME :", "(essoufflé)"])).toBe(true);
  });
  it("le même mot ailleurs n'est pas une indication : il ne peut pas manquer", () => {
    expect(guard(["A : (bas) Parle bas."], ["Parle."], ["A :", "(bas)"])).toBe(false);
    expect(guard(["A : Lucien entre. A : Viens."], ["Entre. Viens."], ["A :", "A :"])).toBe(false);
    expect(guard(["LUCIEN : Oui. Lucien sort."], ["Oui. Sort."], ["LUCIEN :"])).toBe(false);
  });
  it("mot ajouté, remplacé, répété, déplacé : refusé", () => {
    expect(guard(["A : Oui."], ["Oui encore."], ["A :"])).toBe(false);
    expect(guard(["A : Oui."], ["Non."], ["A :"])).toBe(false);
    expect(guard(["A : Oui."], ["Oui oui."], ["A :"])).toBe(false);
    expect(guard(["A : Oui non."], ["Non oui."], ["A :"])).toBe(false);
  });
  it("une étiquette annoncée doit être là, et dans l'ordre du texte", () => {
    expect(guard(["Oui."], ["Oui."], ["A :"])).toBe(false);
    expect(guard(["A : Oui. B : Non."], ["Oui. Non."], ["B :", "A :"])).toBe(false);
  });
  it("une étiquette qui ressemble au début de la réplique ne provoque pas de faux refus", () => {
    expect(guard(["LE COMTE : Le roi dort."], ["Le roi dort."], ["LE COMTE :"])).toBe(true);
    expect(guard(["ALMA : Alma, viens."], ["Alma, viens."], ["ALMA :"])).toBe(true);
  });
});
