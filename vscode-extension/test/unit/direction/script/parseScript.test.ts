/** ADR-018 §1 et §7 étape 2 : reconnaissance déterministe, mêmes mots, aucun faux personnage. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { tokenize } from "../../../../src/direction/controller/fidelity.js";
import { parseScript, plainTextBlocks } from "../../../../src/direction/script/parseScript.js";
import { sameWordsApartFromLabels } from "../../../../src/direction/script/scriptFidelity.js";
import { parseMarkdown } from "../../../../src/parser/MarkdownParser.js";
import { segment } from "../../../../src/parser/Segmenter.js";
import type { SegmentationPolicy, SourceBlock } from "../../../../src/parser/types.js";

const HERE = __dirname;
const ROOT = resolve(HERE, "../../../../..");
const ESSAIS = join(ROOT, "docs/essais-voix");
const SRC = resolve(HERE, "../../../../src/direction");

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
  const simple = segment(blocks, POLICY);
  return { blocks, script, scripted, simple };
}

function spoken(segments: readonly { spokenText?: string; rawText: string }[]): string {
  return segments.map((seg) => seg.spokenText ?? seg.rawText).join(" ");
}

function lineOf(segments: ReturnType<typeof segment>, needle: string) {
  return segments.find((seg) => (seg.spokenText ?? seg.rawText).includes(needle));
}

function markdownFiles(path: string): string[] {
  const stats = statSync(path);
  if (stats.isFile()) {
    return path.endsWith(".md") ? [path] : [];
  }
  return readdirSync(path).flatMap((name) => markdownFiles(join(path, name)));
}

const SCENE = "ROMÉO : Bonjour Juliette.\n\nJULIETTE : Bonjour Roméo.\n\nROMÉO : Il fait beau.\n\nJULIETTE : Oui.\n";

describe("parseScript : table des formes", () => {
  it("`NOM : réplique`, espace insécable comprise ; l'étiquette n'est pas dite ; ROMÉO, Roméo et ROMEO sont un seul rôle", async () => {
    const { script, scripted } = await parsed("ROMÉO : Bonjour.\n\nJULIETTE : Salut.\n\nROMEO : Encore.\n\nJULIETTE : Oui.\n");
    expect(script.active).toBe(true);
    expect(script.roles.map((role) => [role.roleId, role.lines])).toEqual([["romeo", 2], ["juliette", 2]]);
    expect(script.roles[0]?.name).toBe("Roméo");
    expect(spoken(scripted)).not.toMatch(/ROM|JULIETTE/);
    expect(lineOf(scripted, "Encore")?.speakerId).toBe("romeo");
  });

  it("`**NOM** :`, `**NOM :**` et `NOM. — réplique`", async () => {
    const { script, scripted } = await parsed("**ALMA** : Un.\n\n**BRUNO :** Deux.\n\nALMA. — Trois.\n\nBRUNO. – Quatre.\n");
    expect(script.roles.map((role) => role.roleId)).toEqual(["alma", "bruno"]);
    expect(lineOf(scripted, "Deux")?.speakerId).toBe("bruno");
    expect(lineOf(scripted, "Trois")?.speakerId).toBe("alma");
    expect(spoken(scripted)).toBe("Un. Deux. Trois. Quatre.");
  });

  it("plusieurs répliques dans un même paragraphe donnent plusieurs passages", async () => {
    const { scripted } = await parsed("ALMA : Un.\nBRUNO : Deux.\nALMA : Trois.\nBRUNO : Quatre.\n");
    expect(scripted.map((seg) => seg.speakerId)).toEqual(["alma", "bruno", "alma", "bruno"]);
  });

  it("`NOM` seul court sur plusieurs paragraphes, jusqu'au prochain nom, titre ou séparateur", async () => {
    const text = "ALMA\n\nPremier vers.\n\nSecond vers.\n\nBRUNO\n\nTroisième.\n\nALMA\n\nQuatrième.\n\nBRUNO\n\nCinquième.\n\n---\n\nLe rideau tombe.\n\n";
    const { scripted } = await parsed(text);
    expect(lineOf(scripted, "Second")?.speakerId).toBe("alma");
    expect(lineOf(scripted, "Troisième")?.speakerId).toBe("bruno");
    expect(lineOf(scripted, "rideau")?.speakerId).toBeUndefined();
  });

  it("ligne d'indication, `NOM (à part) :`, `(Elle soupire.)` et `*Elle sort.*` vont au narrateur, découpés en passages", async () => {
    const text = `${SCENE}\n(Il entre.)\n\nROMÉO (à part) : Quelle joie.\n\nJULIETTE : Non. (Elle soupire.) Pas encore. *Elle sort.*\n`;
    const { scripted } = await parsed(text);
    expect(lineOf(scripted, "Il entre")?.speakerId).toBeUndefined();
    expect(lineOf(scripted, "à part")?.speakerId).toBeUndefined();
    expect(lineOf(scripted, "Quelle joie")?.speakerId).toBe("romeo");
    expect(lineOf(scripted, "Non.")?.speakerId).toBe("juliette");
    expect(lineOf(scripted, "Elle soupire")?.speakerId).toBeUndefined();
    expect(lineOf(scripted, "Pas encore")?.speakerId).toBe("juliette");
    expect(lineOf(scripted, "Elle sort")?.speakerId).toBeUndefined();
  });

  it("une emphase ordinaire reste dans la voix du personnage", async () => {
    const { scripted } = await parsed(`${SCENE}\nROMÉO : Je ne dirai *jamais* cela.\n`);
    expect(lineOf(scripted, "jamais")?.speakerId).toBe("romeo");
  });

  it("titres, `ACTE I`, `SCÈNE II` et texte sans étiquette restent au narrateur", async () => {
    const { script, scripted } = await parsed(`# Titre\n\nACTE I\n\nSCÈNE II\n\nDu texte simple.\n\n${SCENE}`);
    for (const needle of ["Titre", "ACTE I", "SCÈNE II", "Du texte simple"]) {
      expect(lineOf(scripted, needle)?.speakerId).toBeUndefined();
    }
    expect(script.roles.map((role) => role.roleId)).toEqual(["romeo", "juliette"]);
  });

  it("`@nom:` : une seule occurrence suffit ; `@narrateur:` et ses alias ne créent pas de personnage", async () => {
    const { script, scripted } = await parsed("@narrateur: Il était une fois.\n@ines: Bonsoir.\n@récitant: Puis la nuit.\n");
    expect(script.roles.map((role) => role.roleId)).toEqual(["ines"]);
    expect(lineOf(scripted, "Il était")?.speakerId).toBeUndefined();
    expect(lineOf(scripted, "Bonsoir")?.speakerId).toBe("ines");
    expect(lineOf(scripted, "Puis la nuit")?.speakerId).toBeUndefined();
    expect(spoken(scripted)).not.toContain("@");
  });

  it("`% nom = voix` n'est pas lu, et déclare un nom : `Juliette : …` devient une réplique", async () => {
    const { script, scripted } = await parsed("% juliette = Camille\n\nJuliette : Bonjour.\n\nRésumé : rien à dire.\n");
    expect(script.declarations).toEqual([{ roleId: "juliette", voiceText: "Camille" }]);
    expect(lineOf(scripted, "Bonjour")?.speakerId).toBe("juliette");
    expect(lineOf(scripted, "rien à dire")?.speakerId).toBeUndefined();
    expect(spoken(scripted)).toContain("Résumé");
    expect(spoken(scripted)).not.toContain("Camille");
  });

  it("une déclaration du narrateur ne crée rien : sa voix reste celle du mode", async () => {
    const { script } = await parsed("% narrateur = estelle\n\n@ines: Bonsoir.\n");
    expect(script.declarations).toEqual([]);
  });

  it("les tirets, guillemets et le roman restent au narrateur, marqués `dialogue` pour la tranche 2", async () => {
    const { script, scripted } = await parsed("— Vous partez ? dit-il.\n\n– Oui.\n\n« Bien », dit-il.\n\n- une liste\n");
    expect(script.active).toBe(false);
    expect(script.dialogueBlocks).toBe(3);
    expect(scripted.every((seg) => seg.speakerId === undefined)).toBe(true);
  });

  it("sous le seuil : deux noms sans deux répliques chacun ne font pas une pièce", async () => {
    expect((await parsed("ALMA : Un.\n\nBRUNO : Deux.\n\nALMA : Trois.\n")).script.active).toBe(false);
    expect((await parsed("ALMA : Un.\n\nALMA : Deux.\n\nALMA : Trois.\n\nALMA : Quatre.\n")).script.active).toBe(false);
  });

  it("code, tableau, liste et citation ne sont jamais analysés", async () => {
    const text = "```\nALMA : a\nBRUNO : b\nALMA : c\nBRUNO : d\n```\n\n- ALMA : a\n- BRUNO : b\n- ALMA : c\n- BRUNO : d\n\n> ALMA : a\n>\n> BRUNO : b\n\n| ALMA : | BRUNO : |\n|---|---|\n| a | b |\n";
    expect((await parsed(text)).script.active).toBe(false);
  });

  it("les plages excluent l'étiquette", async () => {
    const { scripted } = await parsed("ALMA : Un.\n\nBRUNO : Deux.\n\nALMA : Trois.\n\nBRUNO : Quatre.\n");
    expect(scripted[1]?.sourceRange).toEqual({ startLine: 2, startColumn: 8, endLine: 2, endColumn: 13 });
  });

  it("le texte brut suit la même grammaire, ligne par ligne", () => {
    const text = "ALMA : Un.\nBRUNO : Deux.\n\nALMA : Trois.\nBRUNO : Quatre.\n";
    const script = parseScript(plainTextBlocks(text));
    expect(script.active).toBe(true);
    const scripted = segment(script.blocks, POLICY);
    expect(scripted.map((seg) => seg.speakerId)).toEqual(["alma", "bruno", "alma", "bruno"]);
    expect(scripted[3]?.sourceRange).toEqual({ startLine: 4, startColumn: 8, endLine: 4, endColumn: 15 });
  });
});

describe("parseScript : les mots ne changent pas", () => {
  const files = readdirSync(ESSAIS).filter((name) => name.endsWith(".attendu.json"));

  it("les textes annoncés sont là, chacun avec son attendu", () => {
    expect(files.map((name) => name.replace(".attendu.json", "")).sort()).toEqual([
      "06-theatre-noms-en-ligne",
      "07-theatre-noms-seuls",
      "08-balises-distribution",
      "09-roman-tirets",
      "10-roman-guillemets",
      "11-pieges",
      "12-scene-repliques-courtes",
      "theatre-demo"
    ]);
  });

  for (const name of files) {
    it(`${name} : attendu respecté, mêmes mots qu'en lecture simple, étiquettes retirées`, async () => {
      const expected = JSON.parse(readFileSync(join(ESSAIS, name), "utf8")) as {
        active: boolean;
        roles: string[];
        absent?: string[];
        narrateur?: string[];
        repliques?: Record<string, string[]>;
        declarations?: Record<string, string>;
        dialogues?: number;
      };
      const text = readFileSync(join(ESSAIS, name.replace(".attendu.json", ".md")), "utf8");
      const { script, scripted, simple } = await parsed(text);
      expect(script.active).toBe(expected.active);
      expect(script.roles.map((role) => role.roleId)).toEqual(expected.roles);
      const said = spoken(scripted);
      for (const absent of expected.absent ?? []) {
        expect(said).not.toContain(absent);
      }
      for (const needle of expected.narrateur ?? []) {
        expect(lineOf(scripted, needle), needle).toBeDefined();
        expect(lineOf(scripted, needle)?.speakerId, needle).toBeUndefined();
      }
      for (const [role, needles] of Object.entries(expected.repliques ?? {})) {
        for (const needle of needles) {
          expect(lineOf(scripted, needle)?.speakerId, needle).toBe(role);
        }
      }
      if (expected.declarations !== undefined) {
        expect(Object.fromEntries(script.declarations.map((item) => [item.roleId, item.voiceText]))).toEqual(expected.declarations);
      }
      if (expected.dialogues !== undefined) {
        expect(script.dialogueBlocks).toBe(expected.dialogues);
      }
      expect(sameWordsApartFromLabels(simple.map((seg) => seg.spokenText ?? ""), scripted.map((seg) => seg.spokenText ?? ""), script.labels)).toBe(true);
    });
  }

  it("la garde refuse un mot perdu, un mot ajouté et une étiquette inventée", () => {
    expect(sameWordsApartFromLabels(["ALMA : Bonjour à tous."], ["Bonjour à tous."], ["ALMA :"])).toBe(true);
    expect(sameWordsApartFromLabels(["ALMA : Alma, viens."], ["Alma, viens."], ["ALMA :"])).toBe(true);
    expect(sameWordsApartFromLabels(["ALMA : Bonjour à tous."], ["Bonjour tous."], ["ALMA :"])).toBe(false);
    expect(sameWordsApartFromLabels(["ALMA : Bonjour."], ["Bonjour à tous."], ["ALMA :"])).toBe(false);
    expect(sameWordsApartFromLabels(["ALMA : Bonjour."], ["Bonjour."], [])).toBe(false);
    expect(tokenize("ALMA")).toEqual(["alma"]);
  });
});

describe("parseScript : aucun faux personnage sur les vrais documents", () => {
  const corpus = [
    ...markdownFiles(join(ROOT, "docs/adr")),
    join(ROOT, "vscode-extension/CHANGELOG.md"),
    ...markdownFiles(join(ROOT, "docs/Documentation-humaine"))
  ];

  it("le corpus n'est pas vide", () => {
    expect(corpus.length).toBeGreaterThan(5);
  });

  for (const file of corpus) {
    it(file.replace(`${ROOT}/`, ""), async () => {
      const blocks: SourceBlock[] = await parseMarkdown(readFileSync(file, "utf8"));
      const script = parseScript(blocks);
      expect(script.roles).toEqual([]);
      expect(script.active).toBe(false);
    });
  }
});

describe("parseScript : pureté et coût", () => {
  it("aucun module du jeu d'acteurs n'importe `vscode`, ni ne peut lancer une lecture", () => {
    for (const file of [...markdownFiles(SRC), ...readdirSync(join(SRC, "script")).map((name) => join(SRC, "script", name)), ...readdirSync(join(SRC, "cast")).map((name) => join(SRC, "cast", name))]) {
      const code = readFileSync(file, "utf8");
      expect(code, file).not.toMatch(/from "vscode"|require\("vscode"\)/);
      expect(code, file).not.toMatch(/\.play\(|controller\.start/);
    }
  });

  it("1 Mo se traite en moins d'une seconde", () => {
    const text = "ALMA : Une réplique assez longue pour remplir le document.\n\nBRUNO : Et une autre.\n\n".repeat(13000);
    expect(text.length).toBeGreaterThan(1_000_000);
    const blocks = plainTextBlocks(text);
    const startedAt = Date.now();
    const script = parseScript(blocks);
    expect(script.active).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });
});
