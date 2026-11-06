/** The surfaces ADR-017 V9 reads. See `no-profile-word.test.ts`. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

export const ROOT = resolve(__dirname, "../../..");
export const WORD = /profil/i;

function filesUnder(dir: string, extension: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return filesUnder(full, extension);
    }
    return entry.endsWith(extension) ? [full] : [];
  });
}

/** Strings and template parts of a source file that read as a sentence. */
function sentencesOf(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const text = node.text;
      if (WORD.test(text) && /\s/.test(text.trim())) {
        // A template of HTML is many sentences: one entry per line that has the word.
        found.push(...text.split("\n").filter((line) => WORD.test(line)).map((line) => line.trim()));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

export interface ManifestShape {
  contributes: {
    commands: { title?: string }[];
    views: Record<string, { name?: string }[]>;
    viewsContainers?: Record<string, { title?: string }[]>;
    viewsWelcome?: { contents?: string }[];
    submenus?: { label?: string }[];
    configuration: { properties: Record<string, Record<string, unknown>> };
    walkthroughs?: { title?: string; description?: string; steps: Record<string, unknown>[] }[];
  };
}

function descriptionsOf(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(descriptionsOf);
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  return Object.entries(value).flatMap(([key, member]) =>
    typeof member === "string" && /description|deprecationMessage|title|label|altText/i.test(key)
      ? [member]
      : descriptionsOf(member)
  );
}

export function manifestSentences(): string[] {
  const manifest = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as ManifestShape;
  const { commands, views, viewsContainers, viewsWelcome, submenus, configuration, walkthroughs } = manifest.contributes;
  return [
    ...commands.map((entry) => entry.title ?? ""),
    ...Object.values(views).flat().map((entry) => entry.name ?? ""),
    ...Object.values(viewsContainers ?? {}).flat().map((entry) => entry.title ?? ""),
    ...(viewsWelcome ?? []).map((entry) => entry.contents ?? ""),
    ...(submenus ?? []).map((entry) => entry.label ?? ""),
    ...descriptionsOf(configuration.properties),
    ...descriptionsOf(walkthroughs ?? [])
  ].filter((text) => WORD.test(text));
}

export function currentOccurrences(): Record<string, string[]> {
  const result: Record<string, string[]> = { "package.json": manifestSentences().sort() };
  const sources = [...filesUnder(resolve(ROOT, "src"), ".ts"), ...filesUnder(resolve(ROOT, "media"), ".js")];
  for (const file of sources) {
    const sentences = sentencesOf(file);
    if (sentences.length > 0) {
      result[relative(ROOT, file).replaceAll("\\", "/")] = sentences.sort();
    }
  }
  return result;
}

