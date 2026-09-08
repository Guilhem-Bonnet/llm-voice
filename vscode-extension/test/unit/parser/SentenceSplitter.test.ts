import { describe, expect, it } from "vitest";
import { splitSentences } from "../../../src/parser/SentenceSplitter.js";

/** Every returned sentence must be an exact substring of the input at its own offsets. */
function expectOffsetsAreExact(text: string, sentences: ReturnType<typeof splitSentences>): void {
  for (const sentence of sentences) {
    expect(text.slice(sentence.start, sentence.end)).toBe(sentence.text);
  }
}

describe("splitSentences — basic behaviour", () => {
  it("splits a paragraph into individual sentences", () => {
    const text = "Bonjour. Comment vas-tu ? Très bien !";
    const result = splitSentences(text, "fr");
    expect(result.map((sentence) => sentence.text)).toEqual(["Bonjour.", "Comment vas-tu ?", "Très bien !"]);
    expectOffsetsAreExact(text, result);
  });

  it("returns a single sentence unchanged when there is no terminator", () => {
    const text = "Pas de ponctuation finale";
    expect(splitSentences(text, "fr").map((sentence) => sentence.text)).toEqual(["Pas de ponctuation finale"]);
  });

  it("returns an empty array for empty input", () => {
    expect(splitSentences("", "fr")).toEqual([]);
  });

  it("returns an empty array for whitespace-only input", () => {
    expect(splitSentences("   \n  ", "fr")).toEqual([]);
  });

  it("merges a short, unterminated trailing fragment into the previous sentence", () => {
    const text = "Premiere phrase complete. et un reste";
    const result = splitSentences(text, "fr");
    expect(result.map((sentence) => sentence.text)).toEqual(["Premiere phrase complete. et un reste"]);
  });

  it("does not merge an unterminated trailing fragment that is long enough on its own", () => {
    const text = "Premiere phrase. Un reste sans point final mais suffisamment long";
    const result = splitSentences(text, "fr");
    expect(result.map((sentence) => sentence.text)).toEqual([
      "Premiere phrase.",
      "Un reste sans point final mais suffisamment long"
    ]);
  });

  it("keeps short but fully punctuated sentences separate (no length-based merge)", () => {
    const text = "Oui. Non. Peut-être.";
    const result = splitSentences(text, "fr");
    expect(result.map((sentence) => sentence.text)).toEqual(["Oui.", "Non.", "Peut-être."]);
  });
});

describe("splitSentences — pathological FR/EN cases (ADR-006, CdC §33)", () => {
  it("does not split on 'M.' followed by a proper noun (French title abbreviation)", () => {
    const text = "M. Dupont a expliqué la procédure à l'équipe, avant de partir en congé, etc.";
    const result = splitSentences(text, "fr");
    expect(result).toHaveLength(1);
    expect(result[0]?.text).toBe(text);
  });

  it("does not split on 'etc.' even when a soft line break follows", () => {
    const text =
      "M. Dupont a expliqué la procédure à l'équipe, avant de partir en congé, etc.\n" +
      "Le déploiement utilise `kubectl apply -f deployment.yaml` sur le cluster.";
    const result = splitSentences(text, "fr");
    expect(result).toHaveLength(1);
  });

  it("does not treat the dot inside inline code as a sentence terminator", () => {
    const text = "Le déploiement utilise `kubectl apply -f deployment.yaml` sur le cluster.";
    const result = splitSentences(text, "fr");
    expect(result).toHaveLength(1);
    expect(result[0]?.text).toBe(text);
  });

  it("does not treat the dots inside a bare URL as sentence terminators", () => {
    const text = "Voir la doc complète sur https://kubernetes.io/fr/docs/home/ pour plus de détails.";
    const result = splitSentences(text, "fr");
    expect(result).toHaveLength(1);
    expect(result[0]?.text).toBe(text);
    expectOffsetsAreExact(text, result);
  });

  it("does not split on abbreviations ('M.', 'Mme.') followed by a lowercase continuation", () => {
    const text =
      "Voir la doc complète sur https://kubernetes.io/fr/docs/home/ pour plus de\n" +
      "détails, y compris les cas comme M. et Mme. qui ne terminent pas une phrase.";
    const result = splitSentences(text, "fr");
    expect(result).toHaveLength(1);
  });

  it("does not treat a decimal number's dot as a sentence terminator", () => {
    const text = "Le pi vaut environ 3.14 et le nombre d'or 1.618. Fin.";
    const result = splitSentences(text, "fr");
    expect(result.map((sentence) => sentence.text)).toEqual(["Le pi vaut environ 3.14 et le nombre d'or 1.618.", "Fin."]);
    expectOffsetsAreExact(text, result);
  });

  it("does not split on a run of abbreviations followed by commas inside parentheses", () => {
    const text =
      "Un paragraphe mélangeant abréviations (ex. M., Mme, etc., cf., vs.) et une\n" +
      "URL nue http://localhost:11434/api/chat directement dans le texte, suivi\n" +
      "d'une phrase normale qui se termine correctement.";
    const result = splitSentences(text, "fr");
    expect(result).toHaveLength(1);
  });

  it("does not split on the English abbreviation 'e.g.' (word-boundary aware)", () => {
    const text = "This works well, e.g. for most inputs, but not for edge cases.";
    const result = splitSentences(text, "en");
    expect(result).toHaveLength(1);
  });

  it("still splits normally right after an abbreviation-free sentence ending in a capital letter", () => {
    const text = "Premiere phrase. Deuxieme phrase avec un Nom Propre.";
    const result = splitSentences(text, "fr");
    expect(result.map((sentence) => sentence.text)).toEqual(["Premiere phrase.", "Deuxieme phrase avec un Nom Propre."]);
  });
});
