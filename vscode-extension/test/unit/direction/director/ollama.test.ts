/**
 * `OllamaDirectionLlm` (ADR-015 §2, ADR-010): request format, parsing, errors,
 * and that nothing but loopback is ever contacted. A local HTTP server plays
 * Ollama (`MockOllamaServer`); a guard whose `fetch` is a recorder plays the
 * network. No real model.
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DIRECTION_BOUNDS,
  RawDirectionOutputSchema,
  type Bible,
  type Role
} from "../../../../src/core/direction.js";
import { EgressDeniedError, createEgressGuard } from "../../../../src/net/EgressGuard.js";
import {
  ANALYSIS_OUTPUT_JSON_SCHEMA,
  ANALYST_PROMPT_VERSION,
  Analyst,
  CUE_JSON_SCHEMA,
  DEFAULT_DIRECTION_MODEL,
  DIRECTION_OUTPUT_JSON_SCHEMA,
  DIRECTION_PROMPT_VERSION,
  DIRECTOR_FACT_TYPES,
  DIRECTOR_PROMPT_VERSION,
  DirectionLlmError,
  FACT_TYPES,
  FIDELITY_RULES,
  OllamaDirectionLlm,
  RawAnalysisSchema,
  StageDirector,
  analystSystemPrompt,
  classifyLlmFailure,
  directorSystemPrompt,
  foldAnalysisTraits,
  type AnalysisLlmRequest,
  type DirectionLlmRequest,
  type OllamaCallStats,
  type OllamaDirectionLlmOptions
} from "../../../../src/direction/director/index.js";
import { MockOllamaServer } from "../../../fakes/mockOllamaServer.js";
import { makeRig, recordingGuard } from "./support.js";

const realGuard = () => createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });

const role = (id: string, extra: Partial<Role> = {}): Role => ({ id, names: [], traits: {}, voice: {}, ...extra });

const BIBLE: Bible = {
  schemaVersion: "1.0",
  scope: "document",
  scopeKey: "a".repeat(64),
  revision: 3,
  analysis: { genre: "conte", baseTone: "doux" },
  narrator: role("narrator"),
  characters: [
    role("anna", {
      names: ["Anna", "Anne"],
      traits: { âge: { value: "dix ans", by: "analyst", at: "2026-09-29T10:00:00.000Z" } },
      voice: { assignments: { kokoro: { voiceRef: "SECRET_VOICE_REF", by: "casting" } } }
    })
  ]
};

const directRequest = (extra: Partial<DirectionLlmRequest> = {}): DirectionLlmRequest => ({
  documentKey: "a".repeat(64),
  attempt: 0,
  resend: [],
  bible: BIBLE,
  window: [
    { id: "seg-3", text: "Il lança le fichier main.rs avec la commande cargo run." },
    { id: "seg-4", text: "Elle ne répondit pas." }
  ],
  previous: [{ id: "seg-2", text: "TEXTE_PRECEDENT" }],
  previousCues: [{ cueId: "c2", sourceIds: ["seg-2"], speakerId: "narrator", spokenText: "TEXTE_PRECEDENT", emotion: { label: "calme", intensity: 0.3 } }],
  following: [{ id: "seg-5", text: "TEXTE_SUIVANT" }],
  ...extra
});

const analysisRequest = (): AnalysisLlmRequest => ({
  documentKey: "a".repeat(64),
  chunkIndex: 0,
  chunkCount: 1,
  blocks: [{ id: "seg-1", text: "Anna ouvrit la porte." }],
  bible: { ...BIBLE, analysis: {}, characters: [] }
});

const CUES = {
  cues: [
    { cueId: "c3", sourceIds: ["seg-3"], speakerId: "narrator", spokenText: "Il lança le fichier main.rs avec la commande cargo run.", emotion: { label: "calme", intensity: 0.4 } },
    { cueId: "c4", sourceIds: ["seg-4"], speakerId: "anna", spokenText: "Elle ne répondit pas.", pauseAfterMs: 400 }
  ]
};

let server: MockOllamaServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function start(options: ConstructorParameters<typeof MockOllamaServer>[0] = {}): Promise<{ mock: MockOllamaServer; baseUrl: string }> {
  const mock = new MockOllamaServer(options);
  server = mock;
  return { mock, baseUrl: await mock.listen() };
}

const client = (baseUrl: string, extra: Partial<OllamaDirectionLlmOptions> = {}) =>
  new OllamaDirectionLlm({ baseUrl, egress: realGuard(), ...extra });

interface SentBody {
  model: string;
  stream: boolean;
  keep_alive: string | number;
  format: unknown;
  messages: Array<{ role: string; content: string }>;
  options: { temperature: number; num_ctx: number; seed?: number };
}
const sent = (mock: MockOllamaServer, index = 0): SentBody => JSON.parse(mock.requests[index]?.body ?? "{}") as SentBody;

describe("OllamaDirectionLlm: request format", () => {
  it("posts one /api/chat with the structured-output schema, a resident model and an explicit context", async () => {
    const { mock, baseUrl } = await start({ chatContentOverride: JSON.stringify(CUES) });
    const llm = client(baseUrl);
    await llm.direct(directRequest());
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]).toMatchObject({ method: "POST", url: "/api/chat" });
    const body = sent(mock);
    expect(body.model).toBe(DEFAULT_DIRECTION_MODEL);
    expect(DEFAULT_DIRECTION_MODEL).toBe("qwen2.5:7b");
    expect(body.stream).toBe(false);
    expect(body.keep_alive).toBe("10m");
    expect(body.format).toEqual(DIRECTION_OUTPUT_JSON_SCHEMA);
    expect(body.options).toEqual({ temperature: 0.2, num_ctx: 8192 });
    expect(body.messages.map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("honours the model, temperature, context, keep_alive and seed given", async () => {
    const { mock, baseUrl } = await start({ chatContentOverride: JSON.stringify(CUES) });
    await client(baseUrl, { model: "qwen2.5:3b", temperature: 0, numCtx: 4096, keepAlive: -1, seed: 7 }).direct(directRequest());
    const body = sent(mock);
    expect(body).toMatchObject({ model: "qwen2.5:3b", keep_alive: -1, options: { temperature: 0, num_ctx: 4096, seed: 7 } });
  });

  it("puts the window, its context, the bible and the cues already given in the user message", async () => {
    const { mock, baseUrl } = await start({ chatContentOverride: JSON.stringify(CUES) });
    await client(baseUrl).direct(directRequest());
    const user = sent(mock).messages[1]?.content ?? "";
    for (const expected of ["[seg-3]", "cargo run", "[seg-4]", "TEXTE_PRECEDENT", "TEXTE_SUIVANT", "anna", "Anne", "dix ans", "genre : conte", "seg-2 | narrator | calme 0.3"]) {
      expect(user).toContain(expected);
    }
    expect(user.indexOf("TEXTE_PRECEDENT")).toBeLessThan(user.indexOf("[seg-3]"));
    expect(user.indexOf("[seg-3]")).toBeLessThan(user.indexOf("TEXTE_SUIVANT"));
    expect(user).not.toContain("refusée");
    expect(user).toContain("(2 segments : seg-3, seg-4) — chacun doit être couvert");
  });

  it("never shows the model a voice: no voiceRef, no provider id", async () => {
    const { mock, baseUrl } = await start({ chatContentOverride: JSON.stringify(CUES) });
    await client(baseUrl).direct(directRequest());
    const all = sent(mock).messages.map((m) => m.content).join("\n");
    expect(all).not.toContain("SECRET_VOICE_REF");
    expect(all).not.toContain("kokoro");
  });

  it("sends the controller's reasons back on a re-prompt", async () => {
    const { mock, baseUrl } = await start({ chatContentOverride: JSON.stringify(CUES) });
    await client(baseUrl).direct(
      directRequest({ attempt: 1, resend: [{ sourceId: "seg-4", reasons: [{ code: "negation-lost", detail: "la négation « ne » a disparu" }] }] })
    );
    const user = sent(mock).messages[1]?.content ?? "";
    expect(user).toContain("refusée");
    expect(user).toContain("[seg-4] negation-lost : la négation « ne » a disparu");
  });

  it("asks the analysis with its own schema, chapter position and known cast", async () => {
    const { mock, baseUrl } = await start({ chatContentOverride: JSON.stringify({ analysis: {}, characters: [] }) });
    await client(baseUrl).analyze({ ...analysisRequest(), chunkIndex: 1, chunkCount: 3 });
    const body = sent(mock);
    expect(body.format).toEqual(ANALYSIS_OUTPUT_JSON_SCHEMA);
    expect(body.messages[0]?.content).toBe(analystSystemPrompt());
    expect(body.messages[1]?.content).toContain("Extrait 2 sur 3");
    expect(body.messages[1]?.content).toContain("Anna ouvrit la porte.");
  });
});

describe("OllamaDirectionLlm: answers", () => {
  it("returns the parsed JSON of the direction, unvalidated, and it satisfies the controller's raw schema", async () => {
    const { baseUrl } = await start({ chatContentOverride: JSON.stringify({ ...CUES, facts: [{ type: "addRole", roleId: "marc", names: ["Marc"] }] }) });
    const raw = await client(baseUrl).direct(directRequest());
    expect(raw).toMatchObject({ cues: [{ cueId: "c3" }, { cueId: "c4" }], facts: [{ type: "addRole" }] });
    expect(RawDirectionOutputSchema.safeParse(raw).success).toBe(true);
  });

  it("does not validate: an out-of-bound value goes through for the controller to bring back", async () => {
    const wild = { cues: [{ ...CUES.cues[0], tempo: 9, pauseAfterMs: 99999 }] };
    const { baseUrl } = await start({ chatContentOverride: JSON.stringify(wild) });
    expect(await client(baseUrl).direct(directRequest())).toEqual(wild);
  });

  it("accepts a Markdown fence around the JSON", async () => {
    const { baseUrl } = await start({ chatContentOverride: "```json\n" + JSON.stringify(CUES) + "\n```" });
    expect(await client(baseUrl).direct(directRequest())).toEqual(CUES);
  });

  it("folds the analysis traits pairs into the record RawAnalysisSchema reads", async () => {
    const answer = {
      analysis: { genre: "conte" },
      characters: [{ id: "anna", names: ["Anna"], traits: [{ key: "âge", value: "dix ans" }, { key: "__proto__", value: "x" }], voiceDescriptor: "claire" }]
    };
    const { baseUrl } = await start({ chatContentOverride: JSON.stringify(answer) });
    const raw = await client(baseUrl).analyze(analysisRequest());
    const parsed = RawAnalysisSchema.parse(raw);
    expect(parsed.characters?.[0]?.traits).toEqual({ âge: "dix ans" });
    expect(Object.getPrototypeOf(parsed.characters?.[0]?.traits)).toBe(Object.prototype);
    expect(foldAnalysisTraits("pas un objet")).toBe("pas un objet");
    expect(foldAnalysisTraits({ characters: "x" })).toEqual({ characters: "x" });
  });

  it("works end to end with the analyst: the cast lands in the document bible", async () => {
    const answer = { analysis: { genre: "conte", baseTone: "doux" }, characters: [{ id: "anna", names: ["Anna"], traits: [{ key: "âge", value: "dix ans" }] }] };
    const { mock, baseUrl } = await start({ chatContentOverride: JSON.stringify(answer) });
    const rig = await makeRig();
    const analyst = new Analyst({ llm: client(baseUrl), store: rig.store, timeoutMs: 5000 });
    const outcome = await analyst.analyze({ document: rig.document, source: [{ id: "seg-1", rawText: "Anna ouvrit la porte." }] });
    expect(outcome).toMatchObject({ status: "analyzed", characters: 1 });
    const bible = await rig.store.effective(rig.document);
    expect(bible.analysis?.genre).toBe("conte");
    expect(bible.characters.map((c) => c.id)).toEqual(["anna"]);
    expect(mock.requests).toHaveLength(1);
  });

  it("works end to end with the stage director: an accepted window, facts applied", async () => {
    const answer = {
      cues: [{ cueId: "c1", sourceIds: ["seg-1"], speakerId: "narrator", spokenText: "Il lança le fichier main.rs avec la commande cargo run.", emotion: { label: "calme", intensity: 0.4 } }],
      facts: [{ type: "addRole", roleId: "marc", names: ["Marc"] }]
    };
    const { mock, baseUrl } = await start({ chatContentOverride: JSON.stringify(answer) });
    const rig = await makeRig();
    const director = new StageDirector({ llm: client(baseUrl), store: rig.store, timeoutMs: 5000 });
    const bible = await rig.store.effective(rig.document);
    const result = await director.directWindow({
      documentKey: rig.document.documentKey,
      document: rig.document,
      window: [{ id: "seg-1", rawText: "Il lança le fichier main.rs avec la commande cargo run." }],
      before: [],
      after: [],
      bible: { bible }
    });
    expect(result).toMatchObject({ directed: true, llmCalls: 1, resends: 0, facts: { written: 1 } });
    expect(mock.requests).toHaveLength(1);
  });
});

describe("OllamaDirectionLlm: errors", () => {
  const reasonOf = async (promise: Promise<unknown>): Promise<string> => {
    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(DirectionLlmError);
      return (error as DirectionLlmError).reason;
    }
    throw new Error("expected a rejection");
  };

  it("an HTTP error is provider-unavailable", async () => {
    const { baseUrl } = await start({ fail500: true });
    expect(await reasonOf(client(baseUrl).direct(directRequest()))).toBe("provider-unavailable");
  });

  it("a server that is not there is provider-unavailable", async () => {
    const closed = createServer();
    await new Promise<void>((done) => closed.listen(0, "127.0.0.1", done));
    const address = closed.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    await new Promise<void>((done) => closed.close(() => done()));
    expect(await reasonOf(client(`http://127.0.0.1:${port}`).direct(directRequest()))).toBe("provider-unavailable");
  });

  it("an answer that is not JSON is invalid-structured-output", async () => {
    const { baseUrl } = await start({ chatContentOverride: "voici la partition : {cues" });
    expect(await reasonOf(client(baseUrl).direct(directRequest()))).toBe("invalid-structured-output");
  });

  it("an answer without message content is invalid-structured-output", async () => {
    const guard = createEgressGuard({
      mode: "local",
      trustedHosts: [],
      strictLocal: false,
      fetchImpl: (async () => new Response(JSON.stringify({ done: true }), { status: 200 })) as typeof fetch
    });
    const llm = new OllamaDirectionLlm({ egress: guard });
    expect(await reasonOf(llm.direct(directRequest()))).toBe("invalid-structured-output");
  });

  it("its own timeout is `timeout`, and the request is aborted", async () => {
    const { baseUrl } = await start({ chatDelayMs: 400, chatContentOverride: JSON.stringify(CUES) });
    const started = Date.now();
    expect(await reasonOf(client(baseUrl, { timeoutMs: 60 }).direct(directRequest()))).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(350);
  });

  it("the caller's signal is `cancelled`, before or during the request", async () => {
    const { mock, baseUrl } = await start({ chatDelayMs: 400, chatContentOverride: JSON.stringify(CUES) });
    const llm = client(baseUrl);
    const already = new AbortController();
    already.abort();
    expect(await reasonOf(llm.direct(directRequest(), already.signal))).toBe("cancelled");
    expect(mock.requests).toHaveLength(0);
    const controller = new AbortController();
    const pending = llm.direct(directRequest(), controller.signal);
    setTimeout(() => controller.abort(), 40);
    expect(await reasonOf(pending)).toBe("cancelled");
  });

  it("reports counts and durations only, never a text, and flags a cut answer and a full context", async () => {
    const seen: OllamaCallStats[] = [];
    const guard = createEgressGuard({
      mode: "local",
      trustedHosts: [],
      strictLocal: false,
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            message: { content: '{"cues":[{"cueId":"c1"' },
            done_reason: "length",
            load_duration: 2_500_000_000,
            prompt_eval_count: 8190,
            prompt_eval_duration: 1_200_000_000,
            eval_count: 300,
            eval_duration: 4_000_000_000
          }),
          { status: 200 }
        )) as typeof fetch
    });
    const llm = new OllamaDirectionLlm({ egress: guard, onCall: (stats) => seen.push(stats) });
    await expect(llm.direct(directRequest())).rejects.toBeInstanceOf(DirectionLlmError);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      kind: "direct",
      ok: false,
      outcome: "invalid-structured-output",
      truncated: true,
      contextSaturated: true,
      promptTokens: 8190,
      completionTokens: 300,
      loadMs: 2500,
      evalMs: 4000
    });
    const dump = JSON.stringify(seen);
    expect(dump).not.toContain("main.rs");
    expect(dump).not.toContain("TEXTE_");
  });

  it("reports a successful call too", async () => {
    const seen: OllamaCallStats[] = [];
    const { baseUrl } = await start({ chatContentOverride: JSON.stringify(CUES) });
    await client(baseUrl, { onCall: (stats) => seen.push(stats) }).analyze(analysisRequest());
    expect(seen).toEqual([expect.objectContaining({ kind: "analyze", ok: true, outcome: "ok", truncated: false })]);
  });
});

describe("OllamaDirectionLlm: local-first (ADR-010)", () => {
  it.each([
    ["a public address", "http://203.0.113.5:11434"],
    ["a named remote host", "http://ollama.example.com:11434"],
    ["a file URL", "file:///etc/passwd"],
    ["a host that only contains localhost", "http://localhost.evil.example:11434"]
  ])("%s: the guard refuses, zero request is issued", async (_label, baseUrl) => {
    const { guard, fetched } = recordingGuard();
    const llm = new OllamaDirectionLlm({ baseUrl, egress: guard });
    for (const call of [() => llm.direct(directRequest()), () => llm.analyze(analysisRequest())]) {
      const error = await call().then(
        () => undefined,
        (caught: unknown) => caught
      );
      expect(error).toBeInstanceOf(EgressDeniedError);
      expect(classifyLlmFailure(error)).toBe("egress-denied");
    }
    expect(fetched).toEqual([]);
  });

  it("a name that resolves to a public address (DNS rebinding) is refused, zero request", async () => {
    const { guard, fetched } = recordingGuard({ resolve: async () => ["93.184.216.34"] });
    const llm = new OllamaDirectionLlm({ baseUrl: "http://localhost:11434", egress: guard });
    await expect(llm.direct(directRequest())).rejects.toBeInstanceOf(EgressDeniedError);
    expect(fetched).toEqual([]);
  });

  it("the default address is loopback and it is the only one contacted", async () => {
    const { guard, fetched } = recordingGuard();
    const llm = new OllamaDirectionLlm({ egress: guard });
    await llm.direct(directRequest()).catch(() => undefined);
    await llm.analyze(analysisRequest()).catch(() => undefined);
    expect(fetched).toEqual(["http://127.0.0.1:11434/api/chat", "http://127.0.0.1:11434/api/chat"]);
  });

  it("a redirect to another host is refused: the answer is an error, not a follow", async () => {
    const { baseUrl } = await start({ redirectExternal: true });
    const error = await client(baseUrl).direct(directRequest()).then(
      () => undefined,
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(EgressDeniedError);
  });

  it("the prompt version and the model are what the partition cache keys on", () => {
    const llm = new OllamaDirectionLlm({ egress: recordingGuard().guard });
    expect(llm.promptVersion).toBe(DIRECTION_PROMPT_VERSION);
    expect(DIRECTION_PROMPT_VERSION).toBe(`analyst-${ANALYST_PROMPT_VERSION}.director-${DIRECTOR_PROMPT_VERSION}`);
    expect(llm.model).toBe("qwen2.5:7b");
    expect(new OllamaDirectionLlm({ egress: recordingGuard().guard, model: "qwen2.5:3b" }).model).toBe("qwen2.5:3b");
  });
});

describe("prompts and schemas", () => {
  const contract = JSON.parse(
    readFileSync(resolve(__dirname, "../../../../../contracts/direction-v1/partition.schema.json"), "utf8")
  ) as { $defs: { cue: { required: string[]; properties: Record<string, { enum?: string[]; items?: { properties?: { kind?: { enum: string[] }; at?: { enum: string[] } } } }> } } };

  it("the cue schema names the contract's fields, required ones and enums", () => {
    const cue = CUE_JSON_SCHEMA as { required: string[]; properties: Record<string, { items?: { properties?: { kind?: { enum: string[] }; at?: { enum: string[] } } } }> };
    expect(Object.keys(cue.properties).sort()).toEqual(Object.keys(contract.$defs.cue.properties).sort());
    expect([...cue.required].sort()).toEqual([...contract.$defs.cue.required].sort());
    const contractNonverbal = contract.$defs.cue.properties.nonverbal?.items?.properties;
    const nonverbal = cue.properties.nonverbal?.items?.properties;
    expect(nonverbal?.kind?.enum).toEqual(contractNonverbal?.kind?.enum);
    expect(nonverbal?.at?.enum).toEqual(contractNonverbal?.at?.enum);
  });

  it("the facts a director may propose are those the store lets it write", () => {
    expect([...FACT_TYPES]).toEqual([...DIRECTOR_FACT_TYPES]);
  });

  it("the fidelity rules carry the wording of the narrator evaluation (numbers, commands, negations)", () => {
    const styles = JSON.parse(readFileSync(resolve(__dirname, "../../../../scripts/narrator-eval/styles-v2.json"), "utf8")) as Record<string, string>;
    const fragments = [
      "tous les nombres avec leur unité, les versions, les noms de fichiers, les commandes, les identifiants de code et les noms propres",
      "Conserve chaque négation (« ne pas », « jamais », « aucun ») attachée à ce qu'elle concerne.",
      "N'ajoute aucun fait, chiffre ou unité absent du texte"
    ];
    for (const fragment of fragments) {
      expect(FIDELITY_RULES).toContain(fragment);
      for (const style of Object.values(styles)) {
        expect(style).toContain(fragment);
      }
    }
    expect(directorSystemPrompt()).toContain(FIDELITY_RULES);
  });

  it("the director prompt states the safety bounds it is checked against", () => {
    const prompt = directorSystemPrompt();
    for (const expected of [
      `de ${DIRECTION_BOUNDS.tempo.min} à ${DIRECTION_BOUNDS.tempo.max}`,
      `de ${DIRECTION_BOUNDS.pauseMs.min} à ${DIRECTION_BOUNDS.pauseMs.max}`,
      `au plus ${DIRECTION_BOUNDS.emphasisMax}`,
      `${DIRECTION_BOUNDS.directionMaxChars} caractères`
    ]) {
      expect(prompt).toContain(expected);
    }
    expect(prompt).toContain("jamais de voix");
  });

  it("neither prompt names a genre or a reading style", () => {
    for (const prompt of [directorSystemPrompt(), analystSystemPrompt()]) {
      expect(prompt).not.toMatch(/\b(roman|conte|documentation|dialogues?)\b|réponse d'IA|colère|joyeu/i);
    }
  });
});
