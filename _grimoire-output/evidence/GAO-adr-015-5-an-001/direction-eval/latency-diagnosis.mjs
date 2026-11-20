#!/usr/bin/env node
/**
 * Diagnostic de latence du metteur en scène (carte GAO-adr-015-5-an-001).
 * Usage : node latency-diagnosis.mjs [decompose|remedies|all]   (après `npm run compile` dans vscode-extension)
 * Les requêtes réelles (analyste, 1re fenêtre) sont capturées via le vrai pipeline, puis rejouées telles quelles.
 * MODE JEU : test de $XDG_RUNTIME_DIR/gpu-yield/active avant chaque appel ; s'il existe, arrêt propre.
 * Jamais deux mesures en parallèle : tout est séquentiel.
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ext = resolve(here, "../../../../vscode-extension");
const require = createRequire(import.meta.url);
const dir = (p) => require(join(ext, "out/src", p));
const phase = process.argv[2] ?? "all";
const BASE = "http://127.0.0.1:11434";
const MODEL = "qwen2.5:7b";

const yieldActive = () => existsSync(join(process.env.XDG_RUNTIME_DIR ?? "/nonexistent", "gpu-yield", "active"));
class GameMode extends Error {}
const guard = () => { if (yieldActive()) throw new GameMode("différé : mode jeu"); };

const P = dir("direction/director/prompts/index.js");
const { PartitionController } = dir("direction/controller/index.js");
const { BibleStore, documentScope } = dir("direction/bible/index.js");
const { Analyst, DirectionPipeline, StageDirector, PartitionCache } = dir("direction/director/index.js");
const { DirectionLlmError } = dir("direction/director/llm.js");
const { createEgressGuard } = dir("net/EgressGuard.js");
const egress = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
const texts = JSON.parse(readFileSync(join(ext, "scripts/direction-eval/texts.json"), "utf8"));

const ms = (ns) => Math.round((ns ?? 0) / 1e5) / 10;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

async function call({ model = MODEL, system, user, format, numCtx = 8192, keepAlive = "10m", extra = {} }) {
  guard();
  const body = { model, stream: false, keep_alive: keepAlive, messages: [{ role: "system", content: system }, { role: "user", content: user }], options: { temperature: 0.2, num_ctx: numCtx, ...extra } };
  if (format !== undefined) body.format = format;
  const t = performance.now();
  const r = await (await egress.fetch(`${BASE}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  const wall = performance.now() - t;
  let parsed = null;
  try { const c = String(r.message?.content ?? "").trim(); parsed = JSON.parse(/^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(c)?.[1] ?? c); } catch { parsed = null; }
  return {
    wallMs: Math.round(wall), totalMs: ms(r.total_duration), loadMs: ms(r.load_duration), promptTok: r.prompt_eval_count, promptMs: ms(r.prompt_eval_duration),
    genTok: r.eval_count, genMs: ms(r.eval_duration), tokPerS: r.eval_duration ? Math.round((r.eval_count / r.eval_duration) * 1e9 * 10) / 10 : null,
    done: r.done_reason, parsed, chars: String(r.message?.content ?? "").length
  };
}
const warm = (model = MODEL, numCtx = 8192) => call({ model, system: "Réponds en JSON.", user: "{}", format: "json", numCtx, extra: { num_predict: 2 } });

// ------------------------------------------------------------ capture
async function capture() {
  const out = {};
  for (const text of texts) {
    guard();
    const work = mkdtempSync(join(tmpdir(), "lat-diag-"));
    try {
      const blocks = text.blocks.map((b, i) => ({ id: `seg-${i + 1}`, rawText: b.text, type: b.type }));
      const store = new BibleStore({ directory: work });
      const document = documentScope(`latdiag:${text.id}:${Date.now()}`, { persist: true });
      const cap = { analyze: null, direct: null };
      const llm = {
        id: "cap", model: MODEL, promptVersion: P.DIRECTION_PROMPT_VERSION,
        analyze: async (r) => { cap.analyze = r; const raw = await realAnalyze(r); return raw; },
        direct: async (r) => { cap.direct ??= r; throw new DirectionLlmError("provider-unavailable", "capture"); }
      };
      const pipeline = new DirectionPipeline({ analyst: new Analyst({ llm, store, timeoutMs: 120000 }), director: new StageDirector({ llm, store, timeoutMs: 120000 }), store, cache: new PartitionCache({ directory: work }), llm, windowSize: 4, contextBefore: 6, contextAfter: 4, lookahead: 1, firstSoundBudgetMs: 600000, steadyBudgetMs: 600000 });
      const session = pipeline.open({ document, source: blocks, profileId: "lat" });
      await session.cuesFor(blocks[0].id);
      session.dispose();
      out[text.id] = { ...cap, types: Object.fromEntries(blocks.map((b) => [b.id, b.type])), nBlocks: blocks.length, blocks: blocks.map((b) => ({ id: b.id, text: b.rawText })) };
    } finally { rmSync(work, { recursive: true, force: true }); }
  }
  return out;
}
async function realAnalyze(r) {
  const res = await call({ system: P.analystSystemPrompt(), user: P.analystUserPrompt(r), format: P.ANALYSIS_OUTPUT_JSON_SCHEMA });
  const { foldAnalysisTraits } = dir("direction/director/OllamaDirectionLlm.js");
  return foldAnalysisTraits(res.parsed);
}

const ctl = new PartitionController({ faithful: false });
const ctlF = new PartitionController({ faithful: true });
function validity(cap, req, parsed) {
  if (!parsed || !Array.isArray(parsed.cues)) return { json: false, accepted: false, faithful: false, codes: ["not-json"] };
  const source = req.window.map((b) => ({ id: b.id, rawText: b.text, type: cap.types[b.id] }));
  const input = { documentKey: req.documentKey, source, raw: parsed, bible: { bible: req.bible } };
  const n = ctl.check(input), f = ctlF.check(input);
  return { json: true, accepted: n.accepted, faithful: f.accepted, codes: n.accepted ? [] : [...new Set(n.violations.map((v) => v.code))] };
}

const dirCall = (req, o = {}) => call({ system: o.system ?? P.directorSystemPrompt(), user: o.user ?? P.directorUserPrompt(req), format: "format" in o ? o.format : P.DIRECTION_OUTPUT_JSON_SCHEMA, numCtx: o.numCtx, model: o.model, keepAlive: o.keepAlive, extra: o.extra });

// -------------------------------------------------- variantes de prompt
const compactSystem = () => [
  "Metteur en scène d'une lecture à voix haute. Réponds uniquement par un JSON { \"cues\": [...] }.",
  "Chaque cue : cueId (unique), sourceIds (segments couverts), speakerId (\"narrator\" ou un rôle listé), spokenText (texte du segment mot pour mot : nombres, unités, noms propres et négations inchangés, rien de résumé ni ajouté).",
  "Facultatif : emotion { label, intensity 0..1 }, tempo 0.7..1.3, pauseAfterMs 0..1500.",
  "Couvre chaque segment de la fenêtre, dans l'ordre ; découpe un segment seulement si le locuteur change."
].join("\n");
const compactBible = (b) => {
  const a = b.analysis ?? {};
  const head = [a.genre, a.baseTone].filter(Boolean).join(" ; ") || "(aucune analyse)";
  return `Document : ${head}\nRôles : narrator` + b.characters.map((c) => `, ${c.id} (${c.names.join("/")})`).join("");
};
const compactUser = (req) => [compactBible(req.bible), "Fenêtre à diriger :\n" + P.directorUserPrompt({ ...req, previous: [], previousCues: [], following: [], bible: { ...req.bible, analysis: undefined, characters: [] } }).split("Fenêtre à diriger")[1].replace(/^[^\n]*\n/, "")].join("\n\n");
const COMPACT_SCHEMA = { type: "object", additionalProperties: false, required: ["cues"], properties: { cues: { type: "array", items: { type: "object", required: ["cueId", "sourceIds", "speakerId", "spokenText"], properties: { cueId: { type: "string" }, sourceIds: { type: "array", items: { type: "string" } }, speakerId: { type: "string" }, spokenText: { type: "string" }, emotion: { type: "object", required: ["label", "intensity"], properties: { label: { type: "string" }, intensity: { type: "number" } } }, tempo: { type: "number" }, pauseAfterMs: { type: "integer" } } } } } };

const subWindow = (cap, k) => {
  const r = cap.direct; const all = cap.blocks; const start = all.findIndex((b) => b.id === r.window[0].id);
  return { ...r, window: all.slice(start, start + k), previous: [], previousCues: [], following: all.slice(start + k, start + k + 4) };
};

function fusedRequest(cap) {
  const r = cap.direct;
  const system = P.directorSystemPrompt() + "\n\nIl n'y a pas encore d'analyse ni de rôles : ajoute dans ta réponse `analysis` ({ genre, baseTone } en quelques mots) et `characters` (liste { id, names } des personnages qui parlent, id en minuscules), puis dirige la fenêtre avec ces rôles.";
  const user = P.directorUserPrompt({ ...r, bible: { ...r.bible, analysis: undefined, characters: [] } });
  const schema = { ...P.DIRECTION_OUTPUT_JSON_SCHEMA, required: ["analysis", "characters", "cues"], properties: { analysis: { type: "object", properties: { genre: { type: "string" }, baseTone: { type: "string" } } }, characters: { type: "array", items: { type: "object", required: ["id", "names"], properties: { id: { type: "string" }, names: { type: "array", items: { type: "string" } } } } }, ...P.DIRECTION_OUTPUT_JSON_SCHEMA.properties } };
  return { system, user, schema };
}
function fusedValidity(cap, parsed) {
  if (!parsed || !Array.isArray(parsed.cues)) return { json: false, accepted: false, faithful: false, codes: ["not-json"] };
  const r = cap.direct;
  const chars = (parsed.characters ?? []).map((c) => ({ id: c.id, names: c.names ?? [], traits: {}, voice: {} }));
  const bible = { ...r.bible, characters: chars };
  return validity(cap, { ...r, bible }, parsed);
}

// ------------------------------------------------------------ phases
const results = { date: new Date().toISOString(), model: MODEL, status: "complete", decompose: [], remedies: [] };
const save = () => { writeFileSync(join(here, `latency-${phase}.json`), JSON.stringify(results, null, 2) + "\n"); };
const strip = ({ parsed, ...s }) => s;

async function main() {
  if (yieldActive()) { console.log("différé : mode jeu"); results.status = "deferred"; save(); return; }
  await warm();
  const caps = await capture();
  writeFileSync(join(here, "latency-inputs.json"), JSON.stringify(caps, null, 2) + "\n");
  const cap = caps.conte;

  if (phase === "decompose" || phase === "all") {
    const plan = [["analyst", "conte"], ["analyst", "doc-technique"], ["analyst", "reponse-ia"], ["director", "conte"], ["director", "conte"], ["director", "doc-technique"], ["director", "doc-technique"], ["director", "reponse-ia"]];
    for (const [kind, id] of plan) {
      const c = caps[id];
      const res = kind === "analyst"
        ? await call({ system: P.analystSystemPrompt(), user: P.analystUserPrompt(c.analyze), format: P.ANALYSIS_OUTPUT_JSON_SCHEMA })
        : await dirCall(c.direct);
      const v = kind === "director" ? validity(c, c.direct, res.parsed) : { json: res.parsed !== null };
      results.decompose.push({ kind, text: id, ...strip(res), valid: v });
      console.log(kind, id, res.wallMs, "ms", "load", res.loadMs, "pp", res.promptTok, res.promptMs, "gen", res.genTok, res.genMs, res.tokPerS, "tok/s");
      save();
    }
  }

  if (phase === "remedies" || phase === "all") {
    const rep = 3;
    const variants = [
      ["A baseline (format = JSON Schema, ctx 8192)", () => dirCall(cap.direct), (p) => validity(cap, cap.direct, p)],
      ["B sans `format` (JSON demandé dans la consigne)", () => dirCall(cap.direct, { format: undefined }), (p) => validity(cap, cap.direct, p)],
      ["B2 `format: \"json\"` (JSON libre, sans grammaire du schéma)", () => dirCall(cap.direct, { format: "json" }), (p) => validity(cap, cap.direct, p)],
      ["C prompt allégé (consigne + bible compactes, schéma réduit)", () => dirCall(cap.direct, { system: compactSystem(), user: compactUser(cap.direct), format: COMPACT_SCHEMA }), (p) => validity(cap, cap.direct, p)],
      ["C2 prompt allégé sans `format`", () => dirCall(cap.direct, { system: compactSystem(), user: compactUser(cap.direct), format: undefined }), (p) => validity(cap, cap.direct, p)],
      ["D num_ctx 4096", () => dirCall(cap.direct, { numCtx: 4096 }), (p) => validity(cap, cap.direct, p), () => warm(MODEL, 4096)],
      ["D2 num_ctx 3072", () => dirCall(cap.direct, { numCtx: 3072 }), (p) => validity(cap, cap.direct, p), () => warm(MODEL, 3072)],
      ["E première fenêtre de 2 segments", () => { const r = subWindow(cap, 2); return dirCall(r); }, (p) => validity(cap, subWindow(cap, 2), p)],
      ["E2 fenêtre de 2 segments, sans `format`", () => { const r = subWindow(cap, 2); return dirCall(r, { format: undefined }); }, (p) => validity(cap, subWindow(cap, 2), p)],
      ["F qwen2.5:3b, première fenêtre (4 segments)", () => dirCall(cap.direct, { model: "qwen2.5:3b" }), (p) => validity(cap, cap.direct, p), () => warm("qwen2.5:3b")],
      ["F2 qwen2.5:3b, fenêtre de 2 segments", () => dirCall(subWindow(cap, 2), { model: "qwen2.5:3b" }), (p) => validity(cap, subWindow(cap, 2), p), () => warm("qwen2.5:3b")],
      ["G fusion analyste + 1re fenêtre (un seul appel)", () => { const f = fusedRequest(cap); return call({ system: f.system, user: f.user, format: f.schema }); }, (p) => fusedValidity(cap, p)]
    ];
    for (const [name, run, check, pre] of variants) {
      guard();
      await (pre ? pre() : warm());
      const runs = [];
      for (let i = 0; i < rep; i++) {
        const res = await run();
        const v = check(res.parsed);
        runs.push({ ...strip(res), valid: v });
        console.log(name, i, res.wallMs, "ms", "gen", res.genTok, "tok", res.genMs, "pp", res.promptTok, res.promptMs, "valid", v.accepted, v.faithful);
      }
      results.remedies.push({ name, runs });
      save();
    }
    // Démarrage à froid : déchargement puis premier appel, avec keep_alive 10m.
    guard();
    await egress.fetch(`${BASE}/api/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, keep_alive: 0 }) });
    await new Promise((r) => setTimeout(r, 3000));
    const cold = await dirCall(cap.direct, { keepAlive: "10m" });
    results.cold = { ...strip(cold), valid: validity(cap, cap.direct, cold.parsed) };
    console.log("cold", cold.wallMs, "load", cold.loadMs);
    // Préchargement seul (ce que coûterait un warm-up à l'activation)
    await egress.fetch(`${BASE}/api/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, keep_alive: 0 }) });
    await new Promise((r) => setTimeout(r, 3000));
    const t = performance.now();
    const pre = await warm();
    results.preload = { wallMs: Math.round(performance.now() - t), loadMs: pre.loadMs };
    save();
  }
  if (phase === "richness") {
    for (const id of ["conte", "doc-technique"]) {
      const c = caps[id]; guard(); await warm();
      const res = await dirCall(c.direct, { system: compactSystem(), user: compactUser(c.direct), format: undefined });
      const cues = res.parsed?.cues ?? [];
      const sp = {}; for (const q of cues) sp[q.speakerId] = (sp[q.speakerId] ?? 0) + 1;
      results.remedies.push({ name: id + " / richesse C2", cues: cues.length, withEmotion: cues.filter((q) => q.emotion).length, withTempo: cues.filter((q) => q.tempo).length, withPause: cues.filter((q) => q.pauseAfterMs).length, speakers: sp, emotions: cues.map((q) => q.emotion?.label).filter(Boolean), runs: [strip(res)] });
      console.log(id, JSON.stringify(results.remedies.at(-1)));
    }
    save();
  }
  if (phase === "combo") {
    const rep = 2;
    for (const id of ["conte", "doc-technique", "reponse-ia"]) {
      const c = caps[id];
      guard(); await warm();
      const entries = [
        ["analyste sans format", () => call({ system: P.analystSystemPrompt(), user: P.analystUserPrompt(c.analyze), format: undefined }), (p) => ({ json: p !== null && typeof p === "object" && "analysis" in p })],
        ["analyste avec format (référence)", () => call({ system: P.analystSystemPrompt(), user: P.analystUserPrompt(c.analyze), format: P.ANALYSIS_OUTPUT_JSON_SCHEMA }), (p) => ({ json: p !== null })],
        ["direction C2 : allégé, sans format, fenêtre 4", () => dirCall(c.direct, { system: compactSystem(), user: compactUser(c.direct), format: undefined }), (p) => validity(c, c.direct, p)],
        ["direction C3 : allégé, sans format, fenêtre 2", () => { const r = subWindow(c, 2); return dirCall(r, { system: compactSystem(), user: compactUser(r), format: undefined }); }, (p) => validity(c, subWindow(c, 2), p)],
        ["direction E2 : consigne d'origine, sans format, fenêtre 2", () => { const r = subWindow(c, 2); return dirCall(r, { format: undefined }); }, (p) => validity(c, subWindow(c, 2), p)],
        ["direction référence : format schéma, fenêtre 4", () => dirCall(c.direct), (p) => validity(c, c.direct, p)]
      ];
      for (const [name, run, check] of entries) {
        const runs = [];
        for (let i = 0; i < rep; i++) { const res = await run(); const v = check(res.parsed); runs.push({ ...strip(res), valid: v }); console.log(id, name, i, res.wallMs, "ms", res.genTok, "tok", "valid", v.accepted ?? v.json, v.faithful); }
        results.remedies.push({ name: id + " / " + name, runs }); save();
      }
    }
    // Démarrage à froid et préchargement
    guard();
    await egress.fetch(`${BASE}/api/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, keep_alive: 0 }) });
    await new Promise((r) => setTimeout(r, 3000));
    const t = performance.now(); const pre = await warm();
    results.preload = { wallMs: Math.round(performance.now() - t), loadMs: pre.loadMs }; save();
    const cc = caps.conte; const hot = await dirCall(cc.direct, { system: compactSystem(), user: compactUser(cc.direct), format: undefined });
    console.log("preload", results.preload, "hot compact", hot.wallMs);
    guard();
    await egress.fetch(`${BASE}/api/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, keep_alive: 0 }) });
    await new Promise((r) => setTimeout(r, 3000));
    const cold = await dirCall(cc.direct, { system: compactSystem(), user: compactUser(cc.direct), format: undefined });
    results.cold = { ...strip(cold), note: "C2 à froid, modèle déchargé" }; save();
    console.log("cold C2", cold.wallMs, "load", cold.loadMs);
  }
}
main().catch((e) => { if (e instanceof GameMode) { results.status = "partial"; results.note = "différé : mode jeu"; save(); console.log("différé : mode jeu"); } else { console.error(e); process.exitCode = 1; } });
