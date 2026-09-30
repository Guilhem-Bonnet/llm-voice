/** ADR-015 §2 (role 3), §7 (renvois) and Test 10 (director side): window in, partition out, never blocking. */
import { describe, expect, it } from "vitest";

import type { DirectionLlmRequest, FakeCallInfo } from "../../../../src/direction/director/index.js";

import { neutralPartitionForSource } from "../../../../src/direction/controller/index.js";
import { DIRECTOR_FACT_TYPES, defaultCueId, type DirectWindowInput, type FakeDirectionLlmOptions } from "../../../../src/direction/director/index.js";
import { makeBlocks, makeRig, recordingGuard, timed } from "./support.js";

async function setup(llm: FakeDirectionLlmOptions = {}, extra: { directorTimeoutMs?: number } = {}) {
  const rig = await makeRig({ llm, ...extra });
  await rig.store.appendModelEvent(rig.document, "analyst", { type: "addRole", roleId: "anna", names: ["Anna"] });
  const blocks = makeBlocks(6);
  const input = async (over: Partial<DirectWindowInput> = {}): Promise<DirectWindowInput> => ({
    documentKey: rig.document.documentKey,
    document: rig.document,
    window: blocks.slice(1, 3),
    before: blocks.slice(0, 1),
    after: blocks.slice(3, 5),
    bible: { bible: await rig.store.effective(rig.document) },
    ...over
  });
  return { rig, blocks, input };
}

