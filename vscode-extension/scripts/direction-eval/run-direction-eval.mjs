#!/usr/bin/env node
/**
 * Mesure hors CI de la direction de lecture (ADR-015 étape 5b).
 * Appelle le vrai pipeline compilé (out/src/direction/director/…) avec
 * `OllamaDirectionLlm` sur un Ollama local, pour trois textes (texts.json :
 * conte avec dialogues, documentation technique, réponse d'un assistant).
 * Aucun LLM juge : uniquement des contrôles déterministes.
 *
 * Usage (après `npm run compile`) :
 *   node run-direction-eval.mjs [--model qwen2.5:7b] [--repeat 5]
 *        [--texts conte,doc-technique,reponse-ia] [--label baseline]
 *        [--base-url http://127.0.0.1:11434] [--temperature 0.2] [--num-ctx 8192]
 *        [--window 4] [--before 6] [--after 4] [--lookahead 8]
 *        [--cps 15]            # vitesse de lecture estimée, caractères par seconde
 *        [--out <dossier>]     # défaut : _grimoire-output/evidence/GAO-adr-015-5-an-001/direction-eval
 *
 * MODE JEU : si `$XDG_RUNTIME_DIR/gpu-yield/active` existe au départ, rien n'est
 * mesuré (« différé : mode jeu ») ; s'il apparaît entre deux exécutions, la
 * mesure s'arrête et le rapport est marqué partiel.
 *
 * Mesures :
 *  - partitions valides (fenêtres acceptées par le contrôleur), taux de renvois
 *    et de repli neutre (par raison) ;
 *  - fidélité selon `PartitionController` : verdict de chaque première réponse
 *    (profil normal et profil `faithful`), codes de violation, « à conserver »
 *    du jeu de textes retrouvés dans les segments dirigés ;
 *  - latence jusqu'au premier segment dirigé (analyse + première fenêtre,
 *    modèle chaud), p50/p95 ; durée de chaque appel, jetons, contexte saturé ;
 *  - débit : segments dirigés par seconde contre segments lus par seconde
 *    (durée de lecture estimée = caractères / --cps) ;
 *  - simulation de lecture à partir des durées mesurées : segments lus en
 *    neutre (retard) selon N, le budget établi et le budget de premier son ;
 *  - distributions (locuteurs, émotions, tempo, pauses) et indice de monotonie.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------- arguments
function parseArgs(argv) {
  const o = {
    model: "qwen2.5:7b",
    baseUrl: "http://127.0.0.1:11434",
    repeat: 5,
    label: "baseline",
    temperature: 0.2,
    numCtx: 8192,
    window: 4,
    before: 6,
    after: 4,
    lookahead: 8,
    cps: 15,
    out: resolve(root, "..", "_grimoire-output", "evidence", "GAO-adr-015-5-an-001", "direction-eval")
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    o[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
  }
  for (const k of ["repeat", "temperature", "numCtx", "window", "before", "after", "lookahead", "cps"]) o[k] = Number(o[k]);
  return o;
}
const args = parseArgs(process.argv.slice(2));

// ---------------------------------------------------------------- mode jeu
const gpuYieldFlag = () => {
  const dir = process.env.XDG_RUNTIME_DIR;
  return dir !== undefined && dir !== "" && existsSync(join(dir, "gpu-yield", "active"));
};

// ------------------------------------------------------------------ helpers
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim();
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => (xs.length === 0 ? null : sum(xs) / xs.length);
const stdev = (xs) => {
  if (xs.length === 0) return null;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
function percentile(xs, p) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
const round = (x, d = 1) => (x === null || x === undefined ? null : Math.round(x * 10 ** d) / 10 ** d);
const histogram = (items) => {
  const h = {};
  for (const it of items) h[it] = (h[it] ?? 0) + 1;
  return Object.fromEntries(Object.entries(h).sort((a, b) => b[1] - a[1]));
};
const share = (n, d) => (d === 0 ? null : round(n / d, 3));

// ------------------------------------------------- simulation de la lecture
/** Rejoue la lecture avec les durées de calcul mesurées (compute[w], la fenêtre 0 inclut l'analyse). */
function simulate({ segChars, K, N, compute, first, steady, cps }) {
  const n = segChars.length;
  const R = [];
  let scheduled = -1;
  let lastR = 0;
  let now = 0;
  let asked = false;
  const late = new Set();
  let lateSegs = 0;
  let waitTotal = 0;
  let maxWait = 0;
  let firstSound = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.floor(i / K);
    const upto = Math.floor(Math.min(n - 1, i + N) / K);
    while (scheduled < upto) {
      scheduled++;
      R[scheduled] = Math.max(lastR, now) + (compute[scheduled] ?? 0);
      lastR = R[scheduled];
    }
    let wait = 0;
    if (R[w] > now) {
      const budget = late.has(w) ? 0 : asked ? steady : first;
      if (R[w] <= now + budget) {
        wait = R[w] - now;
      } else {
        wait = budget;
        late.add(w);
        lateSegs++;
      }
    }
    asked = true;
    now += wait;
    if (i === 0) firstSound = now;
    waitTotal += wait;
    maxWait = Math.max(maxWait, wait);
    now += (segChars[i] / cps) * 1000;
  }
  return { lateSegments: lateSegs, lateShare: lateSegs / n, firstSoundMs: firstSound, waitTotalMs: waitTotal, maxWaitMs: maxWait, readMs: now };
}

