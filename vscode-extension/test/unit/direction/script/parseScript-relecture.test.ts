/**
 * Relecture d'a851b70 (GAO-jeu-d-acteur-001, ADR-018 §1). Un seul invariant : mêmes mots que
 * la lecture simple, seule la voix change. Les noms et les indications ne se devinent pas :
 * dans le doute, le texte reste à la voix qu'il avait.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { plainTextSegments, plainScriptSegments } from "../../../../src/pipeline/textSegments.js";
import { parseScript, plainTextBlocks } from "../../../../src/direction/script/parseScript.js";
import { sameWordsApartFromLabels } from "../../../../src/direction/script/scriptFidelity.js";
import { parseMarkdown } from "../../../../src/parser/MarkdownParser.js";
import { segment } from "../../../../src/parser/Segmenter.js";
import type { SegmentationPolicy } from "../../../../src/parser/types.js";

const ESSAIS = resolve(__dirname, "../../../../../docs/essais-voix");

const POLICY = {
  mode: "sentence",
  lang: "fr",
  maxSentencesPerChunk: 3,
  markdown: { headings: "read", code: "skip", tables: "skip", images: "skip", frontmatter: "skip", links: "label" }
} as unknown as SegmentationPolicy;

const SCENE = "ROMÉO : Bonjour Juliette.\n\nJULIETTE : Bonjour Roméo.\n\nROMÉO : Il fait beau.\n\nJULIETTE : Oui.\n\n";

async function parsed(text: string) {
  const blocks = await parseMarkdown(text);
  const script = parseScript(blocks);
  const scripted = segment(script.blocks, POLICY);
  const simple = segment(blocks, POLICY);
  const words = (list: typeof scripted): string[] => list.map((seg) => seg.spokenText ?? "");
  return {
    script,
    passages: scripted.map((seg) => [seg.speakerId, seg.spokenText]),
    faithful: sameWordsApartFromLabels(words(simple), words(scripted), script.labels)
  };
}

describe("1. lien Markdown dans une réplique", () => {
  it.each([
    ["balise", "@a: Bonjour.\n\n@b: Voir [la doc](http://z.fr/x) maintenant.\n", "b"],
    ["capitales", `${SCENE}ROMÉO : Voir [la doc](http://z.fr/x) maintenant.\n`, "romeo"],
    ["URL à parenthèses", `${SCENE}ROMÉO : Voir [la doc](http://z.fr/(x)) maintenant.\n`, "romeo"]
  ])("%s : la réplique garde ses mots et sa voix, et le document garde sa distribution", async (_name, text, speaker) => {
    const { passages, faithful } = await parsed(text);
    expect(passages).toContainEqual([speaker, "Voir la doc maintenant."]);
    expect(faithful).toBe(true);
  });

  it("une image et du code en ligne ne sont pas des indications non plus", async () => {
    const { passages, faithful } = await parsed(`${SCENE}ROMÉO : Regarde ![le plan](a.png) puis lance \`f(x)\` ici.\n`);
    expect(passages.at(-1)?.[0]).toBe("romeo");
    expect(String(passages.at(-1)?.[1])).toContain("le plan puis lance");
    expect(faithful).toBe(true);
  });
});

describe("2. un mot en capitales n'est pas un personnage", () => {
  const roles = async (text: string): Promise<string[]> => (await parsed(text)).script.roles.map((role) => role.roleId);

  it.each(["FIN", "RIDEAU", "PROLOGUE", "ÉPILOGUE", "EPILOGUE", "FIN.", "**FIN**"])("`%s` seul, suivi d'une phrase", async (word) => {
    const { script, passages, faithful } = await parsed(`${SCENE}${word}\n\nMerci à tous d'avoir lu.\n`);
    expect(script.roles.map((role) => role.roleId)).toEqual(["romeo", "juliette"]);
    expect(passages).toContainEqual([undefined, "Merci à tous d'avoir lu."]);
    expect(passages.at(-2)?.[0]).toBeUndefined();
    expect(faithful).toBe(true);
  });

  it("`FIN` deux fois n'en fait pas un personnage", async () => {
    expect(await roles(`${SCENE}FIN\n\nUn mot.\n\nFIN\n\nDeux mots.\n`)).toEqual(["romeo", "juliette"]);
  });

  it("un nom en forme seule présent une seule fois n'est pas retenu, deux fois il l'est", async () => {
    const once = await parsed(`${SCENE}LE ROI\n\nJe reviens demain.\n`);
    expect(once.script.roles.map((role) => role.roleId)).toEqual(["romeo", "juliette"]);
    expect(once.passages).toContainEqual([undefined, "LE ROI"]);
    expect(once.passages).toContainEqual([undefined, "Je reviens demain."]);
    expect(once.faithful).toBe(true);
    expect(await roles(`${SCENE}LE ROI\n\nJe reviens.\n\nLE ROI\n\nDemain.\n`)).toEqual(["romeo", "juliette", "le-roi"]);
  });

  it("`NOM :` sans réplique sur sa ligne compte comme une forme seule", async () => {
    expect(await roles(`${SCENE}EXEMPLES :\n\nUn exemple de texte.\n`)).toEqual(["romeo", "juliette"]);
    expect(await roles(`${SCENE}AVERTISSEMENTS :\n\nUn exemple de texte.\n`)).toEqual(["romeo", "juliette"]);
  });

  it("le locuteur courant ne déborde pas sur la fin : `FIN` et ce qui suit vont au narrateur", async () => {
    const text = "ALMA\n\nUn.\n\nBRUNO\n\nDeux.\n\nALMA\n\nTrois.\n\nBRUNO\n\nQuatre.\n\nFIN\n\nMerci à tous.\n";
    const { script, passages } = await parsed(text);
    expect(script.roles.map((role) => role.roleId)).toEqual(["alma", "bruno"]);
    expect(passages.slice(-2)).toEqual([[undefined, "FIN"], [undefined, "Merci à tous."]]);
  });

  it.each(["NB", "OK", "FAQ", "PS"])("`%s :` une fois dans une pièce : la ligne reste entière, au narrateur", async (word) => {
    const { script, passages, faithful } = await parsed(`${SCENE}${word} : une précision.\n`);
    expect(script.roles.map((role) => role.roleId)).toEqual(["romeo", "juliette"]);
    expect(passages.at(-1)).toEqual([undefined, `${word} : une précision.`]);
    expect(faithful).toBe(true);
  });

  it("une réplique unique à nom bref : seuil de 4 lettres, sinon c'est un sigle", async () => {
    expect(await roles(`${SCENE}API : une précision.\n`)).toEqual(["romeo", "juliette"]);
    expect(await roles(`${SCENE}TOM : Une seule réplique.\n\nTOM : Et une autre.\n`)).toEqual(["romeo", "juliette", "tom"]);
  });

  it("des sigles répétés ne font pas une pièce", async () => {
    expect((await parsed("NB : a.\n\nNB : b.\n\nOK : c.\n\nOK : d.\n")).script.active).toBe(false);
    expect((await parsed("FAQ : a.\n\nFAQ : b.\n\nPS : c.\n\nPS : d.\n")).script.active).toBe(false);
    expect((await parsed("HTTP : a.\n\nHTTP : b.\n\nHTML : c.\n\nHTML : d.\n")).script.active).toBe(false);
  });

  it("un vrai personnage à une seule réplique reste : `LE MESSAGER : …`, `LUCIEN : …`", async () => {
    expect(await roles(`${SCENE}LE MESSAGER : Le roi est mort.\n`)).toEqual(["romeo", "juliette", "le-messager"]);
    expect(await roles(`${SCENE}LUCIEN : Vous cherchez ceci ?\n`)).toEqual(["romeo", "juliette", "lucien"]);
  });

  it("une balise reste explicite : `@fin:` est un personnage demandé", async () => {
    expect(await roles("@fin: Bonsoir.\n")).toEqual(["fin"]);
  });
});

describe("3. une parenthèse n'est une indication que si elle y ressemble", () => {
  /** À la voix du personnage, d'un seul tenant. */
  it.each([
    "Je (ne) sais pas (vraiment) quoi dire.",
    "Il travaille à l'ONU (Organisation des Nations unies) depuis dix ans.",
    "Le roi (Louis XIV) arrive enfin.",
    "Mes ami(e)s sont là.",
    "Une (re)lecture suffit.",
    "Il est parti (hier).",
    "Voyez le chapitre (page 3).",
    "Bonsoir. (2) Encore.",
    "Il le dit. (sic) Bref.",
    "Je ne sais pas (vraiment).",
    "Je crois, (vraiment) que non.",
    "Le plan est là (proposé)."
  ])("%s", async (reply) => {
    const { passages, faithful } = await parsed(`@a: ${reply}\n`);
    expect(passages.every(([speaker]) => speaker === "a"), JSON.stringify(passages)).toBe(true);
    expect(faithful).toBe(true);
    expect(passages.map(([, said]) => said).join(" ")).toBe(reply);
  });

  /** Découpé en passages, l'indication au narrateur. */
  it.each([
    ["(essoufflé) J'ai couru.", [[undefined, "essoufflé"], ["a", "J'ai couru."]]],
    ["(à part) Il ne se doute de rien.", [[undefined, "à part"], ["a", "Il ne se doute de rien."]]],
    ["Non. (Elle soupire.) Pas encore.", [["a", "Non."], [undefined, "Elle soupire."], ["a", "Pas encore."]]],
    ["Mon père, le marché n'attend pas. (Elle prend son panier.) Je reviens.", [["a", "Mon père, le marché n'attend pas."], [undefined, "Elle prend son panier."], ["a", "Je reviens."]]],
    ["Non, (bas) je reste.", [["a", "Non,"], [undefined, "bas"], ["a", "je reste."]]],
    ["(bas) (en riant) Viens.", [[undefined, "bas"], [undefined, "en riant"], ["a", "Viens."]]],
    ["Adieu (il sort).", [["a", "Adieu."], [undefined, "il sort"]]]
  ])("%s", async (reply, expected) => {
    const { passages, faithful } = await parsed(`@a: ${reply}\n`);
    expect(passages).toEqual(expected);
    expect(faithful).toBe(true);
  });

  it("les parenthèses des textes d'essai gardent leur rôle", async () => {
    for (const name of readdirSync(ESSAIS).filter((file) => /^(06|07|theatre)/.test(file) && file.endsWith(".md"))) {
      const text = readFileSync(join(ESSAIS, name), "utf8");
      const parentheses = text.match(/\([^()\n]+\)/g) ?? [];
      expect(parentheses.length, name).toBeGreaterThan(0);
      const { passages, faithful } = await parsed(text);
      expect(faithful, name).toBe(true);
      for (const parenthesis of parentheses) {
        const said = parenthesis.slice(1, -1);
        expect(passages.find(([, text]) => String(text).includes(said))?.[0], `${name} : ${said}`).toBeUndefined();
      }
    }
  });
});

