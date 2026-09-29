#!/usr/bin/env node
/**
 * GAO-valuation-m-001 — banc d'évaluation du mode « Auto » en UNE commande :
 * toutes les approches sur le même jeu, tableau final (approche, précision
 * globale, pire catégorie, p50, p95) et variante gagnante (meilleure
 * précision parmi celles dont le p95 < 1 s).
 *
 *   node vscode-extension/scripts/decision-spike/run-all.mjs [jeu.jsonl]
 *        [--only=motif1,motif2] [--skip=motif] [--json-out=chemin] [--quick]
 *        [--reuse-from=résultats.json --reuse=json-gptoss]
 *
 * Jeu par défaut : `dataset/auto-eval-v1.jsonl` (à côté de ce script).
 * Étiquette de référence : `userLabel` si l'utilisateur a validé le jeu
 * (`apply-labels.mjs`), sinon `proposedProfile` (PROPOSITION de Claude) ; les
 * anciens jeux A/B/C du spike GAO-spike-valuat-001 restent lisibles.
 * `--quick` : saute gpt-oss:20b (~20 min sur cette machine : 15–30 s par cas).
 * `--reuse-from` + `--reuse` : reprend telles quelles (prédictions ET latences
 * par cas) les approches nommées d'un `--json-out` précédent sur le MÊME jeu
 * (vérifié par empreinte des textes et des étiquettes) — pour ne pas relancer
 * gpt-oss:20b à chaque tableau.
 *
 * Anti-fuite : aucun seuil, prompt ou exemple n'est réglé sur le jeu ; le
 * k-NN est en leave-one-out, k choisi par validation croisée imbriquée.
 * Réserve de sélection : choisir le meilleur parmi ~30 variantes sur 51 cas
 * surestime son score (biais du gagnant) — l'écart de quelques points entre
 * variantes voisines n'est pas significatif.
 *
 * Confidentialité (AC-SEC-07) : aucun texte de cas n'est affiché, seulement
 * des identifiants, profils prédits et métriques.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { FALLBACK_PROFILE_ID, PROFILE_IDS, normalizeEntry } from "./auto-profiles.mjs";
import {
  classifyJson,
  classifyRulesProfile,
  classifyRulesV2,
  classifySemIf,
  contentFreeDistribution,
  HYBRID_RULES,
  trivialProfile,
  unload,
  warmUp
} from "./auto-classifiers.mjs";
import { embedItems, knnLooProfiles } from "./embeddings-knn.mjs";
import { OllamaUnavailableError, median, percentile, readJsonl, sha256 } from "./common.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATASET = path.join(HERE, "dataset", "auto-eval-v1.jsonl");
const P95_BUDGET_MS = 1000;
const SEMIF_MODELS = ["qwen2.5:3b", "qwen2.5:7b"];
const JSON_MODEL = "gpt-oss:20b";

function parseArgs(argv) {
  const get = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  return {
    datasetPath: argv.find((a) => !a.startsWith("--")) ?? DEFAULT_DATASET,
    only: get("only")?.split(",").filter(Boolean) ?? null,
    skip: get("skip")?.split(",").filter(Boolean) ?? [],
    jsonOut: get("json-out") ?? null,
    quick: argv.includes("--quick"),
    reuseFrom: get("reuse-from") ?? null,
    reuse: get("reuse")?.split(",").filter(Boolean) ?? []
  };
}

// ---------------------------------------------------------------- métriques ---

function evaluate(items, run) {
  let correct = 0;
  const perCategory = new Map();
  const perClass = new Map(PROFILE_IDS.map((id) => [id, { correct: 0, total: 0 }]));
  for (const item of items) {
    const predicted = run.predictions.get(item.id) ?? null;
    const ok = predicted === item.gold;
    if (ok) correct += 1;
    const c = perCategory.get(item.category) ?? { correct: 0, total: 0 };
    c.total += 1;
    if (ok) c.correct += 1;
    perCategory.set(item.category, c);
    const k = perClass.get(item.gold);
    if (k) { k.total += 1; if (ok) k.correct += 1; }
  }
  let worst = null;
  for (const [category, c] of [...perCategory].sort((a, b) => a[0].localeCompare(b[0]))) {
    const rate = c.correct / c.total;
    if (!worst || rate < worst.rate) worst = { category, rate, ...c };
  }
  const lat = [...run.latencies.values()];
  return {
    accuracy: correct / items.length,
    correct,
    total: items.length,
    worst,
    perCategory,
    perClass,
    p50: median(lat),
    p95: percentile(lat, 95)
  };
}

/** Test de McNemar exact (binomial bilatéral) sur les cas discordants. */
function mcnemar(items, runA, runB) {
  let onlyA = 0;
  let onlyB = 0;
  for (const item of items) {
    const a = runA.predictions.get(item.id) === item.gold;
    const b = runB.predictions.get(item.id) === item.gold;
    if (a && !b) onlyA += 1;
    if (b && !a) onlyB += 1;
  }
  const n = onlyA + onlyB;
  const k = Math.min(onlyA, onlyB);
  let tail = 0;
  let coef = 1;
  for (let i = 0; i <= k; i += 1) {
    if (i > 0) coef = (coef * (n - i + 1)) / i;
    tail += coef;
  }
  const p = n === 0 ? 1 : Math.min(1, (2 * tail) / 2 ** n);
  return { onlyA, onlyB, p };
}

