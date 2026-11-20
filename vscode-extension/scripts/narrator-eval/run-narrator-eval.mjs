#!/usr/bin/env node
/**
 * Évaluation de fidélité du narrateur (réécriture LLM avant lecture).
 * Appelle le vrai `OllamaNarrator.transform` compilé (out/src/narrator/…), avec
 * les styles des profils narrés (out/src/profiles/defaults.js), puis applique
 * des contrôles déterministes (aucun LLM juge).
 *
 * Usage :
 *   node run-narrator-eval.mjs [--models qwen2.5:7b,qwen2.5:3b]
 *        [--profiles technical-teacher,llm-summary,quick-review]
 *        [--styles styles.json]   # remplace profile.style (id -> texte) : test de prompt
 *        [--label baseline] [--repeat 1] [--limit N] [--temperature T]
 *        [--base-url http://127.0.0.1:11434] [--out results/<label>.json]
 *   node run-narrator-eval.mjs --compare avant.json apres.json
 *
 * Métriques par exécution (texte × profil × modèle) :
 *  - essentiel / détail : `mustKeep` retrouvés (casse, accents, ponctuation ignorés ;
 *    nombres en lettres acceptés ; `alts` du jeu de données acceptés ; camelCase éclaté).
 *  - négations : une ancre (ou alt) présente avec un mot de négation/restriction à ±8 mots.
 *  - inventions : motifs `mustNotSay` présents dans la sortie ; + chiffres absents de la source.
 *  - longueur relative : caractères sortie / entrée ; JSON : `degraded` du vrai chemin.
 *  Exécutions dégradées (repli total) : exclues des taux et comptées à part. Repli partiel
 *  (blocs non couverts relus tels quels, `faithful-*`) : seuls les éléments des blocs narrés
 *  sont notés, le nombre de repli partiel est reporté.
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------- arguments
function parseArgs(argv) {
  const o = { models: "qwen2.5:7b,qwen2.5:3b", profiles: "technical-teacher,llm-summary,quick-review", label: "baseline", repeat: 1, baseUrl: "http://127.0.0.1:11434" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--compare") { o.compare = [argv[++i], argv[++i]]; continue; }
    if (!a.startsWith("--")) continue;
    const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    o[key] = argv[++i];
  }
  o.repeat = Number(o.repeat); if (o.limit) o.limit = Number(o.limit);
  if (o.temperature !== undefined) o.temperature = Number(o.temperature);
  return o;
}

// ------------------------------------------------------------ normalisation
const strip = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const camelSplit = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
const norm = (s) => strip(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const thousands = (s) => s.replace(/(\d) (\d{3})(?!\d)/g, "$1$2");

// Nombres en lettres (français), 0..999999, avec variantes « et » / accord de « cent ».
const U = ["zero","un","deux","trois","quatre","cinq","six","sept","huit","neuf","dix","onze","douze","treize","quatorze","quinze","seize","dix sept","dix huit","dix neuf"];
const T = { 20: "vingt", 30: "trente", 40: "quarante", 50: "cinquante", 60: "soixante" };
function below100(n, et) {
  if (n < 20) return U[n];
  if (n < 70) { const t = Math.floor(n / 10) * 10, u = n % 10; return u === 0 ? T[t] : `${T[t]}${u === 1 && et ? " et " : " "}${U[u]}`; }
  if (n < 80) return n === 71 && et ? "soixante et onze" : `soixante ${below100(n - 60, et)}`;
  if (n === 80) return "quatre vingts";
  if (n < 100) return `quatre vingt ${below100(n - 80, et)}`;
}
function below1000(n, et, plural) {
  const h = Math.floor(n / 100), r = n % 100;
  const head = h === 0 ? "" : h === 1 ? "cent" : `${U[h]} cent${r === 0 && plural ? "s" : ""}`;
  if (r === 0) return head;
  return `${head} ${below100(r, et)}`.trim();
}
function frWords(n) {
  if (n >= 1_000_000) return [];
  const out = new Set();
  for (const et of [true, false]) for (const plural of [true, false]) {
    const th = Math.floor(n / 1000), r = n % 1000;
    let s = "";
    if (th > 0) s = (th === 1 ? "mille" : `${below1000(th, et, false)} mille`);
    if (r > 0 || th === 0) s = `${s} ${below1000(r, et, plural)}`.trim();
    out.add(s.replace(/\s+/g, " "));
  }
  return [...out];
}
const englishSmall = ["zero","one","two","three","four","five","six","seven","eight","nine","ten"];

/** Variantes textuelles d'un élément : original, alts, chiffres -> lettres, séparateurs décimaux. */
function variantsOf(item) {
  const base = [item.t, ...(item.alts ?? [])];
  const all = new Set();
  for (const raw of base) {
    for (const r0 of new Set([raw, thousands(raw)])) {
      for (const r of new Set([r0, camelSplit(r0)])) {
        all.add(r);
        // chiffres -> lettres : suites de groupes séparés par . ou ,
        const re = /\d+(?:[.,]\d+)*/g;
        const matches = [...r.matchAll(re)];
        if (matches.length === 0 || matches.length > 2) continue;
        let variants = [r];
        for (const m of matches.reverse()) {
          const groups = m[0].split(/[.,]/);
          const sepOptions = groups.length === 2 ? [" virgule ", " point "] : [" point "];
          const spoken = [];
          const wordLists = groups.map((g) => (g.length > 1 && g.startsWith("0") ? [g.split("").map((d) => U[Number(d)]).join(" ")] : frWords(Number(g)).concat(Number(g) <= 10 ? [englishSmall[Number(g)]] : [])));
          if (wordLists.some((w) => w.length === 0)) continue;
          for (const sep of sepOptions) {
            let combos = [""];
            wordLists.forEach((w, gi) => { combos = combos.flatMap((c) => w.slice(0, 2).map((x) => (gi === 0 ? x : c + sep + x))); if (gi === 0) combos = w.slice(0, 2); });
            combos.forEach((c) => spoken.push(c));
          }
          variants = variants.flatMap((v) => [v, ...spoken.map((sp) => v.slice(0, m.index) + sp + v.slice(m.index + m[0].length))]);
        }
        variants.forEach((v) => all.add(v));
      }
    }
  }
  return [...all].map(norm).filter((v) => v.length > 0);
}

