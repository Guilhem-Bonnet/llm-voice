/** ADR-015 §2 (role 1), §4 (write rights) and Test 10 (analyst side): once per document, document scope only, never blocking. */
import { readdir } from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { USER_SCOPE, seriesScope } from "../../../../src/direction/bible/index.js";
import { Analyst, chunkBlocks, toRoleId, type FakeDirectionLlmOptions } from "../../../../src/direction/director/index.js";
import { makeBlocks, makeRig, recordingGuard, timed } from "./support.js";

const NOVEL_ANALYSIS = {
  analysis: { genre: "roman", intent: "raconter", audience: "adulte", baseTone: "mélancolique", narratorPersona: "voix grave, posée" },
  characters: [
    { id: "anna", names: ["Anna"], traits: { age: "soixante ans", timbre: "rauque" }, voiceDescriptor: "voix cassée" },
    { names: ["Père Lucien"], traits: { caractère: "bourru" } }
  ]
};

const run = async (llm: FakeDirectionLlmOptions, analystTimeoutMs?: number) => {
  const rig = await makeRig({ llm, ...(analystTimeoutMs !== undefined ? { analystTimeoutMs } : {}) });
  const outcome = await rig.analyst.analyze({ document: rig.document, source: makeBlocks(4) });
  return { rig, outcome };
};