const pct = (x) => `${Math.round(x * 100)} %`;
const ms = (x) => (x === null || x === undefined ? "n/d" : `${Math.round(x)} ms`);

// ---------------------------------------------------------------- approches ---

async function runPerItem(items, classify) {
  const predictions = new Map();
  const latencies = new Map();
  const distributions = new Map();
  for (const item of items) {
    const { profileId, latencyMs, distribution } = await classify(item.text);
    predictions.set(item.id, profileId);
    latencies.set(item.id, latencyMs);
    if (distribution) distributions.set(item.id, distribution);
  }
  return { predictions, latencies, distributions };
}

function hybridOf(items, base) {
  const predictions = new Map();
  const latencies = new Map();
  for (const item of items) {
    const trivial = trivialProfile(item.text);
    if (trivial) {
      predictions.set(item.id, trivial);
      latencies.set(item.id, 0);
    } else {
      predictions.set(item.id, base.predictions.get(item.id));
      latencies.set(item.id, base.latencies.get(item.id));
    }
  }
  return { predictions, latencies };
}

function buildPlan(opts) {
  const plan = [];
  plan.push({ id: "majority", group: "départ", name: `Classe constante « ${FALLBACK_PROFILE_ID} » (plancher)`, kind: "const" });
  plan.push({ id: "rules-spike", group: "départ", name: "Témoin à règles du spike (A/B/C → profils, tel quel)", kind: "rules" });
  plan.push({ id: "rules", group: "départ", name: "Témoin à règles v2 (mêmes seuils, sémantique des profils réels)", kind: "rules-v2" });
  plan.push({ id: "knn-nomic", group: "départ", name: "Embeddings k-NN nomic-embed-text, k=3, LOO", kind: "knn", model: "nomic-embed-text", prefix: "", kGrid: [3] });
  plan.push({ id: "knn-nomic-cls", group: "e", name: "Embeddings k-NN nomic « classification: », k∈{1,3,5,7} CV imbriquée", kind: "knn", model: "nomic-embed-text", prefix: "classification: ", kGrid: [1, 3, 5, 7] });
  plan.push({ id: "knn-qwen1.5b", group: "e", name: "Embeddings k-NN qwen2.5:1.5b (LLM multilingue), k∈{1,3,5,7} CV imbriquée", kind: "knn", model: "qwen2.5:1.5b", prefix: "", kGrid: [1, 3, 5, 7] });
  plan.push({ id: "knn-nomic-cls-group", group: "e", name: "Embeddings k-NN nomic « classification: », CV par catégorie exclue", kind: "knn", model: "nomic-embed-text", prefix: "classification: ", kGrid: [1, 3, 5, 7], groupByCategory: true });
  plan.push({ id: "knn-qwen1.5b-group", group: "e", name: "Embeddings k-NN qwen2.5:1.5b, CV par catégorie exclue", kind: "knn", model: "qwen2.5:1.5b", prefix: "", kGrid: [1, 3, 5, 7], groupByCategory: true });
  for (const model of SEMIF_MODELS) {
    const tag = model.split(":")[1];
    const a = tag === "7b" ? "a" : "départ";
    plan.push({ id: `semif-${tag}-letters`, group: a, name: `SemIf ${model} — lettres A–D (prompt du spike)`, kind: "semif", model, style: "letters" });
    plan.push({ id: `semif-${tag}-letters-calib`, group: "g", name: `SemIf ${model} — lettres + calibration contextuelle`, kind: "semif", model, style: "letters", calib: true });
    plan.push({ id: `semif-${tag}-rich-letters`, group: "b", name: `SemIf ${model} — prompt enrichi, lettres`, kind: "semif", model, style: "rich-letters" });
    plan.push({ id: `semif-${tag}-rich-names`, group: "c", name: `SemIf ${model} — prompt enrichi, noms`, kind: "semif", model, style: "rich-names" });
    plan.push({ id: `semif-${tag}-rich-names-calib`, group: "g", name: `SemIf ${model} — enrichi, noms + calibration`, kind: "semif", model, style: "rich-names", calib: true });
    plan.push({ id: `semif-${tag}-rich-names-guide`, group: "b+", name: `SemIf ${model} — enrichi, noms + consignes (circulaire)`, kind: "semif", model, style: "rich-names", guidelines: true });
  }
  if (!opts.quick) plan.push({ id: "json-gptoss", group: "f", name: `${JSON_MODEL} — JSON contraint (think low), plafond`, kind: "json", model: JSON_MODEL });
  const keep = (p) => (!opts.only || opts.only.some((m) => p.id.includes(m))) && !opts.skip.some((m) => p.id.includes(m));
  return plan.filter(keep);
}

