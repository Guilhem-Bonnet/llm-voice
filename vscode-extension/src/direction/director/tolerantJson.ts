/**
 * Tolerant reading of a model's answer that was not constrained by a grammar
 * (`format`): some models wrap the JSON in a sentence, a Markdown fence, or
 * add a remark after it. `extractFirstJsonObject` returns the first JSON
 * object found in the text, wherever it is; the caller validates it (Zod).
 * Pure, no I/O.
 */

/** Index just after the object that starts at `start` (a `{`), skipping braces inside strings; -1 if it never closes. */
function endOfObject(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (char === "\\") {
        index += 1;
      } else if (char === '"') {
        inString = false;
      }
    } else if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  return -1;
}

/**
 * The first JSON object of `text` (a value that parses and is a plain object,
 * not an array), or `undefined`. A `{` that does not open a valid object (a
 * brace in a sentence, a truncated object) is skipped and the search goes on
 * after it.
 */
export function extractFirstJsonObject(text: string): Record<string, unknown> | undefined {
  let from = text.indexOf("{");
  while (from !== -1) {
    const end = endOfObject(text, from);
    if (end !== -1) {
      try {
        const value: unknown = JSON.parse(text.slice(from, end));
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          return value as Record<string, unknown>;
        }
      } catch {
        // not an object: try the next brace
      }
    }
    from = text.indexOf("{", from + 1);
  }
  return undefined;
}
