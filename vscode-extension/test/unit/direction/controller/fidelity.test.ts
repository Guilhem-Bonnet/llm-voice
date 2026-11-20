/**
 * ADR-015 test 7 (local part): fidelity of the spoken text, on the trapped
 * texts of the narrator measurement dataset (copied to
 * `fixtures/trapped-texts.jsonl`). Everything here is deterministic: no LLM.
 */
import { describe, expect, it } from "vitest";
import {
  collapseThousands,
  extractIdentifiers,
  extractNumbers,
  findInventedNumbers,
  findLexicalDifferences,
  findLostContent,
  findLostIdentifiers,
  findLostNegations,
  findLostNumbers,
  identifierParts,
  negationSites,
  numberWords
} from "../../../../src/direction/controller/fidelity.js";
import { loadTrappedTexts, prng, toOralForm } from "./helpers.js";

const TEXTS = loadTrappedTexts();

const kinds = (findings: ReadonlyArray<{ kind: string }>): string[] => findings.map((finding) => finding.kind);
const allFindings = (source: string, spoken: string) => [...findLostContent(source, spoken), ...findInventedNumbers([source], spoken)];

describe("fixtures", () => {
  it("holds the 24 trapped texts of the dataset", () => {
    expect(TEXTS).toHaveLength(24);
    expect(new Set(TEXTS.map((entry) => entry.id)).size).toBe(24);
  });
});

describe("numberWords", () => {
  it.each([
    [0, "zero"],
    [1, "un"],
    [17, "dix sept"],
    [21, "vingt et un"],
    [71, "soixante et onze"],
    [80, "quatre vingts"],
    [93, "quatre vingt treize"],
    [200, "deux cents"],
    [1000, "mille"],
    [22050, "vingt deux mille cinquante"],
    [60000, "soixante mille"],
    [999999, "neuf cent quatre vingt dix neuf mille neuf cent quatre vingt dix neuf"]
  ])("%i is also said %j", (value, words) => {
    expect(numberWords(value)).toContain(words);
  });

  it("has English forms and stops at a million", () => {
    expect(numberWords(30)).toContain("thirty");
    expect(numberWords(1024)).toContain("one thousand twenty four");
    expect(numberWords(1_000_000)).toEqual([]);
    expect(numberWords(-3)).toEqual([]);
    expect(numberWords(1.5)).toEqual([]);
  });
});

describe("numbers", () => {
  it("extracts numbers, decimals, versions and thousands groups", () => {
    expect(extractNumbers("Node 20, v1.2.3, 1,2 million, 22 050 Hz et 60000 (0 erreur).")).toEqual(
      expect.arrayContaining(["20", "1.2.3", "1,2", "22050", "60000", "0"])
    );
    expect(extractNumbers("aucun chiffre ici")).toEqual([]);
  });

  it.each([
    ["Le délai passe de 30 s à 60 s.", "Le délai passe de trente secondes à soixante secondes."],
    ["Version 3.22.4 publiée.", "Version trois point vingt-deux point quatre publiée."],
    ["Il y a 1,2 million de lignes.", "Il y a un virgule deux million de lignes."],
    ["Fréquence de 22 050 Hz.", "Fréquence de vingt-deux mille cinquante hertz."],
    ["Fréquence de 22 050 Hz.", "Fréquence de 22050 Hz."],
    ["Écoute sur 127.0.0.1:47831.", "Écoute sur 127 point 0 point 0 point 1, port 47831."],
    ["Il y a 5 tests.", "Il y a five tests."],
    ["Droits 0600 sur le fichier.", "Droits zéro six zéro zéro sur le fichier."]
  ])("keeps %j as %j", (source, spoken) => {
    expect(findLostNumbers(source, spoken)).toEqual([]);
    expect(findInventedNumbers([source], spoken)).toEqual([]);
  });

  it.each([
    ["Le délai passe de 30 s à 60 s.", "Le délai passe de trente secondes."],
    ["Version 3.22.4 publiée.", "Version trois point vingt-deux publiée."],
    ["Il y a 118 tests.", "Il y a 181 tests."],
    ["Il y a 118 tests.", "Il y a des tests."]
  ])("flags %j read as %j", (source, spoken) => {
    expect(kinds(findLostNumbers(source, spoken))).toEqual(["number-lost"]);
  });

  it("flags a digit the source does not carry, and only that", () => {
    const findings = findInventedNumbers(["Il y a 3 tests."], "Il y a 3 tests, soit 42 cas.");
    expect(kinds(findings)).toEqual(["number-invented"]);
    expect(findings[0]?.detail).toContain("42");
    expect(findInventedNumbers(["Il y a trois tests."], "Il y a 3 tests.")).toEqual([]);
    expect(findInventedNumbers(["Il y a 1 200 lignes."], "Il y a 1200 lignes.")).toEqual([]);
  });
});