async function execute(step, items) {
  switch (step.kind) {
    case "const":
      return { predictions: new Map(items.map((i) => [i.id, FALLBACK_PROFILE_ID])), latencies: new Map(items.map((i) => [i.id, 0])) };
    case "rules":
      return runPerItem(items, async (text) => classifyRulesProfile(text));
    case "rules-v2":
      return runPerItem(items, async (text) => classifyRulesV2(text));
    case "knn": {
      const { vectors, latencies } = await embedItems(items, { model: step.model, prefix: step.prefix });
      const loo = knnLooProfiles(items, vectors, step.kGrid, { groupByCategory: step.groupByCategory === true });
      const ks = [...loo.values()].map((v) => v.k);
      const kCounts = step.kGrid.map((k) => `${k}:${ks.filter((x) => x === k).length}`).join(" ");
      return { predictions: new Map([...loo].map(([id, v]) => [id, v.profileId])), latencies, note: `k choisis ${kCounts}` };
    }
    case "semif": {
      await warmUp(step.model);
      let calibration = null;
      if (step.calib) calibration = await contentFreeDistribution({ model: step.model, style: step.style, guidelines: step.guidelines });
      const run = await runPerItem(items, (text) => classifySemIf(text, { model: step.model, style: step.style, guidelines: step.guidelines, calibration }));
      if (calibration) run.note = `réf. N/A ${PROFILE_IDS.map((id) => `${id.split("-")[0]}=${calibration[id].toFixed(2)}`).join(" ")}`;
      return run;
    }
    case "json": {
      for (const m of SEMIF_MODELS) await unload(m);
      await warmUp(step.model);
      let n = 0;
      const run = await runPerItem(items, async (text) => {
        const r = await classifyJson(text, { model: step.model });
        n += 1;
        process.stderr.write(`    ${step.id} ${n}/${items.length} ${Math.round(r.latencyMs)} ms\n`);
        return r;
      });
      await unload(step.model);
      return run;
    }
    default:
      throw new Error(`approche inconnue ${step.kind}`);
  }
}