const padded = (s) => ` ${s} `;
// Pluriel tolérant : « seconde » accepte « secondes ».
function hasVariant(outNorms, variants) { return variants.some((v) => outNorms.some((o) => padded(o).includes(padded(v)) || padded(o).includes(` ${v}s `))); }
const outNormsOf = (text) => [...new Set([norm(text), norm(thousands(text)), norm(camelSplit(text))])];

const NEG_CUE = /^(ne|n|pas|jamais|sans|aucun|aucune|non|interdit|interdite|evite|evitez|eviter|impossible|not|never|no|dont|don|without|cannot|refuse|refusee|refuses|rejette|rejete|rejetee|reject|rejected|ignore|ignoree|ignores|uniquement|seulement|nulle?)$/;
function negationKept(outText, neg) {
  const flatNorm = padded(norm(outText));
  if ((neg.equiv ?? []).some((e) => flatNorm.includes(padded(norm(e))))) return true;
  const tokens = norm(outText).split(" ");
  const anchors = variantsOf({ t: neg.anchor, alts: neg.alts });
  for (const a of anchors) {
    const at = a.split(" ");
    for (let i = 0; i + at.length <= tokens.length; i++) {
      if (at.every((w, j) => tokens[i + j] === w)) {
        const lo = Math.max(0, i - 8), hi = Math.min(tokens.length, i + at.length + 8);
        for (let j = lo; j < hi; j++) if (NEG_CUE.test(tokens[j])) return true;
      }
    }
  }
  return false;
}

function novelNumbers(input, output) {
  const digits = (s) => new Set((strip(s).match(/\d+/g) ?? []).map((d) => String(Number(d))));
  const src = digits(input);
  return [...digits(output)].filter((d) => !src.has(d));
}

// -------------------------------------------------------------- évaluation
function score(entry, outText, scope) {
  const outs = outNormsOf(outText);
  // scope : Set des ids de blocs réellement narrés quand certains blocs sont tombés en repli fidèle ;
  // on ne note alors que les éléments dont le bloc source est narré (le repli verbatim ne compte pas).
  const blocks = splitBlocks(entry.text);
  const inScope = (needle) => {
    if (!scope) return true;
    const hits = blocks.filter((b) => padded(norm(b.rawText)).includes(padded(norm(needle))) || norm(b.rawText).replace(/ /g, "").includes(norm(needle).replace(/ /g, "")));
    return hits.length === 0 || hits.some((b) => scope.has(b.id));
  };
  entry = { ...entry, mustKeep: entry.mustKeep.filter((i) => inScope(i.t)), negations: entry.negations.filter((n) => inScope(n.anchor)) };
  const res = { essential: [0, 0], detail: [0, 0], missing: [], negTotal: entry.negations.length, negLost: [], inventions: [] };
  for (const item of entry.mustKeep) {
    const bucket = item.priority === "essential" ? res.essential : res.detail;
    bucket[1]++;
    if (hasVariant(outs, variantsOf(item))) bucket[0]++; else res.missing.push({ t: item.t, priority: item.priority });
  }
  for (const neg of entry.negations) if (!negationKept(outText, neg)) res.negLost.push(neg.anchor);
  const flat = strip(outText).toLowerCase();
  for (const pat of entry.mustNotSay ?? []) {
    const m = flat.match(new RegExp(pat, "i"));
    if (m) res.inventions.push({ pattern: pat, match: m[0] });
  }
  res.novelNumbers = novelNumbers(entry.text, outText);
  res.lengthRatio = outText.length / entry.text.length;
  return res;
}

