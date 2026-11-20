/**
 * ADR-015 test 7 (fidelity, applied through the controller) and test 10
 * (re-prompts and neutral fallback) for `PartitionController`.
 */
import { describe, expect, it } from "vitest";
import { CUE_ID_PATTERN, DirectionContractError, PartitionSchema } from "../../../../src/core/direction.js";
import {
  DEFAULT_MAX_RESENDS,
  PartitionController,
  neutralPartitionForSource,
  type ControllerInput,
  type ControllerVerdict,
  type DirectFn,
  type SourceBlock
} from "../../../../src/direction/controller/index.js";
import { DOCUMENT_KEY, blocksOf, cuesFor, loadTrappedTexts, makeBible, role, toOralForm } from "./helpers.js";

const S1: SourceBlock = {
  id: "s1",
  rawText: "Le délai passe de 30 s à 60 s dans `src/net/EgressGuard.ts`. Ne relance pas `npm run compile`.",
  type: "paragraph"
};
const S2: SourceBlock = { id: "s2", rawText: "Il reste une redirection 302 à traiter.", type: "paragraph" };
const SOURCE = [S1, S2];

const BIBLE = makeBible([role("marie", { chatterbox: "voice-a" })], role("narrator", { chatterbox: "voice-n" }));

const S1_ORAL =
  "Le délai passe de trente secondes à soixante secondes dans S R C, net, Egress Guard, point t s. Ne relance pas npm run compile.";

function input(raw: unknown, overrides: Partial<ControllerInput> = {}): ControllerInput {
  return { documentKey: DOCUMENT_KEY, source: SOURCE, raw, bible: { bible: BIBLE }, ...overrides };
}

function cue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { cueId: "c1", sourceIds: ["s1"], speakerId: "narrator", spokenText: S1.rawText, ...overrides };
}

const CUE_2 = { cueId: "c2", sourceIds: ["s2"], speakerId: "narrator", spokenText: S2.rawText };

/** A complete, faithful answer for SOURCE. */
function goodAnswer(): { cues: Array<Record<string, unknown>> } {
  return { cues: [cue(), CUE_2] };
}

const controller = new PartitionController();

function codes(verdict: ControllerVerdict): string[] {
  return verdict.violations.map((violation) => violation.code);
}

describe("schema, bounds", () => {
  it("accepts a valid directed answer and returns the validated partition", () => {
    const verdict = controller.check(
      input({
        cues: [
          cue({
            emotion: { label: "sérieux", intensity: 0.6 },
            tempo: 1.1,
            pauseBeforeMs: 200,
            pauseAfterMs: 400,
            emphasis: ["délai"],
            direction: "posé"
          }),
          { ...CUE_2, speakerId: "marie" }
        ]
      })
    );
    expect(verdict.accepted).toBe(true);
    if (!verdict.accepted) {
      throw new Error("unreachable");
    }
    expect(PartitionSchema.safeParse(verdict.partition).success).toBe(true);
    expect(verdict.partition.documentKey).toBe(DOCUMENT_KEY);
    expect(verdict.partition.bibleRevision).toBe(0);
    expect(verdict.partition.cues.map((item) => item.speakerId)).toEqual(["narrator", "marie"]);
    expect(verdict.resend).toEqual([]);
    expect(verdict.violations).toEqual([]);
    expect(verdict.trace).toEqual({ cues: 2, violations: {}, resendSegments: 0, boundsAdjusted: 0 });
  });

  it("carries the bible revision into the partition", () => {
    const verdict = controller.check(input(goodAnswer(), { bible: { bible: makeBible([], role("narrator"), 7) } }));
    expect(verdict.accepted && verdict.partition.bibleRevision).toBe(7);
  });

  it("brings out-of-bound values back and counts them, without rejecting", () => {
    const verdict = controller.check(
      input({
        cues: [cue({ tempo: 9, pauseAfterMs: 99999, emotion: { label: "x", intensity: 5 }, emphasis: ["absent du texte"] }), CUE_2]
      })
    );
    expect(verdict.accepted).toBe(true);
    if (!verdict.accepted) {
      throw new Error("unreachable");
    }
    const first = verdict.partition.cues[0];
    expect(first?.tempo).toBe(1.4);
    expect(first?.pauseAfterMs).toBe(3000);
    expect(first?.emotion?.intensity).toBe(1);
    expect(first?.emphasis).toEqual([]);
    expect(verdict.bounds.total).toBe(4);
    expect(verdict.trace.boundsAdjusted).toBe(4);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "les cues sont ici"],
    ["a number", 42],
    ["an empty object", {}],
    ["cues that is not a list", { cues: "x" }],
    ["a cue without ids", { cues: [{}] }],
    ["a speaker id that is not an id", { cues: [cue({ speakerId: "Not An Id" })] }],
    ["an unknown nonverbal kind", { cues: [cue({ nonverbal: [{ kind: "cry", at: "before" }] })] }],
    ["an empty sourceIds", { cues: [cue({ sourceIds: [] })] }],
    ["an empty spokenText", { cues: [cue({ spokenText: "" })] }]
  ])("sends the whole window back on %s", (_name, raw) => {
    const verdict = controller.check(input(raw));
    expect(verdict.accepted).toBe(false);
    expect(new Set(codes(verdict))).toEqual(new Set(["schema-invalid"]));
    expect(verdict.resend.map((item) => item.sourceId)).toEqual(["s1", "s2"]);
    for (const item of verdict.resend) {
      expect(item.reasons.map((reason) => reason.code)).toEqual(["schema-invalid"]);
    }
  });

  it("rejects a malformed documentKey as a caller mistake", () => {
    expect(() => controller.check(input(goodAnswer(), { documentKey: "nope" }))).toThrow(DirectionContractError);
  });
});