// ------------------------------------------------------------------- rapport
function markdown(report) {
  const L = [];
  const fmt = (v, unit = "") => (v === null || v === undefined ? "—" : `${v}${unit}`);
  L.push(`# Mesure de la direction de lecture — ${report.meta.label}`);
  L.push("");
  L.push(`- Date : ${report.meta.date}`);
  L.push(`- Modèle : \`${report.meta.model}\` (température ${report.meta.temperature}, num_ctx ${report.meta.numCtx}, keep_alive 10m)`);
  L.push(`- Version des prompts : \`${report.meta.promptVersion}\``);
  L.push(`- Paramètres : K=${report.meta.K}, W=${report.meta.W}, L=${report.meta.L}, N=${report.meta.N}, budget établi 1 500 ms, budget de premier son 10 000 ms, lecture estimée ${report.meta.cps} caractères/s`);
  L.push(`- Répétitions par texte : ${report.meta.repeat} (chaque répétition = document neuf, bible et cache vides, modèle chaud)`);
  L.push(`- Chargement à froid du modèle (hors mesure) : ${fmt(report.meta.coldLoadMs, " ms")}`);
  L.push(`- Statut : ${report.status}${report.note ? ` — ${report.note}` : ""}`);
  L.push("");
  if (report.status === "deferred") {
    L.push("Différé : mode jeu (`$XDG_RUNTIME_DIR/gpu-yield/active` présent). Aucune mesure.");
    return L.join("\n") + "\n";
  }
  L.push("## Synthèse par texte");
  L.push("");
  L.push("| Texte | Fenêtres | Dirigées | Repli neutre | Fenêtres avec renvoi | Appels/fenêtre | 1re réponse acceptée | 1re acceptée (faithful) | « À conserver » | Premier segment dirigé p50 / p95 (ms) | Direction / lecture (seg/s) |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const t of report.texts) {
    const a = t.aggregate;
    L.push(
      `| ${t.id} | ${a.windows} | ${a.directedWindows} (${fmt(a.directedShare)}) | ${a.neutralWindows} (${fmt(a.neutralShare)}) | ${a.windowsWithResend} (${fmt(a.resendShare)}) | ${fmt(a.callsPerWindow)} | ${a.firstAttemptAccepted}/${a.firstAttemptTotal} | ${a.firstAttemptAcceptedFaithful}/${a.firstAttemptTotal} | ${a.mustKeepFound}/${a.mustKeepTotal} | ${fmt(a.firstDirectedP50)} / ${fmt(a.firstDirectedP95)} | ${fmt(a.directionSegPerS)} / ${fmt(a.readingSegPerS)} |`
    );
  }
  const g = report.global;
  L.push("");
  L.push("## Latence et débit (tous textes)");
  L.push("");
  L.push(`- Premier segment dirigé (analyse + première fenêtre, modèle chaud) : p50 ${fmt(g.firstDirectedP50, " ms")}, p95 ${fmt(g.firstDirectedP95, " ms")}, min ${fmt(g.firstDirectedMin, " ms")}, max ${fmt(g.firstDirectedMax, " ms")} sur ${g.firstDirectedCount} mesures (${g.firstNotDirected} sans segment dirigé).`);
  L.push(`- Appel d'analyse : p50 ${fmt(g.analyzeP50, " ms")}, p95 ${fmt(g.analyzeP95, " ms")}.`);
  L.push(`- Appel de direction (une fenêtre, un essai) : p50 ${fmt(g.directP50, " ms")}, p95 ${fmt(g.directP95, " ms")} (temps serveur total_duration p50 ${fmt(g.directServerTotalP50, " ms")}, évaluation du prompt p50 ${fmt(g.directPromptEvalP50, " ms")}) ; jetons de prompt p50 ${fmt(g.promptTokensP50)} / max ${fmt(g.promptTokensMax)} ; jetons générés p50 ${fmt(g.completionTokensP50)} ; ${fmt(g.tokensPerSecond)} jetons/s en génération.`);
  L.push(`- Contexte saturé (prompt ≥ 98 % de num_ctx) : ${g.contextSaturated} appel(s) ; réponses coupées par la limite de jetons : ${g.truncated} ; appels en échec : ${g.failedCalls} sur ${g.calls}.`);
  L.push(`- Débit : la direction produit ${fmt(g.directionSegPerS)} segments/s (médiane des lectures) contre ${fmt(g.readingSegPerS)} segments/s lus à ${report.meta.cps} caractères/s : rapport ${fmt(g.throughputRatio)}.`);
  L.push(`- Relecture (cache) : ${g.rereadCalls} appel(s) modèle sur ${g.rereadRuns} relecture(s), fenêtres servies par le cache ${g.rereadFromCache}/${g.rereadWindows}.`);
  L.push("");
  L.push("## Simulation de lecture (durées mesurées, lecture à vitesse estimée)");
  L.push("");
  L.push("Part de segments lus en neutre par retard (moyenne sur toutes les lectures mesurées) selon N (anticipation) et le budget établi ; budget de premier son 10 000 ms. Premier son = attente avant le premier segment.");
  L.push("");
  L.push("| N \\ budget établi | 1 500 ms | 3 000 ms | 5 000 ms |");
  L.push("|---|---|---|---|");
  for (const row of report.simulation.grid) {
    L.push(`| ${row.N} | ${row.cells.map((c) => `${fmt(c.lateShare)} (max attente ${fmt(c.maxWaitMs)} ms)`).join(" | ")} |`);
  }
  L.push("");
  L.push(`Premier son simulé : p50 ${fmt(report.simulation.firstSoundP50, " ms")}, p95 ${fmt(report.simulation.firstSoundP95, " ms")}, max ${fmt(report.simulation.firstSoundMax, " ms")} ; part de lectures où le premier segment dépasse 10 000 ms : ${fmt(report.simulation.firstOver10s)}.`);
  L.push("");
  L.push("## Qualité des partitions");
  L.push("");
  for (const t of report.texts) {
    const q = t.quality;
    L.push(`### ${t.id}`);
    L.push("");
    L.push(`- Analyse obtenue (dernière répétition) : genre « ${fmt(t.lastAnalysis?.genre)} », ton « ${fmt(t.lastAnalysis?.baseTone)} », intention « ${fmt(t.lastAnalysis?.intent)} » ; personnages : ${t.lastCharacters.length > 0 ? t.lastCharacters.join(", ") : "aucun"}.`);
    L.push(`- Cues dirigées : ${q.cues} (${fmt(q.cuesPerSegment)} par segment). Locuteurs : ${JSON.stringify(q.speakers)}. Attendu : ${JSON.stringify(t.expect)} → ${q.speakersAsExpected ? "conforme" : "NON conforme"}.`);
    L.push(`- Émotions : ${q.distinctEmotions} libellés distincts, dominant ${fmt(q.dominantEmotionShare)} ; ${JSON.stringify(q.emotions)}.`);
    L.push(`- Intensité : moyenne ${fmt(q.intensityMean, "")}, écart-type ${fmt(q.intensityStdev)} ; tempo : ${JSON.stringify(q.tempo)} ; pause après : ${JSON.stringify(q.pauseAfter)} ; pause avant : ${JSON.stringify(q.pauseBefore)}.`);
    L.push(`- Champs présents (part des cues) : émotion ${fmt(q.presence.emotion)}, tempo ${fmt(q.presence.tempo)}, pause ${fmt(q.presence.pause)}, note de jeu ${fmt(q.presence.direction)}, insistance ${fmt(q.presence.emphasis)}, non verbal ${fmt(q.presence.nonverbal)}.`);
    L.push(`- Monotonie : ${q.monotone ? "OUI" : "non"} (${q.monotoneReasons.join(" ; ") || "aucun critère atteint"}).`);
    L.push(`- Violations à la première réponse (contrôleur) : ${JSON.stringify(q.firstAttemptViolations)} ; replis : ${JSON.stringify(t.aggregate.neutralByReason)}.`);
    L.push("");
  }
  return L.join("\n") + "\n";
}

