/**
 * ADR-015 §8 and Tests 8, 10, 12, 14: anticipation, cache, fallbacks (outage,
 * lateness, game mode), local-first. Fake model only; real timers, small budgets.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { neutralPartitionForSource } from "../../../../src/direction/controller/index.js";
import {
  createGpuYieldProbe,
  defaultCueId,
  gpuYieldFlagPath,
  type DirectionLlmRequest,
  type FakeCallInfo,
  type FakeDirectionLlmOptions
} from "../../../../src/direction/director/index.js";
import { makeBlocks, makeRig, recordingGuard, sleep, timed, type Rig } from "./support.js";

const windowsAsked = (rig: Rig): string[] =>
  rig.llm.callsOf("direct").map((call) => (call.request as DirectionLlmRequest).window[0]?.id ?? "");

const neutralTexts = (cues: readonly { spokenText: string; speakerId: string }[]) => cues.map((c) => `${c.speakerId}:${c.spokenText}`);

const created: string[] = [];
afterEach(() => {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});
function runtimeDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "llm-voice-runtime-"));
  created.push(dir);
  mkdirSync(path.join(dir, "gpu-yield"));
  return dir;
}

describe("direction pipeline: nominal reading", () => {
  it("does nothing until a segment is asked for", async () => {
    const rig = await makeRig();
    const session = rig.open();
    await session.idle();
    expect(rig.llm.calls).toEqual([]);
    expect(rig.trace).toEqual([]);
  });

  it("returns the directed cues of a window, then the rest of the window without another call", async () => {
    const rig = await makeRig({ pipeline: { lookahead: 0 } });
    const session = rig.open({ source: makeBlocks(8) });
    const first = await session.cuesFor("seg-1");
    expect(first).toMatchObject({ directed: true, source: "llm" });
    expect(first.cues.map((c) => c.cueId)).toEqual([defaultCueId("seg-1")]);
    expect(first.cues[0]?.emotion?.label).toBe("calm");
    expect((await session.cuesFor("seg-4")).directed).toBe(true);
    expect(rig.llm.callsOf("direct")).toHaveLength(1);
    expect((await session.cuesFor("inconnu")).cues).toEqual([]);
    expect(session.stats()).toMatchObject({ windowsFromModel: 1, windowsNeutral: 0 });
  });

  it("skips blank segments: they have no cue and are not sent to the model", async () => {
    const rig = await makeRig({ pipeline: { lookahead: 0 } });
    const source = [...makeBlocks(2), { id: "blank", rawText: "  " }, ...makeBlocks(4).slice(2)];
    const session = rig.open({ source });
    expect((await session.cuesFor("blank")).cues).toEqual([]);
    await session.cuesFor("seg-1");
    const request = rig.llm.calls.find((c) => c.kind === "direct")?.request as DirectionLlmRequest;
    expect(request.window.map((b) => b.id)).toEqual(["seg-1", "seg-2", "seg-3", "seg-4"]);
  });

  it("hands a cue that covers several segments out once, with its first segment", async () => {
    const rig = await makeRig({
      pipeline: { lookahead: 0, windowSize: 2 },
      llm: {
        direction: (_i: FakeCallInfo, r: DirectionLlmRequest) => ({
          cues: [{ cueId: "both", sourceIds: r.window.map((b) => b.id), speakerId: "narrator", spokenText: r.window.map((b) => b.text).join(" ") }]
        })
      }
    });
    const session = rig.open({ source: makeBlocks(4) });
    const one = await session.cuesFor("seg-1");
    const two = await session.cuesFor("seg-2");
    expect(one.cues.map((c) => c.cueId)).toEqual(["both"]);
    expect(two.cues).toEqual([]);
    expect(two.directed).toBe(true);
  });

  it("reads a segment neutrally when its multi-segment cue arrived after the segment was read late", async () => {
    const rig = await makeRig({
      pipeline: { lookahead: 0, windowSize: 2, firstSoundBudgetMs: 20, steadyBudgetMs: 20 },
      llm: {
        latencyMs: (i: FakeCallInfo) => (i.kind === "direct" ? 120 : 0),
        direction: (_i: FakeCallInfo, r: DirectionLlmRequest) => ({
          cues: [{ cueId: "both", sourceIds: r.window.map((b) => b.id), speakerId: "narrator", spokenText: r.window.map((b) => b.text).join(" ") }]
        })
      }
    });
    const session = rig.open({ source: makeBlocks(4) });
    const one = await session.cuesFor("seg-1");
    expect(one).toMatchObject({ directed: false, degradedReason: "late" });
    await session.idle();
    const two = await session.cuesFor("seg-2");
    expect(two.directed).toBe(false);
    expect(two.cues.map((c) => c.spokenText)).toEqual([makeBlocks(2)[1]?.rawText]);
  });
});

describe("Test 14 (cache et anticipation)", () => {
  it("keeps N segments ahead of the last one asked for, one window at a time, and no further", async () => {
    const rig = await makeRig({ pipeline: { windowSize: 2, lookahead: 4 } });
    const session = rig.open({ source: makeBlocks(12) });
    await session.cuesFor("seg-2");
    await session.idle();
    expect(windowsAsked(rig)).toEqual(["seg-1", "seg-3", "seg-5"]);
    await session.cuesFor("seg-6");
    await session.idle();
    expect(windowsAsked(rig)).toEqual(["seg-1", "seg-3", "seg-5", "seg-7", "seg-9"]);
    const at = rig.llm.callsOf("direct").map((c) => c.at);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it("directs one window at a time (never two model calls in flight)", async () => {
    let inFlight = 0;
    let peak = 0;
    const rig = await makeRig({
      pipeline: { windowSize: 1, lookahead: 5 },
      llm: {
        latencyMs: 15,
        direction: async (_i: FakeCallInfo, r: DirectionLlmRequest) => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await sleep(10);
          inFlight -= 1;
          return { cues: r.window.map((b) => ({ cueId: defaultCueId(b.id), sourceIds: [b.id], speakerId: "narrator", spokenText: b.text })) };
        }
      }
    });
    const session = rig.open({ source: makeBlocks(8) });
    await session.cuesFor("seg-1");
    await session.idle();
    expect(rig.llm.callsOf("direct").length).toBeGreaterThan(3);
    expect(peak).toBe(1);
  });

  const factsScript = {
    analysis: { analysis: { genre: "roman" }, characters: [{ id: "anna", names: ["Anna"], traits: { age: "vieille" } }] },
    direction: (info: FakeCallInfo, r: DirectionLlmRequest) => ({
      cues: r.window.map((b) => ({ cueId: defaultCueId(b.id), sourceIds: [b.id], speakerId: "anna", spokenText: b.text, emotion: { label: "tendue", intensity: 0.7 } })),
      facts: [{ type: "addTrait", roleId: "anna", key: `fait-${info.index}`, value: "établi pendant la lecture" }]
    })
  } satisfies FakeDirectionLlmOptions;

  async function readAll(rig: Rig, count: number, edit: Record<number, string> = {}) {
    const session = rig.open({ source: makeBlocks(count, edit) });
    await session.cuesFor("seg-1");
    await session.idle();
    return session;
  }

  it("re-reads a document without any model call, although the director enriched the bible while reading", async () => {
    const first = await makeRig({ llm: factsScript, pipeline: { windowSize: 2, lookahead: 12 } });
    const s1 = await readAll(first, 8);
    expect(s1.stats()).toMatchObject({ windowsFromModel: 4, windowsFromCache: 0 });
    const revision = (await first.store.effective(first.document)).revision;
    expect(revision).toBeGreaterThan(3);

    const second = await makeRig({ llm: factsScript, directory: first.directory, pipeline: { windowSize: 2, lookahead: 12 } });
    const s2 = await readAll(second, 8);
    expect(second.llm.calls).toEqual([]);
    expect(s2.stats()).toMatchObject({ windowsFromModel: 0, windowsFromCache: 4, llmCalls: 0 });
    const cues = await s2.cuesFor("seg-3");
    expect(cues).toMatchObject({ directed: true, source: "cache" });
    expect(cues.cues[0]?.speakerId).toBe("anna");
  });

  it("recomputes only the windows a change touches: its own and the neighbours whose context includes it", async () => {
    const options = { llm: factsScript, pipeline: { windowSize: 2, contextBefore: 1, contextAfter: 1, lookahead: 12 } };
    const first = await makeRig(options);
    await readAll(first, 12);
    const second = await makeRig({ ...options, directory: first.directory });
    await readAll(second, 12, { 5: "Le paragraphe modifié change de sens ici." });
    expect(windowsAsked(second)).toEqual(["seg-5", "seg-7"]);
  });

  it("recomputes everything when the user edits a bible fact, and reuses the cache once the edit is in", async () => {
    const first = await makeRig({ llm: factsScript, pipeline: { windowSize: 2, lookahead: 12 } });
    await readAll(first, 6);
    await first.store.appendUserEvent(first.document, { type: "userEdit", target: { kind: "trait", roleId: "anna", key: "age", value: "très jeune" } });
    const second = await makeRig({ llm: factsScript, directory: first.directory, pipeline: { windowSize: 2, lookahead: 12 } });
    await readAll(second, 6);
    expect(second.llm.callsOf("direct")).toHaveLength(3);
    const third = await makeRig({ llm: factsScript, directory: first.directory, pipeline: { windowSize: 2, lookahead: 12 } });
    await readAll(third, 6);
    expect(third.llm.calls).toEqual([]);
  });

  it("never caches a neutral fallback: an outage does not freeze a flat reading", async () => {
    const down = await makeRig({ llm: { failure: () => "provider-unavailable" }, pipeline: { windowSize: 2, lookahead: 4 } });
    await readAll(down, 4);
    const healthy = await makeRig({ directory: down.directory, pipeline: { windowSize: 2, lookahead: 4 } });
    const session = await readAll(healthy, 4);
    expect(session.stats()).toMatchObject({ windowsFromModel: 2, windowsNeutral: 0 });
    expect((await session.cuesFor("seg-1")).directed).toBe(true);
  });

  it("keeps a non-persisted document off the disk and still reuses its windows within the process", async () => {
    const first = await makeRig({ persist: false, pipeline: { windowSize: 2, lookahead: 4 } });
    await readAll(first, 4);
    await expect(readdir(path.join(first.directory, "partitions"))).rejects.toMatchObject({ code: "ENOENT" });
    const again = first.open({ source: makeBlocks(4) });
    await again.cuesFor("seg-1");
    await again.idle();
    expect(first.llm.callsOf("direct")).toHaveLength(2);
    expect(again.stats()).toMatchObject({ windowsFromCache: 2 });
  });
});

describe("Test 10 et 11 (repli sans blocage)", () => {
  it("reads neutrally, instantly and with the neutral partition's exact cues when the model is unavailable", async () => {
    const rig = await makeRig({ llm: { failure: () => "provider-unavailable" }, pipeline: { windowSize: 4, lookahead: 0 } });
    const source = makeBlocks(4);
    const session = rig.open({ source });
    const { value, ms } = await timed(() => session.cuesFor("seg-2"));
    const neutral = neutralPartitionForSource(source, { documentKey: rig.document.documentKey, bibleRevision: 0 }).cues;
    expect(value).toMatchObject({ directed: false, source: "neutral", degradedReason: "provider-unavailable" });
    expect(value.cues).toEqual([neutral[1]]);
    expect(ms).toBeLessThan(500);
  });

  it("gives up on a model that hangs after the wait budget, reads late, and does not wait again in that window", async () => {
    const rig = await makeRig({
      llm: { failure: (i: FakeCallInfo) => (i.kind === "direct" ? "hang" : undefined) },
      pipeline: { windowSize: 4, lookahead: 0, firstSoundBudgetMs: 60, steadyBudgetMs: 60 },
      directorTimeoutMs: 5000
    });
    const session = rig.open({ source: makeBlocks(4) });
    const a = await timed(() => session.cuesFor("seg-1"));
    const b = await timed(() => session.cuesFor("seg-2"));
    expect(a.value).toMatchObject({ directed: false, degradedReason: "late" });
    expect(a.ms).toBeGreaterThanOrEqual(50);
    expect(a.ms).toBeLessThan(600);
    expect(b.value.degradedReason).toBe("late");
    expect(b.ms).toBeLessThan(40);
    expect(session.stats().lateSegments).toBe(2);
    expect(rig.trace.filter((e) => e.type === "late")).toHaveLength(2);
    session.dispose();
    await session.idle();
    expect(neutralTexts(a.value.cues)).toEqual([`narrator:${makeBlocks(1)[0]?.rawText}`]);
  });

  it("uses the late window's directed cues for the segments asked for once it has finished", async () => {
    const rig = await makeRig({ llm: { latencyMs: (i: FakeCallInfo) => (i.kind === "direct" ? 150 : 0) }, pipeline: { windowSize: 4, lookahead: 0, firstSoundBudgetMs: 20, steadyBudgetMs: 20 } });
    const session = rig.open({ source: makeBlocks(4) });
    expect((await session.cuesFor("seg-1")).degradedReason).toBe("late");
    await session.idle();
    expect(await session.cuesFor("seg-2")).toMatchObject({ directed: true, source: "llm" });
  });

  it("falls back after two re-prompts on an answer that is not the partition format", async () => {
    const rig = await makeRig({ llm: { direction: "pas du JSON" }, pipeline: { windowSize: 4, lookahead: 0 } });
    const session = rig.open({ source: makeBlocks(4) });
    const seg = await session.cuesFor("seg-1");
    expect(seg).toMatchObject({ directed: false, degradedReason: "resend-budget-exhausted" });
    expect(rig.llm.callsOf("direct")).toHaveLength(3);
  });

  it("suspends direction for the session after three model failures in a row: instant and no more calls", async () => {
    const rig = await makeRig({ llm: { failure: (i: FakeCallInfo) => (i.kind === "direct" ? "provider-unavailable" : undefined) }, pipeline: { windowSize: 2, lookahead: 8 } });
    const session = rig.open({ source: makeBlocks(16) });
    await session.cuesFor("seg-1");
    await session.idle();
    expect(rig.llm.callsOf("direct")).toHaveLength(3);
    expect(session.stats().suspended).toBe("provider-unavailable");
    const { value, ms } = await timed(() => session.cuesFor("seg-16"));
    await session.idle();
    expect(value.directed).toBe(false);
    expect(ms).toBeLessThan(200);
    expect(rig.llm.callsOf("direct")).toHaveLength(3);
    expect(rig.trace.filter((e) => e.type === "suspended")).toHaveLength(1);
  });

  it("stops at once when disposed and answers neutrally afterwards", async () => {
    const rig = await makeRig({ llm: { latencyMs: 5000 }, pipeline: { firstSoundBudgetMs: 5000 } });
    const session = rig.open({ source: makeBlocks(4) });
    const pending = session.cuesFor("seg-1");
    setTimeout(() => session.dispose(), 20);
    const { value, ms } = await timed(() => pending);
    expect(value.directed).toBe(false);
    expect(ms).toBeLessThan(1500);
    expect(await session.cuesFor("seg-2")).toMatchObject({ directed: false, degradedReason: "cancelled" });
  });

  it("stops waiting when the caller's signal aborts", async () => {
    const rig = await makeRig({ llm: { latencyMs: 5000 }, pipeline: { firstSoundBudgetMs: 5000 } });
    const session = rig.open({ source: makeBlocks(4) });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const { value, ms } = await timed(() => session.cuesFor("seg-1", controller.signal));
    expect(value).toMatchObject({ directed: false, degradedReason: "cancelled" });
    expect(ms).toBeLessThan(1000);
  });
});

describe("Test 14 (mode jeu)", () => {
  it("makes no model call and reads neutrally at once while the flag is present, whatever the model's latency", async () => {
    const dir = runtimeDir();
    writeFileSync(gpuYieldFlagPath(dir), "");
    const rig = await makeRig({ gpuYield: createGpuYieldProbe({ runtimeDir: dir }), llm: { latencyMs: 5000 } });
    const session = rig.open({ source: makeBlocks(8) });
    const { value, ms } = await timed(() => session.cuesFor("seg-1"));
    await session.idle();
    expect(value).toMatchObject({ directed: false, source: "neutral", degradedReason: "gpu-yield" });
    expect(ms).toBeLessThan(300);
    expect(rig.llm.calls).toEqual([]);
    expect(session.stats()).toMatchObject({ llmCalls: 0, windowsNeutral: 1, neutralByReason: { "gpu-yield": 1 } });
  });

  it("plays a partition already in the cache, with no model call, while the flag is present", async () => {
    const first = await makeRig({ pipeline: { windowSize: 4, lookahead: 0 } });
    const warm = first.open({ source: makeBlocks(8) });
    await warm.cuesFor("seg-1");
    const dir = runtimeDir();
    writeFileSync(gpuYieldFlagPath(dir), "");
    const second = await makeRig({ directory: first.directory, gpuYield: createGpuYieldProbe({ runtimeDir: dir }), pipeline: { windowSize: 4, lookahead: 0 } });
    const session = second.open({ source: makeBlocks(8) });
    expect(await session.cuesFor("seg-2")).toMatchObject({ directed: true, source: "cache" });
    expect(await session.cuesFor("seg-5")).toMatchObject({ directed: false, degradedReason: "gpu-yield" });
    expect(second.llm.calls).toEqual([]);
  });

  it("resumes at the next window once the flag is lifted, without having waited for it", async () => {
    const dir = runtimeDir();
    const rig = await makeRig({ gpuYield: createGpuYieldProbe({ runtimeDir: dir }), pipeline: { windowSize: 2, lookahead: 6 } });
    const session = rig.open({ source: makeBlocks(12) });
    expect(await session.cuesFor("seg-1")).toMatchObject({ directed: true });
    await session.idle();
    const before = rig.llm.callsOf("direct").length;
    writeFileSync(gpuYieldFlagPath(dir), "");
    const flagged = await session.cuesFor("seg-12");
    await session.idle();
    expect(flagged).toMatchObject({ directed: false, degradedReason: "gpu-yield" });
    expect(rig.llm.callsOf("direct")).toHaveLength(before);
    rmSync(gpuYieldFlagPath(dir));
    expect(await session.cuesFor("seg-12")).toMatchObject({ directed: true, source: "llm" });
    expect(rig.llm.callsOf("direct").length).toBeGreaterThan(before);
  });

  it("stops issuing model calls when the flag appears in the middle of the anticipation", async () => {
    const dir = runtimeDir();
    const flag = gpuYieldFlagPath(dir);
    const rig = await makeRig({
      gpuYield: createGpuYieldProbe({ runtimeDir: dir }),
      pipeline: { windowSize: 1, lookahead: 8 },
      llm: {
        direction: (_i: FakeCallInfo, r: DirectionLlmRequest) => {
          if (r.window[0]?.id === "seg-2") {
            writeFileSync(flag, "");
          }
          return { cues: r.window.map((b) => ({ cueId: defaultCueId(b.id), sourceIds: [b.id], speakerId: "narrator", spokenText: b.text })) };
        }
      }
    });
    const session = rig.open({ source: makeBlocks(10) });
    await session.cuesFor("seg-1");
    await session.idle();
    expect(windowsAsked(rig)).toEqual(["seg-1", "seg-2"]);
    expect(session.stats().neutralByReason["gpu-yield"]).toBeGreaterThan(0);
  });
});

describe("Test 12 (local-first)", () => {
  const scenario = async (rig: Rig) => {
    const session = rig.open({ source: makeBlocks(8) });
    await session.cuesFor("seg-1");
    await session.idle();
    return session;
  };

  it("sends every request of a full reading (analysis and windows) to loopback through the guard, and only those", async () => {
    const { guard, fetched, events } = recordingGuard();
    const rig = await makeRig({ egress: { guard, baseUrl: "http://127.0.0.1:11434" }, llm: { analysis: { analysis: { genre: "roman" } } }, pipeline: { windowSize: 2, lookahead: 8 } });
    const session = await scenario(rig);
    expect(session.stats()).toMatchObject({ windowsFromModel: 4, windowsNeutral: 0 });
    expect(fetched).toHaveLength(rig.llm.calls.length);
    expect(fetched.length).toBeGreaterThan(4);
    expect(fetched.every((url) => new URL(url).hostname === "127.0.0.1")).toBe(true);
    expect(events.every((event) => event.decision === "allow" && event.host === "127.0.0.1")).toBe(true);
  });

  it.each<[string, string, (host: string) => Promise<string[]>]>([
    ["a public address", "http://203.0.113.9:11434", async () => ["203.0.113.9"]],
    ["a named remote host", "https://ollama.example.com", async () => ["203.0.113.9"]],
    ["a loopback name that resolves elsewhere (rebinding)", "http://localhost:11434", async () => ["203.0.113.9"]],
    ["a non-http scheme", "file://localhost/etc/passwd", async () => ["127.0.0.1"]]
  ])("puts nothing on the wire for %s, and reads neutrally with egress-denied", async (_name, baseUrl, resolve) => {
    const { guard, fetched, events } = recordingGuard({ resolve });
    const rig = await makeRig({ egress: { guard, baseUrl }, pipeline: { windowSize: 2, lookahead: 8 } });
    const session = await scenario(rig);
    expect(fetched).toEqual([]);
    expect(events.every((event) => event.decision === "deny")).toBe(true);
    expect(session.stats()).toMatchObject({ windowsFromModel: 0, suspended: "egress-denied" });
    expect(rig.llm.callsOf("direct")).toEqual([]);
    expect((await session.cuesFor("seg-3")).degradedReason).toBe("egress-denied");
  });

  it("refuses even a trusted-looking host under strict local mode", async () => {
    const { guard, fetched } = recordingGuard({ strictLocal: true });
    const rig = await makeRig({ egress: { guard, baseUrl: "http://192.168.1.20:11434" } });
    await scenario(rig);
    expect(fetched).toEqual([]);
  });

  it("logs no content: a sentinel in the text, a playing note and a trait appears in no trace, guard or store event", async () => {
    const { guard, events } = recordingGuard();
    const SENTINEL = "SENTINEL-4f9c1a";
    const rig = await makeRig({
      egress: { guard, baseUrl: "http://127.0.0.1:11434" },
      llm: {
        analysis: { analysis: { genre: "roman" }, characters: [{ id: "anna", names: [SENTINEL], traits: { secret: SENTINEL } }] },
        direction: (_i: FakeCallInfo, r: DirectionLlmRequest) => ({
          cues: r.window.map((b) => ({ cueId: defaultCueId(b.id), sourceIds: [b.id], speakerId: "narrator", spokenText: b.text, direction: `${SENTINEL} note de jeu` })),
          facts: [{ type: "addTrait", roleId: "anna", key: "vu", value: SENTINEL }]
        })
      },
      pipeline: { windowSize: 2, lookahead: 8 }
    });
    const session = rig.open({ source: makeBlocks(4, { 0: `${SENTINEL} ouvre la porte.` }) });
    await session.cuesFor("seg-1");
    await session.idle();
    const logged = JSON.stringify({ trace: rig.trace, events, stats: session.stats(), rejections: rig.rejections, warnings: rig.warnings });
    expect(logged).not.toContain(SENTINEL);
    expect(rig.trace.length).toBeGreaterThan(2);
  });
});

describe("Test 8 (même chemin pour les trois genres)", () => {
  const CHAPTER = "« Je viendrai demain », dit Anna à la porte.";
  const fixtures = [
    {
      name: "roman",
      genre: "roman",
      texts: [CHAPTER, "Le vent se leva sur la lande.", "« Reste ici », répondit le vieux Lucien."],
      characters: [{ id: "anna", names: ["Anna"] }, { id: "lucien", names: ["Lucien"] }]
    },
    {
      name: "documentation technique",
      genre: "documentation",
      texts: ["Lancez `npm run build` puis ouvrez le fichier config.yaml.", "Le paramètre timeout vaut trente secondes par défaut."],
      characters: []
    },
    {
      name: "réponse d'IA",
      genre: "réponse d'assistant",
      texts: ["Voici le résumé : le test échoue à cause du délai de dépassement.", "Il faut relancer la suite après correction."],
      characters: []
    }
  ];

  const run = async (fixture: (typeof fixtures)[number]) => {
    const rig = await makeRig({
      llm: {
        analysis: { analysis: { genre: fixture.genre, baseTone: "neutre" }, characters: fixture.characters },
        direction: (_i: FakeCallInfo, r: DirectionLlmRequest) => ({
          cues: r.window.map((b) => ({
            cueId: defaultCueId(b.id),
            sourceIds: [b.id],
            speakerId: b.text.startsWith("« Je") ? "anna" : "narrator",
            spokenText: b.text,
            emotion: { label: "posée", intensity: 0.3 }
          }))
        })
      },
      pipeline: { windowSize: 4, lookahead: 8 }
    });
    const source = fixture.texts.map((rawText, index) => ({ id: `seg-${index + 1}`, rawText, type: "paragraph" as const }));
    const session = rig.open({ source });
    const results = await Promise.all(source.map((block) => session.cuesFor(block.id)));
    await session.idle();
    return { rig, results, session };
  };

  it.each(fixtures)("$name: analysis, then one directed window, accepted by the controller", async (fixture) => {
    const { rig, results, session } = await run(fixture);
    expect(rig.llm.calls.map((c) => c.kind)).toEqual(["analyze", "direct"]);
    expect(results.every((r) => r.directed && r.cues.length === 1)).toBe(true);
    expect(session.stats()).toMatchObject({ windowsFromModel: 1, windowsNeutral: 0 });
    const bible = await rig.store.effective(rig.document);
    expect(bible.analysis?.genre).toBe(fixture.genre);
    expect(bible.characters.map((role) => role.id).sort()).toEqual(fixture.characters.map((c) => c.id).sort());
  });

  it("gives the novel's dialogue to its character, and the other genres to the narrator alone", async () => {
    const speakers = async (index: number) => (await run(fixtures[index] as (typeof fixtures)[number])).results.flatMap((r) => r.cues.map((c) => c.speakerId));
    expect(await speakers(0)).toEqual(["anna", "narrator", "narrator"]);
    expect(new Set(await speakers(1))).toEqual(new Set(["narrator"]));
    expect(new Set(await speakers(2))).toEqual(new Set(["narrator"]));
  });
});