describe("coverage", () => {
  it("sends back only the uncovered segment", () => {
    const verdict = controller.check(input({ cues: [cue()] }));
    expect(verdict.accepted).toBe(false);
    expect(codes(verdict)).toEqual(["uncovered-source"]);
    expect(verdict.resend).toEqual([{ sourceId: "s2", reasons: [{ code: "uncovered-source", detail: expect.any(String) }] }]);
  });

  it("names the known segments of a cue that also cites an unknown one", () => {
    const verdict = controller.check(input({ cues: [cue({ sourceIds: ["s1", "ghost"] }), CUE_2] }));
    expect(codes(verdict)).toEqual(["unknown-source-id"]);
    expect(verdict.resend.map((item) => item.sourceId)).toEqual(["s1"]);
  });

  it("falls back to the whole window when a cue names nothing known", () => {
    const verdict = controller.check(input({ cues: [cue(), CUE_2, { cueId: "c3", sourceIds: ["ghost"], speakerId: "narrator", spokenText: "fantôme" }] }));
    expect(codes(verdict)).toEqual(["unknown-source-id"]);
    expect(verdict.resend.map((item) => item.sourceId)).toEqual(["s1", "s2"]);
  });

  it("refuses a repeated cue id", () => {
    const verdict = controller.check(input({ cues: [cue(), { ...CUE_2, cueId: "c1" }] }));
    expect(codes(verdict)).toEqual(["duplicate-cue-id"]);
    expect(verdict.resend.map((item) => item.sourceId)).toEqual(["s2"]);
  });

  it("accepts a segment split in several cues (quote and narrator's aside)", () => {
    const [first, second] = S1.rawText.split(/(?<=\.) /);
    const verdict = controller.check(
      input({
        cues: [
          cue({ cueId: "c1a", spokenText: first }),
          cue({ cueId: "c1b", speakerId: "marie", spokenText: second }),
          CUE_2
        ]
      })
    );
    expect(verdict.accepted).toBe(true);
  });

  it("but a split that drops the second half is caught on the segment", () => {
    const [first] = S1.rawText.split(/(?<=\.) /);
    const verdict = controller.check(input({ cues: [cue({ spokenText: first }), CUE_2] }));
    expect(new Set(codes(verdict))).toEqual(new Set(["identifier-lost", "negation-lost"]));
    expect(verdict.resend.map((item) => item.sourceId)).toEqual(["s1"]);
  });

  it("accepts one cue that covers two segments", () => {
    const verdict = controller.check(input({ cues: [cue({ sourceIds: ["s1", "s2"], spokenText: `${S1.rawText} ${S2.rawText}` })] }));
    expect(verdict.accepted).toBe(true);
  });

  it("does not require a blank segment to be covered, and refuses a blank cue", () => {
    const blank: SourceBlock = { id: "s3", rawText: "  \n ", type: "paragraph" };
    const source = [S1, blank, S2];
    expect(controller.check(input(goodAnswer(), { source })).accepted).toBe(true);
    const verdict = controller.check(input({ cues: [cue({ spokenText: "   " }), CUE_2] }));
    expect(codes(verdict)).toContain("blank-text");
  });

  it("requires a code segment to be covered but does not read it word by word", () => {
    const code: SourceBlock = { id: "s3", rawText: "```ts\nconst limit = 42;\nif (!ok) throw new Error(\"no\");\n```", type: "code" };
    const source = [S1, code];
    const covering = { cueId: "c3", sourceIds: ["s3"], speakerId: "narrator", spokenText: "Un bloc de code." };
    expect(controller.check(input({ cues: [cue(), covering] }, { source })).accepted).toBe(true);
    expect(codes(controller.check(input({ cues: [cue()] }, { source })))).toEqual(["uncovered-source"]);
    // A figure the block does not carry is still an invention.
    const invented = { ...covering, spokenText: "Un bloc de code de 99 lignes." };
    expect(codes(controller.check(input({ cues: [cue(), invented] }, { source })))).toEqual(["number-invented"]);
  });
});