function splitBlocks(text) {
  return text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean).map((rawText, i) => ({ id: `seg-${i + 1}`, type: /^```/.test(rawText) ? "code" : "paragraph", rawText }));
}

const pct = (a, b) => (b === 0 ? "n/a" : `${((100 * a) / b).toFixed(1)}%`);
function percentile(sorted, p) { if (!sorted.length) return NaN; const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1); return sorted[Math.max(0, idx)]; }
const median = (xs) => percentile([...xs].sort((a, b) => a - b), 50);

function aggregate(runs) {
  const ok = runs.filter((r) => !r.degraded && r.output.trim().length > 0);
  const sum = (f) => ok.reduce((s, r) => s + f(r), 0);
  const lat = runs.map((r) => r.latencyMs).sort((a, b) => a - b);
  return {
    runs: runs.length, usable: ok.length, degraded: runs.filter((r) => r.degraded).length, partial: runs.filter((r) => r.partialFallback).length,
    essential: [sum((r) => r.score.essential[0]), sum((r) => r.score.essential[1])],
    detail: [sum((r) => r.score.detail[0]), sum((r) => r.score.detail[1])],
    negations: [sum((r) => r.score.negTotal - r.score.negLost.length), sum((r) => r.score.negTotal)],
    inventions: sum((r) => r.score.inventions.length), novelNumbers: sum((r) => r.score.novelNumbers.length),
    lengthMedian: median(ok.map((r) => r.score.lengthRatio)), p50: percentile(lat, 50), p95: percentile(lat, 95)
  };
}

function printTable(runs, profiles, models, log) {
  log("| profil | modèle | fidélité essentielle | détails | négations | inventions (mustNotSay / chiffres neufs) | longueur méd. | dégradés / repli partiel / total | p50 (s) | p95 (s) |");
  log("|---|---|---|---|---|---|---|---|---|---|");
  for (const p of profiles) for (const m of models) {
    const a = aggregate(runs.filter((r) => r.profile === p && r.model === m));
    log(`| ${p} | ${m} | ${pct(...a.essential)} (${a.essential.join("/")}) | ${pct(...a.detail)} (${a.detail.join("/")}) | ${pct(...a.negations)} (${a.negations.join("/")}) | ${a.inventions} / ${a.novelNumbers} | ${a.lengthMedian.toFixed(2)} | ${a.degraded} / ${a.partial} / ${a.runs} | ${(a.p50 / 1000).toFixed(2)} | ${(a.p95 / 1000).toFixed(2)} |`);
  }
}

function badness(r) {
  return r.score.missing.filter((x) => x.priority === "essential").length * 3 + r.score.negLost.length * 3 + r.score.inventions.length * 4 + r.score.missing.filter((x) => x.priority === "detail").length;
}
function printWorst(runs, n, log) {
  const usable = runs.filter((r) => !r.degraded);
  const ranked = [...usable].sort((a, b) => badness(b) - badness(a)).slice(0, n);
  ranked.forEach((r, i) => {
    log(`${i + 1}. [${r.model} / ${r.profile}] ${r.id} (gravité ${badness(r)})`);
    const ess = r.score.missing.filter((x) => x.priority === "essential").map((x) => x.t);
    if (ess.length) log(`   essentiels perdus : ${ess.join(" ; ")}`);
    if (r.score.negLost.length) log(`   négations perdues (ancre) : ${r.score.negLost.join(" ; ")}`);
    if (r.score.inventions.length) log(`   inventions : ${r.score.inventions.map((x) => `« ${x.match} »`).join(" ; ")}`);
    log(`   extrait fautif : « ${r.output.replace(/\s+/g, " ").slice(0, 260)} »`);
  });
}

// --------------------------------------------------------------- compare
function compare(aPath, bPath, log) {
  const A = JSON.parse(readFileSync(aPath, "utf8")), B = JSON.parse(readFileSync(bPath, "utf8"));
  log(`Comparaison : ${A.label} -> ${B.label}`);
  log("| profil | modèle | essentiel avant | essentiel après | négations avant | négations après | inventions avant/après | longueur avant/après | p50 avant/après (s) |");
  log("|---|---|---|---|---|---|---|---|---|");
  for (const p of B.profiles) for (const m of B.models) {
    const a = aggregate(A.runs.filter((r) => r.profile === p && r.model === m)), b = aggregate(B.runs.filter((r) => r.profile === p && r.model === m));
    log(`| ${p} | ${m} | ${pct(...a.essential)} | ${pct(...b.essential)} | ${pct(...a.negations)} | ${pct(...b.negations)} | ${a.inventions}/${b.inventions} | ${a.lengthMedian.toFixed(2)}/${b.lengthMedian.toFixed(2)} | ${(a.p50 / 1000).toFixed(2)}/${(b.p50 / 1000).toFixed(2)} |`);
  }
}

// ------------------------------------------------------------------ main
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const log = (s = "") => console.log(s);
  if (opts.compare) return compare(opts.compare[0], opts.compare[1], log);

  const { OllamaNarrator } = require(join(root, "out/src/narrator/OllamaNarrator.js"));
  const { createEgressGuard } = require(join(root, "out/src/net/EgressGuard.js"));
  const defaults = require(join(root, "out/src/profiles/defaults.js"));
  const narratedProfiles = Object.fromEntries(defaults.DEFAULT_PROFILES.filter((p) => p.mode === "narrated").map((p) => [p.id, p]));
  const styleOverrides = opts.styles ? JSON.parse(readFileSync(resolve(opts.styles), "utf8")) : {};
  const profiles = opts.profiles.split(",");
  const models = opts.models.split(",");
  for (const p of profiles) if (!narratedProfiles[p]) throw new Error(`profil narré inconnu : ${p}`);

  let dataset = readFileSync(join(here, "dataset", "narrator-eval-v1.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  if (opts.limit) dataset = dataset.slice(0, opts.limit);
  const egress = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });

  const runs = [];
  for (const model of models) {
    const narrator = new OllamaNarrator({ baseUrl: opts.baseUrl, model, egress, timeoutMs: 180_000, ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}) });
    const health = await narrator.health();
    if (health.status !== "ok") throw new Error(`Ollama/${model} : ${health.status} ${health.detail ?? ""}`);
    // Échauffement non mesuré : évite d'imputer le chargement du modèle au p95.
    await narrator.transform({ segments: splitBlocks("Bonjour, ceci est un test."), profileId: "warmup", language: "fr-FR", mode: "narrated", outputContract: "narration-segments" });
    for (const profileId of profiles) {
      const style = styleOverrides[profileId] ?? narratedProfiles[profileId].style;
      for (let rep = 0; rep < opts.repeat; rep++) for (const entry of dataset) {
        const segments = splitBlocks(entry.text);
        const started = performance.now();
        const result = await narrator.transform({ segments, profileId, language: "fr-FR", mode: "narrated", style, outputContract: "narration-segments" });
        const latencyMs = performance.now() - started;
        const partialFallback = !result.degraded && result.segments.some((s) => s.id.startsWith("faithful-"));
        const narrated = result.degraded ? result.segments : result.segments.filter((s) => !s.id.startsWith("faithful-"));
        const output = narrated.map((s) => s.spokenText).join("\n");
        const scope = partialFallback ? new Set(narrated.flatMap((s) => s.sourceSegmentIds)) : undefined;
        runs.push({ id: entry.id, kind: entry.kind, profile: profileId, model, rep, latencyMs, degraded: result.degraded, degradedReason: result.degradedReason ?? null, partialFallback, scopeIds: scope ? [...scope] : null, output, score: score(entry, output, scope) });
        process.stderr.write(`\r${model} ${profileId} ${entry.id}        `);
      }
    }
  }
  process.stderr.write("\n");

  const out = opts.out ?? join(here, "results", `${opts.label}.json`);
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, JSON.stringify({ label: opts.label, date: new Date().toISOString(), models, profiles, styles: Object.fromEntries(profiles.map((p) => [p, styleOverrides[p] ?? narratedProfiles[p].style])), temperature: opts.temperature ?? null, datasetSize: dataset.length, runs }, null, 1));
  log(`# ${opts.label} — ${dataset.length} textes × ${profiles.length} profils × ${models.length} modèles (×${opts.repeat}), résultats : ${out}\n`);
  printTable(runs, profiles, models, log);
  log("\n## 5 pires cas (exécutions utilisables, toutes combinaisons)\n");
  printWorst(runs, 5, log);
}

main().catch((e) => { console.error(e); process.exit(1); });