// --------------------------------------------------------------------- main
async function main() {
  const startedAt = new Date();
  mkdirSync(args.out, { recursive: true });
  const outBase = join(args.out, args.label);
  const meta = { label: args.label, date: startedAt.toISOString(), model: args.model, temperature: args.temperature, numCtx: args.numCtx, K: args.window, W: args.before, L: args.after, N: args.lookahead, repeat: args.repeat, cps: args.cps };

  if (gpuYieldFlag()) {
    const report = { meta, status: "deferred", note: "différé : mode jeu" };
    writeFileSync(`${outBase}.json`, JSON.stringify(report, null, 2) + "\n");
    writeFileSync(`${outBase}.md`, markdown(report));
    console.log("différé : mode jeu");
    return;
  }

  const dir = (p) => require(join(root, "out/src", p));
  const { createEgressGuard } = dir("net/EgressGuard.js");
  const { BibleStore, documentScope } = dir("direction/bible/index.js");
  const { PartitionController } = dir("direction/controller/index.js");
  const { Analyst, DirectionPipeline, OllamaDirectionLlm, PartitionCache, StageDirector, DIRECTION_PROMPT_VERSION } = dir("direction/director/index.js");
  meta.promptVersion = DIRECTION_PROMPT_VERSION;

  const egress = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
  const wanted = args.texts ? args.texts.split(",") : null;
  const texts = JSON.parse(readFileSync(join(here, "texts.json"), "utf8")).filter((t) => wanted === null || wanted.includes(t.id));

  // Vérifie le serveur et le modèle, puis charge le modèle (mesure à chaud ensuite).
  try {
    const tags = await (await egress.fetch(`${args.baseUrl}/api/tags`)).json();
    const names = (tags.models ?? []).map((m) => m.name);
    if (!names.includes(args.model)) throw new Error(`modèle absent : ${args.model}`);
    const t = performance.now();
    const warm = await (await egress.fetch(`${args.baseUrl}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: args.model, stream: false, keep_alive: "10m", messages: [{ role: "user", content: "Réponds par un seul mot." }], options: { num_ctx: args.numCtx, num_predict: 4 } }) })).json();
    meta.coldLoadMs = round(performance.now() - t);
    meta.coldLoadModelMs = round((warm.load_duration ?? 0) / 1e6);
  } catch (error) {
    const report = { meta, status: "error", note: `serveur ou modèle indisponible : ${error.message}` };
    writeFileSync(`${outBase}.json`, JSON.stringify(report, null, 2) + "\n");
    writeFileSync(`${outBase}.md`, markdown(report));
    console.error(report.note);
    process.exitCode = 1;
    return;
  }

  const ctlNormal = new PartitionController({ faithful: false });
  const ctlFaithful = new PartitionController({ faithful: true });
  const results = [];
  const allCalls = [];
  const allSims = [];
  const grids = [];
  const firstDirected = [];
  let interrupted = false;
  let rereadCalls = 0;
  let rereadRuns = 0;
  let rereadWindows = 0;
  let rereadFromCache = 0;

  for (const text of texts) {
    const runs = [];
    for (let rep = 0; rep < args.repeat; rep++) {
      if (gpuYieldFlag()) {
        interrupted = true;
        break;
      }
      const work = mkdtempSync(join(tmpdir(), "llm-voice-direction-eval-"));
      try {
        const blocks = text.blocks.map((b, i) => ({ id: `seg-${i + 1}`, rawText: b.text, type: b.type }));
        const typeOf = new Map(blocks.map((b) => [b.id, b.type]));
        const document = documentScope(`eval:${text.id}:${rep}:${startedAt.getTime()}`, { persist: true });
        const store = new BibleStore({ directory: work });
        const cache = new PartitionCache({ directory: work });
        const calls = [];
        const raws = [];
        const inner = new OllamaDirectionLlm({ egress, baseUrl: args.baseUrl, model: args.model, temperature: args.temperature, numCtx: args.numCtx, onCall: (s) => calls.push(s) });
        const llm = {
          id: inner.id,
          model: inner.model,
          promptVersion: inner.promptVersion,
          analyze: (r, s) => inner.analyze(r, s),
          direct: async (r, s) => {
            const raw = await inner.direct(r, s);
            raws.push({ request: r, raw });
            return raw;
          }
        };
        const trace = [];
        const t0 = performance.now();
        const pipeline = new DirectionPipeline({
          analyst: new Analyst({ llm, store, timeoutMs: 120_000 }),
          director: new StageDirector({ llm, store, timeoutMs: 120_000 }),
          store,
          cache,
          llm,
          windowSize: args.window,
          contextBefore: args.before,
          contextAfter: args.after,
          lookahead: args.lookahead,
          firstSoundBudgetMs: 600_000,
          steadyBudgetMs: 600_000,
          trace: (event) => trace.push({ t: performance.now() - t0, event })
        });
        const session = pipeline.open({ document, source: blocks, profileId: "eval" });
        const directions = [];
        let firstDirectedMs = null;
        for (const [i, block] of blocks.entries()) {
          const d = await session.cuesFor(block.id);
          directions.push(d);
          if (firstDirectedMs === null && d.directed) firstDirectedMs = performance.now() - t0;
          if (i === 0 && !d.directed) {
            // premier segment neutre : on continue, la latence « premier dirigé » sera celle du premier segment dirigé
          }
        }
        const wallMs = performance.now() - t0;
        session.dispose();
        const stats = session.stats();
        const bible = await store.effective(document);

        // Fenêtres : durée de calcul (les fenêtres sont en série), issue de la trace.
        const windowEvents = trace.filter((e) => e.event.type === "window");
        const analysisEvent = trace.find((e) => e.event.type === "analysis");
        const compute = [];
        let prev = 0;
        for (const e of windowEvents) {
          compute[e.event.window] = e.t - prev;
          prev = e.t;
        }
        const windows = windowEvents.map((e) => ({ window: e.event.window, source: e.event.source, degradedReason: e.event.degradedReason ?? null, llmCalls: e.event.llmCalls, resends: e.event.resends, boundsAdjusted: e.event.boundsAdjusted, facts: e.event.facts }));

        // Contrôleur : verdict de chaque réponse brute (première réponse = attempt 0).
        const verdicts = raws.map(({ request, raw }) => {
          const source = request.window.map((b) => ({ id: b.id, rawText: b.text, type: typeOf.get(b.id) }));
          const input = { documentKey: request.documentKey, source, raw, bible: { bible: request.bible } };
          const n = ctlNormal.check(input);
          const f = ctlFaithful.check(input);
          return { attempt: request.attempt, accepted: n.accepted, acceptedFaithful: f.accepted, codes: n.accepted ? [] : [...new Set(n.violations.map((v) => v.code))] };
        });

        // « À conserver » dans les segments dirigés.
        const directedIds = new Set(directions.filter((d) => d.directed).map((d) => d.segmentId));
        const spoken = norm(directions.filter((d) => d.directed).flatMap((d) => d.cues.map((c) => c.spokenText)).join(" "));
        let mustKeepTotal = 0;
        let mustKeepFound = 0;
        for (const item of text.mustKeep) {
          const block = blocks.find((b) => norm(b.rawText).includes(norm(item)));
          if (block && directedIds.has(block.id)) {
            mustKeepTotal++;
            if (spoken.includes(norm(item))) mustKeepFound++;
          }
        }

        const cues = directions.filter((d) => d.directed).flatMap((d) => d.cues);
        const segChars = blocks.map((b) => Array.from(b.rawText).length);
        const sim = { segChars, compute };

        // Relecture : même magasin, même cache → aucun appel modèle attendu.
        let reread = null;
        if (rep === 0) {
          const before = calls.length;
          const again = pipeline.open({ document, source: blocks, profileId: "eval" });
          const t1 = performance.now();
          const dirs = [];
          for (const block of blocks) dirs.push(await again.cuesFor(block.id));
          again.dispose();
          const s2 = again.stats();
          reread = { calls: calls.length - before, ms: round(performance.now() - t1), windowsFromCache: s2.windowsFromCache, windowsFromModel: s2.windowsFromModel, windowsNeutral: s2.windowsNeutral };
          rereadRuns++;
          rereadCalls += reread.calls;
          rereadWindows += s2.windowsFromCache + s2.windowsFromModel + s2.windowsNeutral;
          rereadFromCache += s2.windowsFromCache;
        }

        allCalls.push(...calls);
        if (firstDirectedMs !== null) firstDirected.push(firstDirectedMs);
        allSims.push({ text: text.id, ...sim });
        runs.push({
          rep,
          wallMs: round(wallMs),
          firstDirectedMs: round(firstDirectedMs),
          analysisMs: round(analysisEvent?.t ?? null),
          compute: compute.map((c) => round(c)),
          windows,
          stats: { ...stats, neutralByReason: stats.neutralByReason },
          calls,
          verdicts,
          mustKeepTotal,
          mustKeepFound,
          cues,
          segments: blocks.length,
          directedSegments: directions.filter((d) => d.directed).length,
          segChars,
          analysis: bible.analysis ?? null,
          characters: bible.characters.map((c) => c.id),
          reread
        });
        console.log(`[${text.id}] rep ${rep + 1}/${args.repeat} : ${round(wallMs / 1000)} s, fenêtres ${windows.map((w) => (w.source === "neutral" ? "N" : w.source === "cache" ? "C" : `L${w.resends > 0 ? "+" + w.resends : ""}`)).join(" ")}, premier dirigé ${round(firstDirectedMs)} ms`);
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    }
    results.push({ text, runs });
    if (interrupted) break;
  }

  // ------------------------------------------------------------ agrégation
  const texts_ = results.map(({ text, runs }) => {
    const windows = runs.flatMap((r) => r.windows);
    const directed = windows.filter((w) => w.source !== "neutral");
    const neutral = windows.filter((w) => w.source === "neutral");
    const verdicts = runs.flatMap((r) => r.verdicts);
    const first = verdicts.filter((v) => v.attempt === 0);
    const cues = runs.flatMap((r) => r.cues);
    const fd = runs.map((r) => r.firstDirectedMs).filter((x) => x !== null);
    const directionSegPerS = runs.map((r) => r.directedSegments / (r.wallMs / 1000));
    const readingSegPerS = runs.map((r) => r.segments / (sum(r.segChars) / args.cps));
    const speakers = histogram(cues.map((c) => c.speakerId));
    const labels = cues.filter((c) => c.emotion).map((c) => c.emotion.label.trim().toLowerCase());
    const emotions = histogram(labels);
    const intensities = cues.filter((c) => c.emotion).map((c) => c.emotion.intensity);
    const bucket = (v, edges) => (v === undefined ? "absent" : edges.find(([hi]) => v <= hi)?.[1] ?? "haut");
    const tempoEdges = [[0.9, "<=0.9"], [1.1, "0.9-1.1"], [Infinity, ">1.1"]];
    const pauseEdges = [[0, "0"], [300, "1-300"], [800, "301-800"], [Infinity, ">800"]];
    const tempo = histogram(cues.map((c) => bucket(c.tempo, tempoEdges)));
    const pauseAfter = histogram(cues.map((c) => bucket(c.pauseAfterMs, pauseEdges)));
    const pauseBefore = histogram(cues.map((c) => bucket(c.pauseBeforeMs, pauseEdges)));
    const dominant = Object.values(emotions)[0] ?? 0;
    const dominantShare = labels.length > 0 ? dominant / labels.length : null;
    const uniformTempo = cues.length > 0 && new Set(cues.map((c) => c.tempo ?? 1)).size === 1;
    const uniformPause = cues.length > 0 && new Set(cues.map((c) => `${c.pauseBeforeMs ?? 0}/${c.pauseAfterMs ?? 0}`)).size === 1;
    const monotoneReasons = [];
    if (cues.length >= 8 && labels.length === 0) monotoneReasons.push("aucune émotion renseignée");
    if (dominantShare !== null && cues.length >= 8 && dominantShare >= 0.7) monotoneReasons.push(`libellé dominant ${round(dominantShare, 2)} des émotions`);
    if (cues.length >= 8 && Object.keys(emotions).length <= 2) monotoneReasons.push(`${Object.keys(emotions).length} libellé(s) d'émotion distinct(s)`);
    if (uniformTempo && cues.length >= 8) monotoneReasons.push("tempo identique partout");
    if (uniformPause && cues.length >= 8) monotoneReasons.push("mêmes pauses partout");
    const nSpeakers = Object.keys(speakers).length;
    const speakersAsExpected = (text.expect.minSpeakers === undefined || nSpeakers >= text.expect.minSpeakers) && (text.expect.maxSpeakers === undefined || nSpeakers <= text.expect.maxSpeakers);
    const presence = (pred) => share(cues.filter(pred).length, cues.length);
    const neutralByReason = histogram(neutral.map((w) => w.degradedReason));
    const last = runs.at(-1);
    return {
      id: text.id,
      title: text.title,
      expect: text.expect,
      lastAnalysis: last?.analysis ?? null,
      lastCharacters: last?.characters ?? [],
      aggregate: {
        runs: runs.length,
        windows: windows.length,
        directedWindows: directed.length,
        directedShare: share(directed.length, windows.length),
        neutralWindows: neutral.length,
        neutralShare: share(neutral.length, windows.length),
        neutralByReason,
        windowsWithResend: windows.filter((w) => w.resends > 0).length,
        resendShare: share(windows.filter((w) => w.resends > 0).length, windows.length),
        callsPerWindow: round(sum(windows.map((w) => w.llmCalls)) / Math.max(1, windows.length), 2),
        boundsAdjusted: sum(windows.map((w) => w.boundsAdjusted)),
        firstAttemptTotal: first.length,
        firstAttemptAccepted: first.filter((v) => v.accepted).length,
        firstAttemptAcceptedFaithful: first.filter((v) => v.acceptedFaithful).length,
        mustKeepTotal: sum(runs.map((r) => r.mustKeepTotal)),
        mustKeepFound: sum(runs.map((r) => r.mustKeepFound)),
        firstDirectedP50: round(percentile(fd, 0.5)),
        firstDirectedP95: round(percentile(fd, 0.95)),
        firstDirectedMs: fd.map((x) => round(x)),
        wallMsP50: round(percentile(runs.map((r) => r.wallMs), 0.5)),
        directionSegPerS: round(percentile(directionSegPerS, 0.5), 3),
        readingSegPerS: round(percentile(readingSegPerS, 0.5), 3)
      },
      quality: {
        cues: cues.length,
        cuesPerSegment: round(cues.length / Math.max(1, sum(runs.map((r) => r.directedSegments))), 2),
        speakers,
        speakersAsExpected,
        emotions,
        distinctEmotions: Object.keys(emotions).length,
        dominantEmotionShare: round(dominantShare, 3),
        intensityMean: round(mean(intensities), 2),
        intensityStdev: round(stdev(intensities), 2),
        tempo,
        pauseAfter,
        pauseBefore,
        presence: {
          emotion: presence((c) => c.emotion !== undefined),
          tempo: presence((c) => c.tempo !== undefined),
          pause: presence((c) => c.pauseBeforeMs !== undefined || c.pauseAfterMs !== undefined),
          direction: presence((c) => c.direction !== undefined),
          emphasis: presence((c) => (c.emphasis ?? []).length > 0),
          nonverbal: presence((c) => (c.nonverbal ?? []).length > 0)
        },
        monotone: monotoneReasons.length > 0,
        monotoneReasons,
        firstAttemptViolations: histogram(first.flatMap((v) => v.codes))
      },
      runs: runs.map(({ cues: _cues, calls, ...r }) => ({ ...r, callSummary: { count: calls.length, failed: calls.filter((c) => !c.ok).length } }))
    };
  });

  const directCalls = allCalls.filter((c) => c.kind === "direct" && c.ok);
  const analyzeCalls = allCalls.filter((c) => c.kind === "analyze" && c.ok);
  const genCalls = allCalls.filter((c) => c.ok && c.completionTokens && c.evalMs);
  const runsAll = results.flatMap((r) => r.runs);
  const dirRate = texts_.map((t) => t.aggregate.directionSegPerS).filter((x) => x !== null);
  const readRate = texts_.map((t) => t.aggregate.readingSegPerS).filter((x) => x !== null);

  // Simulation : grille N × budget établi sur toutes les lectures mesurées.
  const K = args.window;
  const grid = [K, 2 * K, 3 * K].map((N) => ({
    N,
    cells: [1500, 3000, 5000].map((steady) => {
      const sims = allSims.map((s) => simulate({ segChars: s.segChars, K, N, compute: s.compute, first: 10_000, steady, cps: args.cps }));
      return { steady, lateShare: round(mean(sims.map((s) => s.lateShare)), 3), maxWaitMs: round(Math.max(...sims.map((s) => s.maxWaitMs))) };
    })
  }));
  const baseSims = allSims.map((s) => simulate({ segChars: s.segChars, K, N: args.lookahead, compute: s.compute, first: 10_000, steady: 1500, cps: args.cps }));
  const firstSounds = baseSims.map((s) => s.firstSoundMs);
  grids.push(grid);

  const report = {
    meta,
    status: interrupted ? "partial" : "complete",
    ...(interrupted ? { note: "interrompu : mode jeu apparu en cours de mesure" } : {}),
    texts: texts_,
    global: {
      firstDirectedCount: firstDirected.length,
      firstNotDirected: runsAll.length - firstDirected.length,
      firstDirectedP50: round(percentile(firstDirected, 0.5)),
      firstDirectedP95: round(percentile(firstDirected, 0.95)),
      firstDirectedMin: round(Math.min(...firstDirected)),
      firstDirectedMax: round(Math.max(...firstDirected)),
      analyzeP50: round(percentile(analyzeCalls.map((c) => c.durationMs), 0.5)),
      analyzeP95: round(percentile(analyzeCalls.map((c) => c.durationMs), 0.95)),
      directP50: round(percentile(directCalls.map((c) => c.durationMs), 0.5)),
      directP95: round(percentile(directCalls.map((c) => c.durationMs), 0.95)),
      directServerTotalP50: round(percentile(directCalls.map((c) => c.totalMs).filter((x) => x !== undefined), 0.5)),
      directPromptEvalP50: round(percentile(directCalls.map((c) => c.promptEvalMs).filter((x) => x !== undefined), 0.5)),
      promptTokensP50: round(percentile(directCalls.map((c) => c.promptTokens).filter((x) => x !== undefined), 0.5), 0),
      promptTokensMax: Math.max(0, ...directCalls.map((c) => c.promptTokens ?? 0)),
      completionTokensP50: round(percentile(directCalls.map((c) => c.completionTokens).filter((x) => x !== undefined), 0.5), 0),
      tokensPerSecond: round(sum(genCalls.map((c) => c.completionTokens)) / (sum(genCalls.map((c) => c.evalMs)) / 1000)),
      contextSaturated: allCalls.filter((c) => c.contextSaturated).length,
      truncated: allCalls.filter((c) => c.truncated).length,
      failedCalls: allCalls.filter((c) => !c.ok).length,
      calls: allCalls.length,
      directionSegPerS: round(percentile(dirRate, 0.5), 3),
      readingSegPerS: round(percentile(readRate, 0.5), 3),
      throughputRatio: round(percentile(dirRate, 0.5) / percentile(readRate, 0.5), 1),
      rereadCalls,
      rereadRuns,
      rereadWindows,
      rereadFromCache
    },
    simulation: {
      grid,
      firstSoundP50: round(percentile(firstSounds, 0.5)),
      firstSoundP95: round(percentile(firstSounds, 0.95)),
      firstSoundMax: round(Math.max(...firstSounds)),
      firstOver10s: share(firstSounds.filter((x) => x > 10_000).length, firstSounds.length)
    }
  };
  writeFileSync(`${outBase}.json`, JSON.stringify(report, null, 2) + "\n");
  writeFileSync(`${outBase}.md`, markdown(report));
  console.log(`rapport : ${outBase}.json / .md (${report.status})`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