describe("Analyst", () => {
  it("writes the analysis and the initial cast into the document bible, origin analyst", async () => {
    const { rig, outcome } = await run({ analysis: NOVEL_ANALYSIS });
    expect(outcome).toMatchObject({ status: "analyzed", calls: 1, chunks: 1, characters: 2 });
    const bible = await rig.store.effective(rig.document);
    expect(bible.analysis).toMatchObject({ genre: "roman", baseTone: "mélancolique", narratorPersona: "voix grave, posée" });
    expect(bible.characters.map((role) => role.id).sort()).toEqual(["anna", "pere-lucien"]);
    const anna = bible.characters.find((role) => role.id === "anna");
    expect(anna?.traits.timbre?.by).toBe("analyst");
    expect(anna?.voice.descriptor?.value).toBe("voix cassée");
    expect(rig.rejections).toEqual([]);
  });

  it("writes in the document scope only: no series or user journal is ever created", async () => {
    const { rig } = await run({ analysis: NOVEL_ANALYSIS });
    const files = (await readdir(path.join(rig.directory, "bibles"), { recursive: true })).map(String);
    expect(files.filter((file) => file.endsWith(".jsonl"))).toEqual([path.join("document", `${rig.document.documentKey}.jsonl`)]);
    expect((await rig.store.read(USER_SCOPE)).bible.characters).toEqual([]);
    expect((await rig.store.read(seriesScope("saga"))).bible.characters).toEqual([]);
  });

  it("analyses a document once: the second call reads the bible and makes no model call", async () => {
    const { rig } = await run({ analysis: NOVEL_ANALYSIS });
    const again = await rig.analyst.analyze({ document: rig.document, source: makeBlocks(4) });
    expect(again).toMatchObject({ status: "cached", calls: 0 });
    expect(again.analysis?.genre).toBe("roman");
    expect(rig.llm.callsOf("analyze")).toHaveLength(1);
  });

  it("shares one model call between two concurrent requests for the same document", async () => {
    const rig = await makeRig({ llm: { analysis: NOVEL_ANALYSIS, latencyMs: 30 } });
    const [a, b] = await Promise.all([
      rig.analyst.analyze({ document: rig.document, source: makeBlocks(4) }),
      rig.analyst.analyze({ document: rig.document, source: makeBlocks(4) })
    ]);
    expect(a).toBe(b);
    expect(rig.llm.callsOf("analyze")).toHaveLength(1);
  });

  it("does not persist the bible of a document that must not be persisted", async () => {
    const rig = await makeRig({ llm: { analysis: NOVEL_ANALYSIS }, persist: false });
    await rig.analyst.analyze({ document: rig.document, source: makeBlocks(4) });
    await expect(readdir(rig.directory)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await rig.store.effective(rig.document)).analysis?.genre).toBe("roman");
  });

  it.each<[string, FakeDirectionLlmOptions, number | undefined, string]>([
    ["model unavailable", { failure: () => "provider-unavailable" }, undefined, "provider-unavailable"],
    ["model too slow", { latencyMs: 400 }, 40, "timeout"],
    ["model hangs", { failure: () => "hang" }, 40, "timeout"],
    ["not JSON", { analysis: "désolé, je ne peux pas" }, undefined, "invalid-structured-output"],
    ["wrong shape", { analysis: { characters: "beaucoup" } }, undefined, "invalid-structured-output"],
    ["unexpected error", { failure: () => new Error("boom") }, undefined, "provider-unavailable"]
  ])("degrades without rejecting or writing when the %s", async (_name, llm, timeoutMs, reason) => {
    const rig = await makeRig({ llm, ...(timeoutMs !== undefined ? { analystTimeoutMs: timeoutMs } : {}) });
    const { value, ms } = await timed(() => rig.analyst.analyze({ document: rig.document, source: makeBlocks(4) }));
    expect(value).toMatchObject({ status: "degraded", degradedReason: reason });
    expect(ms).toBeLessThan(1500);
    const bible = await rig.store.effective(rig.document);
    expect(Object.keys(bible.analysis ?? {})).toEqual([]);
    expect(bible.characters).toEqual([]);
  });

  it("degrades with egress-denied, and the guard let nothing through", async () => {
    const { guard, fetched } = recordingGuard();
    const rig = await makeRig({ egress: { guard, baseUrl: "http://203.0.113.9:11434" } });
    const outcome = await rig.analyst.analyze({ document: rig.document, source: makeBlocks(4) });
    expect(outcome).toMatchObject({ status: "degraded", degradedReason: "egress-denied" });
    expect(fetched).toEqual([]);
  });

  it("stops at once when cancelled", async () => {
    const rig = await makeRig({ llm: { latencyMs: 5000 } });
    const controller = new AbortController();
    const pending = rig.analyst.analyze({ document: rig.document, source: makeBlocks(4), signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    const { value, ms } = await timed(() => pending);
    expect(value).toMatchObject({ status: "degraded", degradedReason: "cancelled" });
    expect(ms).toBeLessThan(1000);
  });

  it("keeps what a hostile answer cannot be trusted with out of the bible: bad ids, the narrator id, over-long values, locked", async () => {
    const hostile = {
      analysis: { genre: "x".repeat(500), intent: "   " },
      characters: [
        { id: "narrator", names: ["Le narrateur"] },
        { id: "../../etc/passwd", names: [] },
        { id: "___", names: [] },
        { id: "Zoé", names: ["Zoé"], traits: { voix: "y".repeat(400), "": "vide", note: "  " }, locked: true }
      ]
    };
    const { rig, outcome } = await run({ analysis: hostile });
    expect(outcome.characters).toBe(2);
    const bible = await rig.store.effective(rig.document);
    expect(bible.analysis?.genre).toHaveLength(200);
    expect(bible.analysis?.intent).toBeUndefined();
    expect(bible.characters.map((role) => role.id).sort()).toEqual(["etc-passwd", "zoe"]);
    const zoe = bible.characters.find((role) => role.id === "zoe");
    expect(Object.keys(zoe?.traits ?? {})).toEqual(["voix"]);
    expect(zoe?.traits.voix?.value).toHaveLength(200);
    expect(zoe?.traits.voix?.locked).toBeUndefined();
  });

  it("reads a text longer than the input budget chapter by chapter, the bible being the memory between chapters", async () => {
    const rig = await makeRig({
      llm: {
        analysis: (info) =>
          info.index === 0
            ? { analysis: { genre: "roman" }, characters: [{ id: "anna", names: ["Anna"] }] }
            : { characters: [{ id: "marc", names: ["Marc"] }] }
      }
    });
    const analyst = new Analyst({ llm: rig.llm, store: rig.store, maxInputChars: 130, maxChunks: 3 });
    const outcome = await analyst.analyze({ document: rig.document, source: makeBlocks(6) });
    const calls = rig.llm.callsOf("analyze");
    expect(outcome.chunks).toBe(calls.length);
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.length).toBeLessThanOrEqual(3);
    const second = calls[1]?.request as unknown as { chunkIndex: number; chunkCount: number; bible: { characters: Array<{ id: string }> } };
    expect(second.chunkIndex).toBe(1);
    expect(second.chunkCount).toBe(calls.length);
    expect(second.bible.characters.map((role) => role.id)).toContain("anna");
    expect((await rig.store.effective(rig.document)).characters.map((role) => role.id).sort()).toEqual(["anna", "marc"]);
  });

  it("makes no call for an empty document", async () => {
    const rig = await makeRig();
    const outcome = await rig.analyst.analyze({ document: rig.document, source: [{ id: "seg-1", rawText: "   " }] });
    expect(outcome).toMatchObject({ status: "analyzed", calls: 0 });
    expect(rig.llm.calls).toEqual([]);
  });
});

describe("toRoleId and chunkBlocks", () => {
  it("slugifies names and refuses the narrator id", () => {
    expect(toRoleId("Anna Karénine")).toBe("anna-karenine");
    expect(toRoleId("narrator")).toBeUndefined();
    expect(toRoleId("Narrator")).toBeUndefined();
    expect(toRoleId("???")).toBeUndefined();
  });

  it("cuts on block boundaries, truncates an oversized block, and caps the number of chunks", () => {
    const blocks = [
      { id: "a", text: "x".repeat(10) },
      { id: "b", text: "y".repeat(10) },
      { id: "c", text: "z".repeat(50) },
      { id: "d", text: "w".repeat(5) }
    ];
    const chunks = chunkBlocks(blocks, 25, 10);
    expect(chunks.map((chunk) => chunk.map((b) => b.id))).toEqual([["a", "b"], ["c"], ["d"]]);
    expect(chunks[1]?.[0]?.text).toHaveLength(25);
    expect(chunkBlocks(blocks, 25, 2)).toHaveLength(2);
  });
});