describe("4. la ponctuation seule après une indication reste à la réplique", () => {
  it.each([
    ["Viens (bas) ?", [["a", "Viens ?"], [undefined, "bas"]]],
    ["Viens (bas)!", [["a", "Viens!"], [undefined, "bas"]]],
    ["Viens (bas) ? Puis reste.", [["a", "Viens ?"], [undefined, "bas"], ["a", "Puis reste."]]],
    ["Viens (bas), je t'en prie.", [["a", "Viens,"], [undefined, "bas"], ["a", "je t'en prie."]]],
    ["Viens *Elle sort.* ?", [["a", "Viens ?"], [undefined, "Elle sort."]]]
  ])("%s", async (reply, expected) => {
    const { passages, faithful } = await parsed(`@a: ${reply}\n`);
    expect(passages).toEqual(expected);
    expect(faithful).toBe(true);
  });

  it("sans réplique à qui la rendre, elle suit l'indication : elle n'est jamais perdue", async () => {
    expect((await parsed("@a: (étonné) ?\n")).passages).toEqual([[undefined, "étonné ?"]]);
    expect((await parsed("@a: Non. (bas) ?\n")).passages).toEqual([["a", "Non."], [undefined, "bas ?"]]);
  });
});

describe("5. un fichier texte dit les mots de sa lecture simple", () => {
  const TEXT = [
    "ALMA : Voir https://example.com/a?b=1 et 3.5 km.",
    "BRUNO : Le calcul 2*3*4 est juste -> voilà.",
    "",
    "ALMA : Un _mot_ et [un lien](http://z.fr/x) ici.",
    "BRUNO : Un autre `code` encore (bas) ?",
    ""
  ].join("\n");

  const voices = () => {
    const script = parseScript(plainTextBlocks(TEXT), { plainText: true });
    return { script, cast: plainScriptSegments(script.blocks), simple: plainTextSegments(TEXT) };
  };

  it("aucun rendu Markdown et aucune normalisation : le texte brut, passage par passage", () => {
    const { cast } = voices();
    const said = cast.map((seg) => seg.spokenText).join(" ");
    expect(said).toContain("Voir https://example.com/a?b=1 et 3.5 km.");
    expect(said).toContain("2*3*4");
    expect(said).toContain("->");
    expect(said).toContain("_mot_");
    expect(said).toContain("[un lien](http://z.fr/x)");
    expect(said).toContain("`code`");
    expect(cast.map((seg) => seg.speakerId).filter((id) => id !== undefined).slice(0, 2)).toEqual(["alma", "bruno"]);
    expect(cast.every((seg) => seg.rawText === seg.spokenText)).toBe(true);
  });

  it("la garde compare à ce que la lecture simple livre réellement", () => {
    const { script, cast, simple } = voices();
    expect(sameWordsApartFromLabels(simple.map((seg) => seg.spokenText ?? ""), cast.map((seg) => seg.spokenText ?? ""), script.labels)).toBe(true);
  });

  it("la garde refuse un rendu normalisé face au texte brut", () => {
    const { script, simple } = voices();
    const normalized = segment(parseScript(plainTextBlocks(TEXT)).blocks, POLICY);
    expect(sameWordsApartFromLabels(simple.map((seg) => seg.spokenText ?? ""), normalized.map((seg) => seg.spokenText ?? ""), script.labels)).toBe(false);
  });

  it("les plages restent celles du document", () => {
    const { cast } = voices();
    const first = cast.find((seg) => seg.spokenText?.startsWith("Voir"));
    expect(first?.sourceRange).toEqual({ startLine: 0, startColumn: 7, endLine: 0, endColumn: 48 });
    const last = cast.find((seg) => seg.spokenText?.startsWith("Un _mot_"));
    expect(last?.sourceRange?.startLine).toBe(3);
    expect(last?.sourceRange?.startColumn).toBe(7);
  });

  it("une indication en texte brut perd ses seules marques", () => {
    const script = parseScript(plainTextBlocks("@a: (Elle soupire.) Bon.\n\n*Elle sort.*\n"), { plainText: true });
    expect(plainScriptSegments(script.blocks).map((seg) => [seg.speakerId, seg.spokenText])).toEqual([
      [undefined, "Elle soupire."],
      ["a", "Bon."],
      [undefined, "Elle sort."]
    ]);
  });
});