describe("identifiers", () => {
  it("extracts code spans, paths, files, options, camelCase, snake_case and acronyms", () => {
    const found = extractIdentifiers(
      "Lance `npm run compile` dans src/net/EgressGuard.ts, avec --force, sans OllamaNarrator ni core_pid.\n```\nignored code fence\n```\nLe CI est vert."
    );
    expect(found).toEqual(
      expect.arrayContaining(["npm run compile", "src/net/EgressGuard.ts", "--force", "OllamaNarrator", "core_pid", "CI"])
    );
    expect(found.join(" ")).not.toContain("ignored");
  });

  it("checks letter parts only", () => {
    expect(identifierParts("parseNarration.ts")).toEqual(["parse", "narration", "ts"]);
    expect(identifierParts("SRC_SINC_BEST_QUALITY")).toEqual(["src", "sinc", "best", "quality"]);
    expect(identifierParts("v1.2")).toEqual([]);
    expect(identifierParts("0600")).toEqual([]);
  });

  it.each([
    ["Appelle `parseNarration` ici.", "Appelle parseNarration ici."],
    ["Appelle `parseNarration` ici.", "Appelle parse narration ici."],
    ["Voir `docker build -t llm-voice:0.3.0 .`", "Voir docker build tiret t llm voice zéro point trois point zéro"],
    ["Le fichier `src/net/EgressGuard.ts`.", "Le fichier S R C, net, Egress Guard, point t s."],
    ["Utilise ESLint.", "Utilise eslint."],
    ["Utilise `SQL`.", "Utilise S Q L."],
    ["Le mode `SRC_SINC_BEST_QUALITY`.", "Le mode src sinc best quality."]
  ])("keeps %j as %j", (source, spoken) => {
    expect(findLostIdentifiers(source, spoken)).toEqual([]);
  });

  it.each([
    ["Appelle `parseNarration` ici.", "Appelle la fonction ici."],
    ["Lance `npm run compile`.", "Lance npm run."],
    ["Le fichier `settings.json`.", "Le fichier de réglages."],
    ["Le CI est vert.", "L'intégration est verte."]
  ])("flags %j read as %j", (source, spoken) => {
    expect(kinds(findLostIdentifiers(source, spoken))).toEqual(["identifier-lost"]);
  });
});

describe("negations", () => {
  it("finds one site per negation, merging ne … pas", () => {
    expect(negationSites("Ne lance pas la commande. Il n'est jamais exposé.")).toHaveLength(2);
    expect(negationSites("Il y a un test.")).toHaveLength(0);
  });

  it.each([
    ["Ne fusionne pas avant que la CI soit verte.", "Ne fusionne pas avant que la CI soit verte."],
    ["Ne fusionne pas avant que la CI soit verte.", "Il ne faut jamais fusionner avant que la CI soit verte."],
    ["It never binds a TCP port.", "It does not bind any TCP port, never."],
    ["Sans Ollama, l'extension retombe sur la lecture fidèle.", "Sans Ollama, on retombe sur la lecture fidèle."],
    ["Installe seulement les dépendances.", "Installe uniquement les dépendances."]
  ])("keeps %j as %j", (source, spoken) => {
    expect(findLostNegations(source, spoken)).toEqual([]);
  });

  it.each([
    ["Ne fusionne pas avant que la CI soit verte.", "Fusionne avant que la CI soit verte."],
    ["Il n'est jamais exposé sur le réseau.", "Il est exposé sur le réseau."],
    ["Ne lance pas la commande. Ne touche jamais au fichier.", "Ne lance pas la commande. Touche au fichier."],
    ["Do not edit files under out/ by hand.", "Edit files under out by hand."]
  ])("flags %j read as %j", (source, spoken) => {
    expect(kinds(findLostNegations(source, spoken))).toEqual(["negation-lost"]);
  });
});

describe("lexical equivalence (faithful profile)", () => {
  it("accepts the spoken form and nothing else", () => {
    expect(findLexicalDifferences("Il reste 87 % de couverture en 30 s.", "Il reste quatre-vingt-sept pour cent de couverture en trente secondes.")).toEqual([]);
    expect(findLexicalDifferences("Le délai est de 60 Hz et 12 Mo.", "Le délai est de soixante hertz et douze mégaoctets.")).toEqual([]);
    expect(kinds(findLexicalDifferences("Le chat dort.", "Le chat dort profondément."))).toEqual(["lexical-add"]);
    expect(kinds(findLexicalDifferences("Le chat dort dans le salon.", "Le chat dort."))).toEqual(["lexical-drop"]);
    expect(kinds(findLexicalDifferences("Le chat dort dans le salon.", "Le chien dort dehors."))).toEqual(["lexical-drop", "lexical-add"]);
  });

  it("tolerates inflections of the same word", () => {
    expect(findLexicalDifferences("Les chats dormaient.", "Les chat dormaient.")).toEqual([]);
  });
});