describe("bible coherence", () => {
  it("accepts the narrator and the characters of the bible", () => {
    const verdict = controller.check(input({ cues: [cue(), { ...CUE_2, speakerId: "marie" }] }));
    expect(verdict.accepted).toBe(true);
  });

  it("refuses a speaker the bible does not know, on the segment it speaks", () => {
    const verdict = controller.check(input({ cues: [cue(), { ...CUE_2, speakerId: "inconnu" }] }));
    expect(verdict.accepted).toBe(false);
    expect(codes(verdict)).toEqual(["unknown-speaker"]);
    expect(verdict.resend.map((item) => item.sourceId)).toEqual(["s2"]);
  });

  it("refuses a director that picks a voice or an engine setting, and ignores harmless extra keys", () => {
    const verdict = controller.check(input({ cues: [cue({ voice: "voice-x", exaggeration: 1.5 }), CUE_2] }));
    expect(codes(verdict)).toEqual(["voice-override"]);
    expect(verdict.resend.map((item) => item.sourceId)).toEqual(["s1"]);
    expect(controller.check(input({ cues: [cue({ commentaire: "libre" }), CUE_2] })).accepted).toBe(true);
  });

  it("reports, without blocking, a character that has the narrator's voice", () => {
    const bible = makeBible([role("marie", { chatterbox: "voice-n" })], role("narrator", { chatterbox: "voice-n" }));
    const verdict = controller.check(input(goodAnswer(), { bible: { bible } }));
    expect(verdict.accepted).toBe(true);
    expect(verdict.bibleIssues.map((issue) => issue.code)).toEqual(["narrator-voice-reused"]);
  });

  it("reports a speaker whose assigned voice is no longer the one already used", () => {
    const answer = { cues: [cue({ speakerId: "marie" }), CUE_2] };
    const changed = controller.check(input(answer, { bible: { bible: BIBLE, providerId: "chatterbox", voicesInUse: { marie: "voice-old" } } }));
    expect(changed.accepted).toBe(true);
    expect(changed.bibleIssues.map((issue) => issue.code)).toEqual(["voice-changed"]);
    expect(changed.bibleIssues[0]?.path).toBe("roles.marie.voice.assignments.chatterbox");

    const same = controller.check(input(answer, { bible: { bible: BIBLE, providerId: "chatterbox", voicesInUse: { marie: "voice-a" } } }));
    expect(same.bibleIssues).toEqual([]);

    const notSpeaking = controller.check(input(goodAnswer(), { bible: { bible: BIBLE, providerId: "chatterbox", voicesInUse: { marie: "voice-old" } } }));
    expect(notSpeaking.bibleIssues).toEqual([]);
  });
});

