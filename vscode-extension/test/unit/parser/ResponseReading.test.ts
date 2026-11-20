/**
 * Une réponse de LLM s'écoute comme une phrase dite à l'oral (GAO-r-ponses-2-l-001).
 * Table de formes réelles : chaque ligne est une réponse telle qu'un outil la dépose,
 * dans `test/fixtures/claude-stop/`, et ce qui doit s'entendre, passage par passage.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../../../src/parser/MarkdownParser.js";
import { segment } from "../../../src/parser/Segmenter.js";
import { readResponse, spokenInlineCode, spokenProse, INLINE_CODE_MAX_CHARS, INLINE_CODE_MAX_WORDS } from "../../../src/parser/ResponseReading.js";
import { plainTextSegments } from "../../../src/pipeline/textSegments.js";

function fixture(name: string): string {
  const path = resolve(__dirname, "../../fixtures/claude-stop", name);
  return (JSON.parse(readFileSync(path, "utf8")) as { last_assistant_message: string }).last_assistant_message;
}

async function spoken(text: string, readCode = false, lang = "fr"): Promise<string[]> {
  return (await readResponse(text, { readCode, lang })).segments.map((seg) => seg.spokenText ?? "");
}

describe("readResponse : table de formes réelles", () => {
  const TABLE: [string, string[]][] = [
    [
      "markup.json",
      [
        "Bilan.",
        "La file d'attente est corrigée et plus jamais bloquée.",
        "Voir le guide pour la suite.",
        "Une remarque citée.",
        "Fin du bilan."
      ]
    ],
    [
      "paths-urls.json",
      [
        "Le correctif touche tts.ts et player.js, ainsi que inbox (dossier).",
        "La doc est sur un lien, et sur un lien.",
        "Le service répond sur un lien.",
        "À noter : et/ou, km/h, TCP/IP et le 12/10/2026 restent tels quels."
      ]
    ],
    [
      "code-consecutive.json",
      [
        "Voici les deux fichiers :",
        "deux exemples de code.",
        "Puis un autre exemple :",
        "un exemple de code.",
        "C'est tout."
      ]
    ],
    [
      "code-fences.json",
      [
        "Voici le correctif pour la readiness probe :",
        "un exemple de code.",
        "Et le test associé :",
        "un exemple de code.",
        "Les deux fichiers ont été mis à jour."
      ]
    ],
    [
      "inline-code.json",
      [
        "Lance npm run test:unit, puis appelle dispose.",
        "Évite un extrait de code, et un extrait de code."
      ]
    ],
    ["table-short.json", ["Résultat :", "Moteur : Kyutai, État : prêt.", "Moteur : Piper, État : arrêté.", "Fin."]],
    [
      "table-long.json",
      [
        "Nom : A, Rôle : un.",
        "Nom : B, Rôle : deux.",
        "Nom : C, Rôle : trois.",
        "Nom : D, Rôle : quatre.",
        "Nom : E, Rôle : cinq.",
        "et 3 autres lignes."
      ]
    ],
    ["table-six.json", ["Nom : A.", "Nom : B.", "Nom : C.", "Nom : D.", "Nom : E.", "et une autre ligne."]],
    [
      "lists.json",
      [
        "Trois points :",
        "Le premier point.",
        "Le second, dans Segmenter.ts.",
        "un détail imbriqué.",
        "Le troisième est fait.",
        "Une étape.",
        "Une autre étape."
      ]
    ]
  ];

  it.each(TABLE)("%s", async (name, expected) => {
    expect(await spoken(fixture(name))).toEqual(expected);
  });

  it("aucune forme ne laisse de balisage, d'URL ni de chemin", async () => {
    for (const [name] of TABLE) {
      const text = (await spoken(fixture(name))).join(" ");
      expect(text, name).not.toMatch(/`|\*\*|__|~~|\]\(|^#|https?:|www\.|\bsrc\//m);
    }
  });
});

describe("readResponse : le code", () => {
  const TWO = "Avant.\n\n```ts\nexport const a = 1;\n```\n\nAprès.";

  it("ignoré par défaut : une annonce, et rien du contenu", async () => {
    const reading = await readResponse(TWO, { readCode: false, lang: "fr" });
    expect(reading.hasCode).toBe(true);
    expect(reading.segments.map((seg) => seg.spokenText)).toEqual(["Avant.", "un exemple de code.", "Après."]);
    expect(reading.segments[1]?.type).toBe("code");
  });

  it("lu sur demande : le langage annoncé, puis chaque ligne", async () => {
    expect(await spoken(TWO, true)).toEqual(["Avant.", "un exemple de code en TypeScript :", "export const a = 1;", "Après."]);
  });

  it("lu sur demande : une ligne sans lettre ni chiffre n'est pas dite, et sans langage l'annonce reste", async () => {
    expect(await spoken("```\nfoo();\n}\n\n```", true)).toEqual(["un exemple de code :", "foo();"]);
  });

  it("lu sur demande : chaque bloc garde son annonce, même à la suite", async () => {
    expect(await spoken("```py\na\n```\n\n```rs\nb\n```", true)).toEqual([
      "un exemple de code en Python :",
      "a",
      "un exemple de code en Rust :",
      "b"
    ]);
  });

  it("une étiquette de langage bizarre n'est pas dite", async () => {
    expect(await spoken("```{r, echo=FALSE}\nb\n```", true)).toEqual(["un exemple de code :", "b"]);
  });

  it("un séparateur ou un commentaire entre deux blocs ne coupe pas la série", async () => {
    expect(await spoken("```a\nx\n```\n\n---\n\n<!-- note -->\n\n```b\ny\n```")).toEqual(["deux exemples de code."]);
  });

  it("un bloc dans une liste ou une citation reste une annonce", async () => {
    const reading = await readResponse("- Étape :\n\n  ```sh\n  ls\n  ```\n\n> ```sh\n> pwd\n> ```", { readCode: false, lang: "fr" });
    expect(reading.hasCode).toBe(true);
    expect(reading.segments.map((seg) => seg.spokenText)).toEqual(["Étape :", "deux exemples de code."]);
  });

  it("sans bloc, la puce n'a rien à proposer", async () => {
    expect((await readResponse("Une phrase avec `du code`.", { readCode: false, lang: "fr" })).hasCode).toBe(false);
  });

  it("une clôture jamais refermée reste un bloc", async () => {
    expect(await spoken("Avant.\n\n```ts\nconst a = 1;")).toEqual(["Avant.", "un exemple de code."]);
  });

  it("anglais : les annonces suivent la langue du mode", async () => {
    expect(await spoken("```ts\na\n```\n\n| A |\n| - |\n| b |\n\nSee https://example.test.", false, "en-US")).toEqual([
      "a code example.",
      "A: b.",
      "See a link."
    ]);
    expect(await spoken("```ts\na\n```", true, "en")).toEqual(["a code example in TypeScript:", "a"]);
  });
});

describe("spokenInlineCode : le seuil d'une commande", () => {
  it("garde une commande courte et simple", () => {
    expect(spokenInlineCode("git status", "fr")).toBe("git status");
    expect(spokenInlineCode("npm run test:unit", "fr")).toBe("npm run test:unit");
    expect(spokenInlineCode("Ctrl+Alt+V", "fr")).toBe("Ctrl+Alt+V");
    expect(spokenInlineCode("x".repeat(INLINE_CODE_MAX_CHARS), "fr")).toBe("x".repeat(INLINE_CODE_MAX_CHARS));
    expect(spokenInlineCode(Array(INLINE_CODE_MAX_WORDS).fill("a").join(" "), "fr")).toBe(Array(INLINE_CODE_MAX_WORDS).fill("a").join(" "));
  });

  it("annonce ce qui dépasse le seuil ou porte des opérateurs", () => {
    expect(spokenInlineCode("x".repeat(INLINE_CODE_MAX_CHARS + 1), "fr")).toBe("un extrait de code");
    expect(spokenInlineCode(Array(INLINE_CODE_MAX_WORDS + 1).fill("a").join(" "), "fr")).toBe("un extrait de code");
    for (const code of ["a | b", "a && b", "a; b", "a > b", "$HOME", "f(x)", "{a}", "a[0]", "a = 1", "**a**", "'a'"]) {
      expect(spokenInlineCode(code, "fr"), code).toBe("un extrait de code");
    }
  });

  it("réduit un chemin, annonce une URL, retire les parenthèses vides d'un appel", () => {
    expect(spokenInlineCode("src/core/tts.ts", "fr")).toBe("tts.ts");
    expect(spokenInlineCode("cat src/core/tts.ts", "fr")).toBe("cat tts.ts");
    expect(spokenInlineCode("https://example.test/a", "fr")).toBe("un lien");
    expect(spokenInlineCode("dispose()", "fr")).toBe("dispose");
  });
});

describe("spokenProse : chemins et URL dans le texte", () => {
  it.each([
    ["src/core/tts.ts", "tts.ts"],
    ["(src/core/tts.ts),", "(tts.ts),"],
    ["./a/b.md", "b.md"],
    ["../b.md.", "b.md."],
    ["/etc/hosts", "hosts"],
    ["~/.config/app/", "app"],
    ["C:\\Users\\moi\\notes.txt", "notes.txt"],
    ["src/a.ts:12:4", "a.ts"],
    ["src/a.ts#L12", "a.ts"],
    ["src/core/utils", "utils"],
    ["ftp://example.test/a", "un lien"],
    ["A -> B", "A flèche B"],
    ["A → B", "A flèche B"],
    ["[une référence]", "une référence"],
    ["**jamais fermé", "jamais fermé"]
  ])("%s", (input, expected) => {
    expect(spokenProse(input, "fr")).toBe(expected);
  });

  it.each(["et/ou", "km/h", "TCP/IP", "N/A", "12/10/2026", "1.2/3.4", "@types/node", "tableau[0]", "2 * 3", "my_long_file.ts", "#123", "a@example.test"])(
    "%s reste tel quel",
    (input) => {
      expect(spokenProse(input, "fr")).toBe(input);
    }
  );
});

describe("readResponse : le reste de la réponse", () => {
  it("un lien sans texte devient un lien, un lien garde son texte, une adresse reste une adresse", async () => {
    expect(await spoken("[](https://example.test) puis [`tts.ts`](src/core/tts.ts#L3) et [src/a.ts](src/a.ts), a@example.test.")).toEqual([
      "un lien puis tts.ts et a.ts, a@example.test."
    ]);
  });

  it("une image dit son texte, et rien sans texte", async () => {
    expect(await spoken("![Le schéma](a.png)\n\n![](b.png)\n\nFin.")).toEqual(["Le schéma.", "Fin."]);
  });

  it("le html ne se dit pas, un type générique garde son nom", async () => {
    expect(await spoken("<details>\n<summary>Plus</summary>\n</details>\n\nUn Array<string> et<br>la suite <kbd>Tab</kbd>.")).toEqual([
      "Plus.",
      "Un Array string et la suite Tab."
    ]);
  });

  it("un en-tête de page, une note de bas de page ne se disent pas", async () => {
    expect(await spoken("---\ntitre: x\n---\n\nTexte[^1].\n\n[^1]: La note.\n\n[ref]: https://example.test")).toEqual(["Texte."]);
  });

  it("garde l'ordre et la plage de chaque passage", async () => {
    const { segments } = await readResponse("# Titre\n\nUne phrase. Une autre.\n\n- Point", { readCode: false, lang: "fr" });
    expect(segments.map((seg) => seg.type)).toEqual(["heading", "sentence", "sentence", "list"]);
    expect(segments.map((seg) => seg.sourceRange?.startLine)).toEqual([0, 2, 2, 4]);
    expect(new Set(segments.map((seg) => seg.id)).size).toBe(4);
    for (const seg of segments) {
      expect(seg.rawText).toBe(seg.spokenText);
    }
  });

  it("une réponse vide n'a rien à lire", async () => {
    expect(await readResponse("  \n", { readCode: false, lang: "fr" })).toEqual({ segments: [], hasCode: false });
  });
});

describe("les autres sources ne changent pas de mots", () => {
  const TEXT = fixture("paths-urls.json");
  const POLICY = {
    mode: "sentence",
    maxSentencesPerChunk: 1,
    lang: "fr",
    markdown: { code: "skip", tables: "read", headings: "read", frontmatter: "skip", images: "skip" }
  } as const;

  it("un document Markdown garde sa lecture", async () => {
    const said = segment(await parseMarkdown(TEXT), POLICY as never).map((seg) => seg.spokenText).join(" ");
    expect(said).toContain("code : src/core/tts.ts");
    expect(said).toContain("vscode-extension/media/player/player.js:42");
    expect(said).toContain("example.test");
    expect(said).not.toContain("un lien");
  });

  it("une sélection dit son texte tel qu'il est écrit", () => {
    expect(plainTextSegments(TEXT).map((seg) => seg.spokenText).join(" ")).toContain("`src/core/tts.ts`");
  });
});