// ---------------------------------------------------------------- principal ---

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const raw = await readJsonl(opts.datasetPath);
  const items = raw.map(normalizeEntry).filter((i) => i.text.length > 0 && i.gold);
  if (items.length === 0) {
    console.log(`Jeu vide ou non étiqueté (${opts.datasetPath}) — rien à mesurer.`);
    return;
  }
  const sources = new Map();
  for (const i of items) sources.set(i.labelSource, (sources.get(i.labelSource) ?? 0) + 1);
  const bySource = [...sources].map(([s, n]) => `${s}: ${n}`).join(", ");
  console.log(`Jeu : ${path.relative(process.cwd(), opts.datasetPath)} — ${items.length} cas, ${new Set(items.map((i) => i.category)).size} catégories, étiquettes (${bySource}).`);
  if (sources.has("claude-proposed")) {
    console.log("AVERTISSEMENT : étiquettes PROPOSÉES par Claude, non validées — les précisions mesurent l'accord avec ces propositions, pas le goût de l'utilisateur.");
  }
  const classDist = PROFILE_IDS.map((id) => `${id} ${items.filter((i) => i.gold === id).length}`).join(", ");
  console.log(`Répartition des étiquettes : ${classDist}. Hybride (d) : règles si < ${HYBRID_RULES.shortChars} car. ou code ≥ ${HYBRID_RULES.codeRatio * 100} %.`);
  console.log("");

  const fingerprint = sha256(JSON.stringify(items.map((i) => [i.id, i.text, i.gold])));
  let reused = null;
  if (opts.reuseFrom) {
    const previous = JSON.parse(await fs.readFile(opts.reuseFrom, "utf8"));
    if (previous.fingerprint !== fingerprint) throw new Error(`--reuse-from : ${opts.reuseFrom} ne porte pas sur le même jeu (empreinte différente)`);
    reused = new Map(previous.approaches.filter((a) => opts.reuse.includes(a.id) && a.predictions).map((a) => [a.id, a]));
  }

  const plan = buildPlan(opts);
  const runs = [];
  for (const step of plan) {
    const t0 = performance.now();
    try {
      const prior = reused?.get(step.id);
      const run = prior
        ? {
            predictions: new Map(Object.entries(prior.predictions)),
            latencies: new Map(Object.entries(prior.latenciesMs)),
            note: `repris de ${path.basename(opts.reuseFrom)} (${prior.measuredAt})`,
            measuredAt: prior.measuredAt
          }
        : await execute(step, items);
      if (!prior) run.measuredAt = new Date().toISOString();
      runs.push({ step, run, metrics: evaluate(items, run) });
      if (step.kind === "semif" || step.kind === "knn") {
        const h = hybridOf(items, run);
        runs.push({ step: { ...step, id: `hybrid+${step.id}`, group: "d", name: `Hybride (d) règles triviales + ${step.name.replace(/^SemIf /, "")}`, guidelines: step.guidelines }, run: h, metrics: evaluate(items, h) });
      }
      process.stderr.write(`  ${step.id} : ${((performance.now() - t0) / 1000).toFixed(1)} s\n`);
    } catch (err) {
      if (!(err instanceof OllamaUnavailableError)) throw err;
      runs.push({ step, run: null, metrics: null, error: err.message });
    }
  }

  console.log("| Approche | Groupe | Précision | Pire catégorie | p50 | p95 | Note |");
  console.log("|---|---|---:|---|---:|---:|---|");
  for (const { step, run, metrics, error } of runs) {
    if (!metrics) {
      console.log(`| ${step.name} | ${step.group} | indisponible | — | — | — | ${error} |`);
      continue;
    }
    const w = metrics.worst;
    console.log(
      `| ${step.name} | ${step.group} | ${pct(metrics.accuracy)} (${metrics.correct}/${metrics.total}) | ${w.category} ${w.correct}/${w.total} | ` +
        `${ms(metrics.p50)} | ${ms(metrics.p95)} | ${run.note ?? ""} |`
    );
  }

  const rules = runs.find((r) => r.step.id === "rules" && r.metrics);
  const rulesSpike = runs.find((r) => r.step.id === "rules-spike" && r.metrics);
  const eligible = runs.filter((r) => r.metrics && r.step.kind !== "const" && r.metrics.p95 !== null && r.metrics.p95 < P95_BUDGET_MS);
  eligible.sort((a, b) => b.metrics.accuracy - a.metrics.accuracy || a.metrics.p95 - b.metrics.p95);
  const winner = eligible[0];
  console.log("");
  if (winner) {
    const m = winner.metrics;
    console.log(`GAGNANTE (p95 < ${P95_BUDGET_MS} ms) : ${winner.step.name} [${winner.step.id}] — ${pct(m.accuracy)} (${m.correct}/${m.total}), p50 ${ms(m.p50)}, p95 ${ms(m.p95)}.`);
    const nonCircular = eligible.find((r) => !r.step.guidelines && !r.step.id.includes("guide"));
    if (winner.step.guidelines && nonCircular) {
      const n = nonCircular.metrics;
      console.log(`Meilleure variante SANS consignes circulaires : ${nonCircular.step.name} [${nonCircular.step.id}] — ${pct(n.accuracy)} (${n.correct}/${n.total}), p95 ${ms(n.p95)}.`);
    }
    if (winner.step.kind === "knn") {
      const groupId = `${winner.step.id.replace(/^hybrid\+/, "hybrid+")}-group`;
      const grouped = runs.find((r) => r.step.id === groupId && r.metrics);
      if (grouped) console.log(`Même k-NN, catégorie du cas exclue (généralisation) : ${pct(grouped.metrics.accuracy)} (${grouped.metrics.correct}/${grouped.metrics.total}). Un k-NN exige un jeu étiqueté livré avec le produit.`);
      const zeroShot = eligible.find((r) => r.step.kind === "semif" && !r.step.guidelines);
      if (zeroShot) console.log(`Meilleure variante SANS exemples étiquetés (SemIf) : ${zeroShot.step.name} [${zeroShot.step.id}] — ${pct(zeroShot.metrics.accuracy)} (${zeroShot.metrics.correct}/${zeroShot.metrics.total}), p50 ${ms(zeroShot.metrics.p50)}, p95 ${ms(zeroShot.metrics.p95)}.`);
    }
    if (rules) {
      const t = mcnemar(items, winner.run, rules.run);
      console.log(`Écart avec le témoin à règles v2 : ${Math.round((m.accuracy - rules.metrics.accuracy) * 100)} points ; McNemar exact : gagnante seule juste ${t.onlyA}, témoin seul juste ${t.onlyB}, p = ${t.p.toFixed(4)}.`);
      if (rulesSpike) console.log(`(Témoin du spike tel quel : ${Math.round((m.accuracy - rulesSpike.metrics.accuracy) * 100)} points d'écart.)`);
    }
    console.log("");
    console.log(`Détail par catégorie (témoin v2 → gagnante) :`);
    console.log("| Catégorie | Règles | Gagnante |");
    console.log("|---|---:|---:|");
    for (const [cat, c] of [...m.perCategory].sort((a, b) => a[0].localeCompare(b[0]))) {
      const r = rules?.metrics.perCategory.get(cat);
      console.log(`| ${cat} | ${r ? `${r.correct}/${r.total}` : "n/d"} | ${c.correct}/${c.total} |`);
    }
    console.log("");
    console.log("Rappel par profil (témoin v2 → gagnante) : " + PROFILE_IDS.map((id) => {
      const r = rules?.metrics.perClass.get(id);
      const g = m.perClass.get(id);
      return `${id} ${r ? `${r.correct}/${r.total}` : "n/d"} → ${g.correct}/${g.total}`;
    }).join(" ; "));
  } else {
    console.log(`Aucune approche sous ${P95_BUDGET_MS} ms en p95.`);
  }

  if (opts.jsonOut) {
    const dump = {
      dataset: path.relative(process.cwd(), opts.datasetPath),
      generatedAt: new Date().toISOString(),
      fingerprint,
      labelSources: Object.fromEntries(sources),
      approaches: runs.map(({ step, run, metrics, error }) => ({
        id: step.id,
        group: step.group,
        name: step.name,
        error: error ?? null,
        accuracy: metrics?.accuracy ?? null,
        worstCategory: metrics?.worst ? `${metrics.worst.category} ${metrics.worst.correct}/${metrics.worst.total}` : null,
        p50Ms: metrics?.p50 ?? null,
        p95Ms: metrics?.p95 ?? null,
        measuredAt: run?.measuredAt ?? null,
        predictions: run ? Object.fromEntries(run.predictions) : null,
        latenciesMs: run ? Object.fromEntries([...run.latencies].map(([k, v]) => [k, Math.round(v * 10) / 10])) : null
      })),
      winner: winner?.step.id ?? null
    };
    await fs.writeFile(opts.jsonOut, JSON.stringify(dump, null, 2) + "\n");
  }
}

main().catch((err) => {
  console.error(`run-all.mjs : échec (${err.message})`);
  process.exitCode = 1;
});