describe("test 7 — trapped texts: the text read as is", () => {
  it.each(TEXTS.map((entry) => [entry.id, entry.text] as const))("%s: identical text raises nothing", (_id, text) => {
    expect(allFindings(text, text)).toEqual([]);
    expect(findLexicalDifferences(text, text)).toEqual([]);
  });
});

describe("test 7 — trapped texts: the spoken form (digits written out) is faithful", () => {
  it.each(TEXTS.map((entry) => [entry.id, entry.text] as const))("%s", (_id, text) => {
    const spoken = toOralForm(text);
    expect(allFindings(text, spoken)).toEqual([]);
  });
});

describe("test 7 — trapped texts: lost or invented content is caught", () => {
  const withNumbers = TEXTS.filter((entry) => extractNumbers(entry.text).length > 0);

  it.each(withNumbers.map((entry) => [entry.id, entry.text] as const))("%s: a number removed is lost", (_id, text) => {
    const first = extractNumbers(text)[0] ?? "";
    const spoken = collapseThousands(text).split(first).join("");
    expect(kinds(findLostNumbers(text, spoken))).toEqual(["number-lost"]);
  });

  it.each(withNumbers.map((entry) => [entry.id, entry.text] as const))("%s: a number replaced is lost and invented", (_id, text) => {
    expect(text).not.toContain("9137");
    const first = extractNumbers(text)[0] ?? "";
    const spoken = collapseThousands(text).split(first).join("9137");
    expect(kinds(findLostNumbers(text, spoken))).toEqual(["number-lost"]);
    expect(kinds(findInventedNumbers([text], spoken))).toEqual(["number-invented"]);
  });

  it.each(TEXTS.map((entry) => [entry.id, entry.text] as const))("%s: an invented figure is flagged", (_id, text) => {
    expect(kinds(findInventedNumbers([text], `${text} Soit 4242 cas.`))).toEqual(["number-invented"]);
  });

  const NEGATION_WORDS = /\b(ne|n'|pas|jamais|sans|aucune?|non|interdite?|not|never|no|uniquement|seulement|cannot|without|ni)\b/gi;
  const negated = TEXTS.filter((entry) => negationSites(entry.text).length > 0);

  it("every trapped text carries at least one negation site", () => {
    expect(negated.map((entry) => entry.id)).toEqual(TEXTS.map((entry) => entry.id));
  });

  it.each(negated.map((entry) => [entry.id, entry.text] as const))("%s: negations removed are lost", (_id, text) => {
    const spoken = text.replace(NEGATION_WORDS, "");
    expect(negationSites(spoken).length).toBeLessThan(negationSites(text).length);
    expect(kinds(findLostNegations(text, spoken))).toEqual(["negation-lost"]);
  });

  const withSpans = TEXTS.filter((entry) =>
    [...entry.text.matchAll(/`([^`\n]+)`/g)].some((match) => identifierParts(match[1] ?? "").length > 0)
  );

  it.each(withSpans.map((entry) => [entry.id, entry.text] as const))("%s: code spans removed are lost", (_id, text) => {
    const spoken = text.replace(/`[^`\n]*`/g, "");
    expect(kinds(findLostIdentifiers(text, spoken))).toEqual(["identifier-lost"]);
  });

  it("the dataset's own annotated anchors survive their own text", () => {
    for (const entry of TEXTS) {
      expect(findLostNegations(entry.text, entry.text), entry.id).toEqual([]);
    }
  });
});

describe("property: a text read as is never raises a finding (seeded)", () => {
  const WORDS = ["chat", "lecture", "fichier", "test", "voix", "réseau", "dépôt", "erreur", "branche", "ligne"];
  const NEGATIONS = ["ne jamais", "sans", "n'est pas", "aucune", "not", "never"];
  const IDENTIFIERS = ["`npm test`", "src/a/B.ts", "parseThing", "SOME_CONST", "--flag", "`x.y`", "CI", "`git push --force`"];
  const NUMBERS = ["3", "42", "1,2", "0.3.1", "22 050", "60000", "0600", "127.0.0.1", "1 234 567", "9"];

  for (const seed of [1, 7, 42, 2026, 90210]) {
    it(`seed ${seed}`, () => {
      const random = prng(seed);
      const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
      for (let round = 0; round < 60; round += 1) {
        const parts = Array.from({ length: 3 + Math.floor(random() * 12) }, () => {
          const roll = random();
          return roll < 0.4 ? pick(WORDS) : roll < 0.55 ? pick(NEGATIONS) : roll < 0.75 ? pick(IDENTIFIERS) : pick(NUMBERS);
        });
        const text = `${parts.join(" ")}.`;
        expect(allFindings(text, text), text).toEqual([]);
        expect(allFindings(text, toOralForm(text)), toOralForm(text)).toEqual([]);
      }
    });
  }
});
