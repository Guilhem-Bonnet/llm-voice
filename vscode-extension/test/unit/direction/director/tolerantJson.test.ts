/** `extractFirstJsonObject`: what a model that was not held to a grammar may wrap around its JSON. */
import { describe, expect, it } from "vitest";

import { extractFirstJsonObject } from "../../../../src/direction/director/index.js";

describe("extractFirstJsonObject", () => {
  it("reads a bare object", () => {
    expect(extractFirstJsonObject('{"a":1,"b":{"c":[1,2]}}')).toEqual({ a: 1, b: { c: [1, 2] } });
  });

  it("finds the object after a sentence and before a remark", () => {
    expect(extractFirstJsonObject('Voici : {"a":"x"} — bonne lecture !')).toEqual({ a: "x" });
  });

  it("reads through a Markdown fence", () => {
    expect(extractFirstJsonObject('```json\n{"a": true}\n```')).toEqual({ a: true });
  });

  it("does not stop at braces, escaped quotes or backslashes inside strings", () => {
    const text = String.raw`{"a":"} { \" \\","b":"}"}`;
    expect(extractFirstJsonObject(text)).toEqual({ a: '} { " \\', b: "}" });
  });

  it("returns the first of several objects", () => {
    expect(extractFirstJsonObject('{"n":1} puis {"n":2}')).toEqual({ n: 1 });
  });

  it("skips a brace that opens nothing valid and goes on", () => {
    expect(extractFirstJsonObject('Le motif {x} puis {"a":2}')).toEqual({ a: 2 });
    expect(extractFirstJsonObject('{ "cassé": [ } {"a":3}')).toEqual({ a: 3 });
  });

  it("gives nothing for an unterminated object, an array, plain text or an empty string", () => {
    expect(extractFirstJsonObject('{"a":1')).toBeUndefined();
    expect(extractFirstJsonObject("[1,2,3]")).toBeUndefined();
    expect(extractFirstJsonObject("aucun JSON ici")).toBeUndefined();
    expect(extractFirstJsonObject("")).toBeUndefined();
  });

  it("finds an object nested in an array of the answer only as an object, never the array", () => {
    expect(extractFirstJsonObject('[{"a":1}]')).toEqual({ a: 1 });
  });
});