describe("test 7 — fidelity through the controller", () => {
  it("accepts the text read as is, and its spoken form", () => {
    expect(controller.check(input(goodAnswer())).accepted).toBe(true);
    expect(controller.check(input({ cues: [cue({ spokenText: S1_ORAL }), CUE_2] })).accepted).toBe(true);
  });

  it("flags a lost figure on its segment", () => {
    const verdict = controller.check(input({ cues: [cue({ spokenText: S1.rawText.replace("60 s", "quelques secondes") }), CUE_2] }));
    expect(codes(verdict)).toEqual(["number-lost"]);
    expect(verdict.resend[0]?.sourceId).toBe("s1");
    expect(verdict.resend[0]?.reasons[0]?.detail).toContain("60");
  });

  it("flags a figure invented by the director, on its cue", () => {
    const verdict = controller.check(input({ cues: [cue({ spokenText: `${S1.rawText} Cela fait 45 fois.` }), CUE_2] }));
    expect(codes(verdict)).toEqual(["number-invented"]);
    expect(verdict.violations[0]?.cueId).toBe("c1");
  });

  it("flags a lost negation", () => {
    const verdict = controller.check(input({ cues: [cue({ spokenText: S1.rawText.replace("Ne relance pas", "Relance") }), CUE_2] }));
    expect(codes(verdict)).toEqual(["negation-lost"]);
  });

  it("flags a lost identifier", () => {
    const verdict = controller.check(input({ cues: [cue({ spokenText: S1.rawText.replace("`npm run compile`", "la commande") }), CUE_2] }));
    expect(codes(verdict)).toEqual(["identifier-lost"]);
  });

  it("flags a spoken text far longer than its segment, and honours the ratio option", () => {
    const long = `${S2.rawText} ${"Redite. ".repeat(60)}`;
    const answer = { cues: [cue(), { ...CUE_2, spokenText: long }] };
    expect(codes(controller.check(input(answer)))).toEqual(["text-too-long"]);
    expect(new PartitionController({ maxLengthRatio: 20 }).check(input(answer)).accepted).toBe(true);
  });

  it("applies lexical equivalence only to the faithful profile", () => {
    const paraphrase = { cues: [cue(), { ...CUE_2, spokenText: "Il reste une redirection 302 à traiter, ce qui est vraiment dommage." }] };
    expect(controller.check(input(paraphrase)).accepted).toBe(true);
    const faithful = new PartitionController({ faithful: true }).check(input(paraphrase));
    expect(faithful.accepted).toBe(false);
    expect(codes(faithful)).toEqual(["lexical-add"]);
    expect(new PartitionController({ faithful: true }).check(input({ cues: [cue({ spokenText: S1_ORAL }), CUE_2] })).accepted).toBe(true);
  });

  it("keeps the source's content out of the trace, bounds and codes (never logged)", () => {
    const secret: SourceBlock = { id: "s9", rawText: "Ne touche jamais à `ZORGLUB_42` (fichier 7731).", type: "paragraph" };
    const verdict = controller.check(
      input({ cues: [{ cueId: "z", sourceIds: ["s9"], speakerId: "narrator", spokenText: "On ne dit rien." }] }, { source: [secret] })
    );
    expect(verdict.accepted).toBe(false);
    expect(JSON.stringify(verdict.trace)).not.toMatch(/ZORGLUB|7731/);
    expect(JSON.stringify(verdict.bounds)).not.toMatch(/ZORGLUB|7731/);
    expect(verdict.violations.map((violation) => violation.code).join(" ")).not.toMatch(/ZORGLUB|7731/);
    expect(JSON.stringify(verdict.violations)).toMatch(/ZORGLUB/);
  });

  describe("on the 24 trapped texts", () => {
    const texts = loadTrappedTexts();
    const faithful = new PartitionController({ faithful: true });

    it.each(texts.map((entry) => [entry.id, entry.text] as const))("%s: read as is, then in spoken form, is accepted", (_id, text) => {
      const blocks = blocksOf(text);
      for (const spoken of [text, toOralForm(text)]) {
        const answer = cuesFor(blocks, (block) => (spoken === text ? block.rawText : toOralForm(block.rawText)));
        const verdict = controller.check({ documentKey: DOCUMENT_KEY, source: blocks, raw: answer, bible: { bible: BIBLE } });
        expect(verdict.violations, spoken).toEqual([]);
        expect(verdict.accepted).toBe(true);
        const strict = faithful.check({ documentKey: DOCUMENT_KEY, source: blocks, raw: answer, bible: { bible: BIBLE } });
        expect(strict.violations, spoken).toEqual([]);
      }
    });

    it.each(texts.map((entry) => [entry.id, entry.text] as const))("%s: a paraphrase that loses a figure or a negation is sent back", (_id, text) => {
      const blocks = blocksOf(text);
      const mangled = cuesFor(blocks, (block) => block.rawText.replace(/\d+/g, "quelques").replace(/\b(ne|n'|pas|jamais|sans|not|never|no)\b/gi, ""));
      const verdict = controller.check({ documentKey: DOCUMENT_KEY, source: blocks, raw: mangled, bible: { bible: BIBLE } });
      expect(verdict.accepted).toBe(false);
      const ids = new Set(blocks.map((block) => block.id));
      expect(verdict.resend.length).toBeGreaterThan(0);
      for (const item of verdict.resend) {
        expect(ids.has(item.sourceId)).toBe(true);
        expect(item.reasons.length).toBeGreaterThan(0);
      }
      expect(new Set(codes(verdict))).toContain("number-lost");
    });
  });
});

// ---------------------------------------------------------------------------
// Test 10: re-prompts and neutral fallback
// ---------------------------------------------------------------------------

function scripted(answers: readonly unknown[]): { direct: DirectFn; calls: Array<Parameters<DirectFn>[0]> } {
  const calls: Array<Parameters<DirectFn>[0]> = [];
  const direct: DirectFn = (request) => {
    calls.push(request);
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  };
  return { direct, calls };
}

const BAD = { cues: [cue({ spokenText: "Rien à voir." })] };
const RUN_INPUT = { documentKey: DOCUMENT_KEY, source: SOURCE, bible: { bible: BIBLE } };

describe("test 10 — re-prompts and neutral fallback", () => {
  it("makes one call when the first answer is good", async () => {
    const { direct, calls } = scripted([goodAnswer()]);
    const outcome = await controller.run(RUN_INPUT, direct);
    expect(outcome).toMatchObject({ kind: "accepted", attempts: 1, resends: 0 });
    expect(calls).toEqual([{ attempt: 0, resend: [] }]);
  });

  it("sends the offending segments back with their reasons, then accepts the corrected answer", async () => {
    const { direct, calls } = scripted([BAD, goodAnswer()]);
    const outcome = await controller.run(RUN_INPUT, direct);
    expect(outcome).toMatchObject({ kind: "accepted", attempts: 2, resends: 1 });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.attempt).toBe(1);
    const resend = calls[1]?.resend ?? [];
    expect(resend.map((item) => item.sourceId)).toEqual(["s1", "s2"]);
    const s1Codes = resend.find((item) => item.sourceId === "s1")?.reasons.map((reason) => reason.code) ?? [];
    expect(s1Codes).toEqual(expect.arrayContaining(["number-lost", "negation-lost", "identifier-lost"]));
    expect(resend.find((item) => item.sourceId === "s2")?.reasons.map((reason) => reason.code)).toEqual(["uncovered-source"]);
  });

  it(`accepts at the last allowed re-prompt (${DEFAULT_MAX_RESENDS})`, async () => {
    const { direct, calls } = scripted([BAD, BAD, goodAnswer()]);
    const outcome = await controller.run(RUN_INPUT, direct);
    expect(outcome).toMatchObject({ kind: "accepted", attempts: 3, resends: 2 });
    expect(calls.map((call) => call.attempt)).toEqual([0, 1, 2]);
  });

  it("falls back to the neutral partition beyond the budget, never blocking", async () => {
    const { direct, calls } = scripted([BAD]);
    const outcome = await controller.run(RUN_INPUT, direct);
    expect(calls).toHaveLength(DEFAULT_MAX_RESENDS + 1);
    expect(outcome.kind).toBe("neutral");
    if (outcome.kind !== "neutral") {
      throw new Error("unreachable");
    }
    expect(outcome).toMatchObject({ reason: "resend-budget-exhausted", attempts: 3, resends: 2 });
    expect(outcome.lastViolationCodes).toEqual(expect.arrayContaining(["number-lost", "uncovered-source"]));
    expect(outcome.partition.cues).toHaveLength(2);
    expect(outcome.partition.cues.map((item) => [item.speakerId, item.sourceIds, item.spokenText, item.tempo, item.pauseBeforeMs, item.pauseAfterMs])).toEqual([
      ["narrator", ["s1"], S1.rawText, 1, 0, 0],
      ["narrator", ["s2"], S2.rawText, 1, 0, 0]
    ]);
    expect(outcome.partition.cues.every((item) => item.emotion === undefined && item.direction === undefined)).toBe(true);
  });

  it("gives a neutral partition that passes the controller itself", async () => {
    const outcome = await controller.run(RUN_INPUT, scripted([BAD]).direct);
    const verdict = controller.check({ ...RUN_INPUT, raw: outcome.partition });
    expect(verdict.accepted).toBe(true);
    expect(PartitionSchema.safeParse(outcome.partition).success).toBe(true);
  });

  it("honours the configured budget", async () => {
    const none = scripted([BAD]);
    expect((await new PartitionController({ maxResends: 0 }).run(RUN_INPUT, none.direct)).kind).toBe("neutral");
    expect(none.calls).toHaveLength(1);
    const many = scripted([BAD]);
    expect(await new PartitionController({ maxResends: 5 }).run(RUN_INPUT, many.direct)).toMatchObject({ kind: "neutral", attempts: 6 });
    expect(many.calls).toHaveLength(6);
    expect(() => new PartitionController({ maxResends: -1 })).toThrow(DirectionContractError);
    expect(() => new PartitionController({ maxResends: 1.5 })).toThrow(DirectionContractError);
  });

  it("falls back to neutral, without rethrowing, when the director fails", async () => {
    const first = scripted([new Error("Ollama absent")]);
    expect(await controller.run(RUN_INPUT, first.direct)).toMatchObject({ kind: "neutral", reason: "director-failed", attempts: 1 });
    expect(first.calls).toHaveLength(1);
    const later = scripted([BAD, new Error("délai dépassé")]);
    expect(await controller.run(RUN_INPUT, later.direct)).toMatchObject({ kind: "neutral", reason: "director-failed", attempts: 2 });
  });

  it("falls back to neutral when the answer is not even JSON-shaped, every time", async () => {
    const outcome = await controller.run(RUN_INPUT, scripted(["oups", null, 12]).direct);
    expect(outcome).toMatchObject({ kind: "neutral", reason: "resend-budget-exhausted" });
    if (outcome.kind !== "neutral") {
      throw new Error("expected the neutral fallback");
    }
    expect(outcome.lastViolationCodes).toEqual(["schema-invalid"]);
  });

  it("does not call the director once aborted, and reports it", async () => {
    const abort = new AbortController();
    abort.abort();
    const { direct, calls } = scripted([goodAnswer()]);
    expect(await controller.run(RUN_INPUT, direct, abort.signal)).toMatchObject({ kind: "neutral", reason: "aborted", attempts: 0 });
    expect(calls).toHaveLength(0);

    const during = new AbortController();
    const outcome = await controller.run(RUN_INPUT, () => {
      during.abort();
      return Promise.reject(new Error("aborted"));
    }, during.signal);
    expect(outcome).toMatchObject({ kind: "neutral", reason: "aborted" });
  });

  it("does not call the director for a window with nothing to read", async () => {
    const { direct, calls } = scripted([goodAnswer()]);
    const blank: SourceBlock = { id: "s1", rawText: " ", type: "paragraph" };
    const outcome = await controller.run({ ...RUN_INPUT, source: [blank] }, direct);
    expect(outcome).toMatchObject({ kind: "accepted", attempts: 0 });
    expect(outcome.partition.cues).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("passes the director the same window on every attempt (it re-reads, the controller keeps no state)", async () => {
    const controllerA = new PartitionController();
    const [one, two] = await Promise.all([
      controllerA.run(RUN_INPUT, scripted([BAD, goodAnswer()]).direct),
      controllerA.run(RUN_INPUT, scripted([goodAnswer()]).direct)
    ]);
    expect(one).toMatchObject({ kind: "accepted", attempts: 2 });
    expect(two).toMatchObject({ kind: "accepted", attempts: 1 });
  });
});

describe("neutral partition", () => {
  it("derives Core-safe, unique cue ids from any segment ids", () => {
    const source: SourceBlock[] = [
      { id: "a b/c", rawText: "un" },
      { id: "a_b_c", rawText: "deux" },
      { id: "a b/c ", rawText: "trois" },
      { id: "", rawText: "quatre" },
      { id: "vide", rawText: "   " }
    ];
    const partition = neutralPartitionForSource(source, { documentKey: DOCUMENT_KEY, bibleRevision: 3 });
    expect(partition.bibleRevision).toBe(3);
    expect(partition.cues.map((item) => item.sourceIds)).toEqual([["a b/c"], ["a_b_c"], ["a b/c "], [""]]);
    const ids = partition.cues.map((item) => item.cueId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(CUE_ID_PATTERN);
    }
  });

  it("prefers a segment's spokenText over its rawText, as the current pipeline does", () => {
    const partition = neutralPartitionForSource([{ id: "s", rawText: "**Titre**", spokenText: "Titre" }], { documentKey: DOCUMENT_KEY, bibleRevision: 0 });
    expect(partition.cues[0]?.spokenText).toBe("Titre");
  });
});
