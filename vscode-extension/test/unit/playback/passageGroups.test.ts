/**
 * Un passage trop court se transcrit mal et coûte ses 2,28 s fixes (GAO-jeu-d-acteur-001). Des
 * phrases voisines de même voix partent ensemble, sans changer un mot, sans franchir une voix.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assignCast } from "../../../src/direction/cast/castSegments.js";
import { planReading } from "../../../src/direction/cast/synthesisPlan.js";
import { tokenize } from "../../../src/direction/controller/fidelity.js";
import { parseScript } from "../../../src/direction/script/parseScript.js";
import { parseMarkdown } from "../../../src/parser/MarkdownParser.js";
import { segment } from "../../../src/parser/Segmenter.js";
import { readResponse } from "../../../src/parser/ResponseReading.js";
import type { SegmentationPolicy } from "../../../src/parser/types.js";
import type { NarrationSegment } from "../../../src/core/narration.js";
import { buildSession } from "../../../src/playback/SessionFactory.js";
import { groupPassages, MAX_PASSAGE_CHARS, MIN_PASSAGE_CHARS } from "../../../src/playback/passageGroups.js";
import { FAITHFUL_PROFILE } from "../../../src/profiles/defaults.js";

const LONG = "Cette phrase-ci est assez longue pour tenir toute seule dans une requête de synthèse, sans aucune aide.";
const range = (line: number) => ({ startLine: line, startColumn: 0, endLine: line, endColumn: 5 });
const passage = (id: number, text: string, speakerId?: string, extra: Record<string, unknown> = {}): NarrationSegment => ({
  id: `p${id}`,
  spokenText: text,
  sourceSegmentIds: [`s${id}`],
  sourceRanges: [range(id)],
  ...(speakerId !== undefined ? { metadata: { cast: { speakerId, ...extra } } } : {})
});
const texts = (list: readonly NarrationSegment[]): string[] => list.map((seg) => seg.spokenText);
const OPTIONS = { maxSentences: 3, lang: "fr" };

describe("groupPassages", () => {
  it("des phrases courtes de même voix partent ensemble ; ranges et sources suivent", () => {
    const grouped = groupPassages([passage(0, "Tenez."), passage(1, "Voici la lettre.")], OPTIONS);
    expect(texts(grouped)).toEqual(["Tenez. Voici la lettre."]);
    expect(grouped[0]?.sourceSegmentIds).toEqual(["s0", "s1"]);
    expect(grouped[0]?.sourceRanges).toEqual([range(0), range(1)]);
  });

  it("jamais à travers un changement de personnage, même sur la même voix", () => {
    const list = [passage(0, "Oui.", "a", { voice: "v1" }), passage(1, "Non.", "b", { voice: "v2" }), passage(2, "Si.", "c", { voice: "v2" })];
    expect(texts(groupPassages(list, OPTIONS))).toEqual(["Oui.", "Non.", "Si."]);
  });

  it("jamais à travers un changement d'état", () => {
    const stage = [{ label: "bas", kind: "manner", quote: "(bas)" }];
    const list = [passage(0, "Viens.", "a", { voice: "v" }), passage(1, "Reste.", "a", { voice: "v", stage })];
    expect(texts(groupPassages(list, OPTIONS))).toEqual(["Viens.", "Reste."]);
  });

  it("un même personnage garde sa voix et son état après le regroupement", () => {
    const stage = [{ label: "bas", kind: "manner", quote: "(bas)" }];
    const list = [passage(0, "Viens.", "a", { voice: "v", stage }), passage(1, "Reste.", "a", { voice: "v", stage })];
    const grouped = groupPassages(list, OPTIONS);
    expect(texts(grouped)).toEqual(["Viens. Reste."]);
    expect(grouped[0]?.metadata?.["cast"]).toEqual({ speakerId: "a", voice: "v", stage });
  });

  it("le plafond de phrases du profil tient", () => {
    const list = ["Un.", "Deux.", "Trois.", "Quatre."].map((text, index) => passage(index, text));
    expect(texts(groupPassages(list, { maxSentences: 2, lang: "fr" }))).toEqual(["Un. Deux.", "Trois. Quatre."]);
    expect(texts(groupPassages(list, { maxSentences: 1, lang: "fr" }))).toEqual(["Un.", "Deux.", "Trois.", "Quatre."]);
  });

  it("le plafond de caractères tient", () => {
    const long = "x".repeat(MAX_PASSAGE_CHARS - 2) + ".";
    expect(texts(groupPassages([passage(0, long), passage(1, "Oui, vraiment.")], OPTIONS))).toEqual([long, "Oui, vraiment."]);
  });

  it("assez longs tous les deux : ils restent séparés", () => {
    expect(texts(groupPassages([passage(0, LONG), passage(1, LONG)], OPTIONS))).toEqual([LONG, LONG]);
  });

  it("un court après un long le rejoint : il ne reste pas seul", () => {
    expect(texts(groupPassages([passage(0, LONG), passage(1, "Tenez.")], OPTIONS))).toEqual([`${LONG} Tenez.`]);
  });

  it("un titre sans point en reçoit un : sinon il se lirait d'un seul souffle avec la phrase", () => {
    expect(texts(groupPassages([passage(0, "Bilan"), passage(1, "Le test passe.")], OPTIONS))).toEqual(["Bilan. Le test passe."]);
    expect(texts(groupPassages([passage(0, "Non,"), passage(1, "je reste.")], OPTIONS))).toEqual(["Non, je reste."]);
  });

  it("`keepApart` : ce passage reste seul", () => {
    const list = [passage(0, "Un exemple :"), passage(1, "ls -l"), passage(2, "pwd")];
    expect(texts(groupPassages(list, { ...OPTIONS, keepApart: (seg) => seg.id !== "p0" }))).toEqual(["Un exemple :", "ls -l", "pwd"]);
  });

  it("rien à regrouper : les mêmes objets, et une entrée vide reste vide", () => {
    const list = [passage(0, LONG)];
    expect(groupPassages(list, OPTIONS)[0]).toBe(list[0]);
    expect(groupPassages([], OPTIONS)).toEqual([]);
  });
});

const POLICY = {
  mode: "sentence",
  lang: "fr",
  maxSentencesPerChunk: 3,
  firstChunkSentences: 1,
  markdown: { headings: "read", code: "skip", tables: "skip", images: "skip", frontmatter: "skip", links: "label" }
} as unknown as SegmentationPolicy;

async function scene(name: string, maxSentencesPerChunk = 3) {
  const text = readFileSync(resolve(__dirname, "../../../../docs/essais-voix", name), "utf8");
  const script = parseScript(await parseMarkdown(text));
  const build = await buildSession(segment(script.blocks, { ...POLICY, maxSentencesPerChunk }), FAITHFUL_PROFILE);
  return assignCast(build.segments, {
    binding: { voice: "camille" },
    voiceOf: (speakerId: string) => `voix-${speakerId}`
  } as never);
}
const words = (list: readonly NarrationSegment[]): string[] => texts(list).flatMap((said) => tokenize(said));
const plan = (list: readonly NarrationSegment[]) => planReading(list.map((seg) => ({ chars: seg.spokenText.length, cached: false })));

describe("sur les textes d'essai", () => {
  it.each(["theatre-demo.md", "06-theatre-noms-en-ligne.md", "07-theatre-noms-seuls.md", "08-balises-distribution.md", "12-scene-repliques-courtes.md"])(
    "%s : mêmes mots dans le même ordre, voix de chaque mot inchangée, moins de requêtes ou autant",
    async (name) => {
      const before = await scene(name);
      const after = groupPassages(before, OPTIONS);
      expect(words(after)).toEqual(words(before));
      expect(after.length).toBeLessThanOrEqual(before.length);
      const voiced = (list: readonly NarrationSegment[]): string[] =>
        list.flatMap((seg) => tokenize(seg.spokenText).map((word) => `${(seg.metadata?.["cast"] as { speakerId: string }).speakerId}:${word}`));
      expect(voiced(after)).toEqual(voiced(before));
    }
  );

  it("theatre-demo.md : le plan de lecture attend moins, et la scène reste à trois personnages et un narrateur", async () => {
    const before = await scene("theatre-demo.md");
    const after = groupPassages(before, OPTIONS);
    expect(after.length).toBeLessThan(before.length);
    expect(plan(after).leadSeconds).toBeLessThan(plan(before).leadSeconds);
    expect(plan(after).synthesisSeconds).toBeLessThan(plan(before).synthesisSeconds);
    expect(after.some((seg) => seg.spokenText.includes("Il ne se doute de rien. Tenez, la voici."))).toBe(true);
    expect(after.length).toBe(15);
    expect(MIN_PASSAGE_CHARS).toBe(80);
  });

  it("une lecture à une phrase par passage (`maxSentences: 1`) reste découpée telle quelle", async () => {
    const before = await scene("theatre-demo.md", 1);
    expect(texts(groupPassages(before, { maxSentences: 1, lang: "fr" }))).toEqual(texts(before));
  });
});

describe("la lecture d'une réponse", () => {
  const reply = "## Bilan\n\nLe **correctif** touche `src/core/tts.ts`. La documentation est sur [le guide](https://example.test/guide).\n\n```ts\nconst x = 1;\n```\n\nLe test passe maintenant.";
  it("« Bilan. » ne part plus seul, et les mots ne changent pas", async () => {
    const { segments } = await readResponse(reply, { readCode: false, lang: "fr" });
    const build = await buildSession(segments, FAITHFUL_PROFILE);
    const grouped = groupPassages(build.segments, OPTIONS);
    expect(grouped.length).toBeLessThan(build.segments.length);
    expect(grouped[0]?.spokenText.startsWith("Bilan. Le correctif touche")).toBe(true);
    expect(words(grouped)).toEqual(words(build.segments));
  });
});