describe("StageDirector.directWindow", () => {
  it("hands the model the window with its context, then returns the controller's validated partition", async () => {
    const { rig, blocks, input } = await setup();
    const result = await rig.director.directWindow(await input());
    expect(result).toMatchObject({ directed: true, llmCalls: 1, resends: 0 });
    expect(result.partition.cues.map((cue) => cue.cueId)).toEqual([defaultCueId("seg-2"), defaultCueId("seg-3")]);
    const request = rig.llm.calls[0]?.request as unknown as { window: Array<{ id: string }>; previous: Array<{ id: string }>; following: Array<{ id: string }>; attempt: number };
    expect(request.window.map((b) => b.id)).toEqual(["seg-2", "seg-3"]);
    expect(request.previous.map((b) => b.id)).toEqual([blocks[0]?.id]);
    expect(request.following.map((b) => b.id)).toEqual(["seg-4", "seg-5"]);
    expect(request.attempt).toBe(0);
  });

  it("applies the facts of an accepted window as director events in the document scope, and only the allowed kinds", async () => {
    const facts = [
      { type: "addTrait", roleId: "anna", key: "état", value: "essoufflée" },
      { type: "setAnalysis", field: "genre", value: "détourné" },
      { type: "userEdit", target: { kind: "trait", roleId: "anna", key: "age", value: "dix ans" } },
      { type: "assignVoice", roleId: "anna", providerId: "chatterbox", voiceRef: "x" },
      "not an event"
    ];
    const { rig, input } = await setup({ direction: (_info: FakeCallInfo, request: DirectionLlmRequest) => ({ ...rig_default(request), facts }) });
    const result = await rig.director.directWindow(await input());
    expect(result.facts).toEqual({ written: 1, ignored: 4 });
    const bible = await rig.store.effective(rig.document);
    expect(bible.characters.find((r) => r.id === "anna")?.traits["état"]?.by).toBe("director");
    expect(Object.keys(bible.analysis ?? {})).toEqual([]);
    expect(bible.characters.find((r) => r.id === "anna")?.traits.age).toBeUndefined();
    expect(DIRECTOR_FACT_TYPES).not.toContain("setAnalysis");
  });

  it("sends violations back and accepts the corrected answer (at most two re-prompts)", async () => {
    const { rig, input } = await setup({
      direction: (info: FakeCallInfo, request: DirectionLlmRequest) =>
        info.index === 0 ? { cues: rig_default(request).cues.slice(0, 1) } : rig_default(request)
    });
    const result = await rig.director.directWindow(await input());
    expect(result).toMatchObject({ directed: true, llmCalls: 2, resends: 1 });
    const second = rig.llm.calls[1]?.request as unknown as { attempt: number; resend: Array<{ sourceId: string }> };
    expect(second.attempt).toBe(1);
    expect(second.resend.map((r) => r.sourceId)).toEqual(["seg-3"]);
  });

  it("falls back to the neutral partition after two re-prompts, applying none of the rejected answer's facts", async () => {
    const { rig, input, blocks } = await setup({
      direction: () => ({ cues: [], facts: [{ type: "addTrait", roleId: "anna", key: "piège", value: "x" }] })
    });
    const result = await rig.director.directWindow(await input());
    expect(result).toMatchObject({ directed: false, degradedReason: "resend-budget-exhausted", llmCalls: 3, resends: 2 });
    expect(result.partition).toEqual(neutralPartitionForSource(blocks.slice(1, 3), { documentKey: rig.document.documentKey, bibleRevision: (await rig.store.effective(rig.document)).revision }));
    expect((await rig.store.effective(rig.document)).characters[0]?.traits["piège"]).toBeUndefined();
  });

  it.each<[string, FakeDirectionLlmOptions, string]>([
    ["model unavailable", { failure: () => "provider-unavailable" }, "provider-unavailable"],
    ["timeout error", { failure: () => "timeout" }, "timeout"],
    ["egress refused", { failure: () => "egress-denied" }, "egress-denied"],
    ["unexpected error", { failure: () => new Error("boom") }, "provider-unavailable"],
    ["unparsable answer", { direction: "pas du JSON" }, "resend-budget-exhausted"]
  ])("falls back to neutral when the %s, with the reason", async (_name, llm, reason) => {
    const { rig, input } = await setup(llm);
    const result = await rig.director.directWindow(await input());
    expect(result).toMatchObject({ directed: false, degradedReason: reason });
    expect(result.partition.cues.map((cue) => cue.speakerId)).toEqual(["narrator", "narrator"]);
  });

  it("does not wait past the deadline for a model that hangs", async () => {
    const { rig, input } = await setup({ failure: () => "hang" }, { directorTimeoutMs: 40 });
    const { value, ms } = await timed(async () => rig.director.directWindow(await input()));
    expect(value).toMatchObject({ directed: false, degradedReason: "timeout", llmCalls: 1 });
    expect(ms).toBeLessThan(1000);
  });

  it("makes no model call when the gate refuses (game mode), on the first attempt as on a re-prompt", async () => {
    const { rig, input } = await setup();
    const refused = await rig.director.directWindow(await input({ gate: () => "gpu-yield" }));
    expect(refused).toMatchObject({ directed: false, degradedReason: "gpu-yield", llmCalls: 0 });
    expect(rig.llm.calls).toEqual([]);

    let asked = 0;
    const flaky = await setup({ direction: () => ({ cues: [] }) });
    const midway = await flaky.rig.director.directWindow(await flaky.input({ gate: () => (asked++ === 0 ? undefined : "gpu-yield") }));
    expect(midway).toMatchObject({ directed: false, degradedReason: "gpu-yield", llmCalls: 1 });
  });

  it("stops when cancelled", async () => {
    const { rig, input } = await setup({ latencyMs: 5000 });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const { value, ms } = await timed(async () => rig.director.directWindow(await input({ signal: controller.signal })));
    expect(value).toMatchObject({ directed: false, degradedReason: "cancelled" });
    expect(ms).toBeLessThan(1000);
  });

  it("issues no request when the guard refuses the destination, and says why", async () => {
    const { guard, fetched } = recordingGuard();
    const { rig, input } = await setup({}, {});
    const denied = await makeRig({ egress: { guard, baseUrl: "http://ollama.example.com:11434" } });
    const result = await denied.director.directWindow({ ...(await input()), documentKey: denied.document.documentKey, bible: { bible: await denied.store.effective(denied.document) } });
    expect(result).toMatchObject({ directed: false, degradedReason: "egress-denied" });
    expect(fetched).toEqual([]);
    expect(rig.llm.calls).toEqual([]);
  });
});

/** The fake's default answer, rebuilt for scripts that extend it. */
function rig_default(request: DirectionLlmRequest): { cues: Array<Record<string, unknown>> } {
  return {
    cues: request.window.map((block) => ({
      cueId: defaultCueId(block.id),
      sourceIds: [block.id],
      speakerId: "narrator",
      spokenText: block.text,
      emotion: { label: "calm", intensity: 0.4 },
      tempo: 1,
      pauseAfterMs: 200
    }))
  };
}
