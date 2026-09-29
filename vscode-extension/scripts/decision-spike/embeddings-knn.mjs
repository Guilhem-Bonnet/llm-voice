#!/usr/bin/env node
/**
 * GAO-spike-valuat-001 — piste classifieur par embeddings (k-NN).
 *
 * Ollama sert déjà `nomic-embed-text` (`POST /api/embed`) : plus rapide à
 * essayer qu'un nouveau modèle, mais NON multilingue — §10 de
 * `decision-models-jev-v1.md` note qu'un modèle multilingue serait
 * préférable pour du français. Retenu ici uniquement comme piste de mesure,
 * pas comme choix final.
 *
 * En l'absence de labels (mode non étiqueté, aujourd'hui), ce script calcule
 * et met en cache les embeddings de chaque entrée, mais N'EXÉCUTE PAS de
 * k-NN : un classifieur par plus proches voisins a besoin d'exemples déjà
 * étiquetés pour voter. Le k-NN "leave-one-out" (chaque exemple étiqueté est
 * prédit à partir des autres exemples étiquetés, jamais de lui-même) ne
 * tourne que lorsque des labels existent.
 *
 * Confidentialité (AC-SEC-07) : le cache d'embeddings ne stocke jamais le
 * texte du message, seulement un hash SHA-256 (pour détecter un changement)
 * et le vecteur.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  DATASET_PATH,
  DEFAULT_EMBED_MODEL,
  EMBED_CACHE_PATH,
  OLLAMA_ENDPOINT,
  OllamaUnavailableError,
  cosineSimilarity,
  distributionOf,
  formatDistribution,
  formatMs,
  median,
  percentile,
  readJsonl,
  sha256
} from "./common.mjs";

async function loadCache(cachePath) {
  try {
    const raw = await fs.readFile(cachePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return { model: null, entries: {} };
    return { model: null, entries: {} };
  }
}

async function saveCache(cachePath, cache) {
  await fs.mkdir(path.dirname(cachePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(cachePath, JSON.stringify(cache), { mode: 0o600 });
}

async function callOllamaEmbed({ model, input, endpoint }) {
  let response;
  try {
    response = await fetch(`${endpoint}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, input })
    });
  } catch (err) {
    throw new OllamaUnavailableError(`Ollama injoignable sur ${endpoint} (${err.message})`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (response.status === 404 || /not found/i.test(body)) {
      throw new OllamaUnavailableError(`Modèle "${model}" absent sur Ollama (404).`);
    }
    throw new OllamaUnavailableError(`Ollama a répondu ${response.status} sur /api/embed.`);
  }
  return response.json();
}

/**
 * Calcule (ou récupère du cache) le vecteur d'embedding de chaque entrée.
 * @returns {Promise<{ vectors: Map<string, number[]>, latencies: number[], usedCache: number, computed: number }>}
 */
export async function computeEmbeddings(entries, { model = DEFAULT_EMBED_MODEL, endpoint = OLLAMA_ENDPOINT, cachePath = EMBED_CACHE_PATH } = {}) {
  const cache = await loadCache(cachePath);
  const vectors = new Map();
  const latencies = [];
  let usedCache = 0;
  let computed = 0;

  for (const entry of entries) {
    const hash = sha256(entry.message);
    const cached = cache.entries?.[entry.id];
    if (cached && cached.hash === hash && cache.model === model) {
      vectors.set(entry.id, cached.vector);
      usedCache += 1;
      continue;
    }
    const start = performance.now();
    const payload = await callOllamaEmbed({ model, input: entry.message, endpoint });
    latencies.push(performance.now() - start);
    const vector = payload.embeddings?.[0];
    if (!vector) continue;
    vectors.set(entry.id, vector);
    cache.entries = cache.entries ?? {};
    cache.entries[entry.id] = { hash, vector };
    cache.model = model;
    computed += 1;
  }

  await saveCache(cachePath, cache);
  return { vectors, latencies, usedCache, computed };
}

/**
 * k-NN leave-one-out : pour chaque entrée étiquetée, prédit son label à
 * partir des `k` voisins les plus proches PARMI LES AUTRES entrées
 * étiquetées (jamais elle-même). Ne s'exécute que si au moins 2 entrées
 * étiquetées existent.
 */
export function knnLeaveOneOut(entries, vectors, k = 3) {
  const labeled = entries.filter((e) => e.label === "A" || e.label === "B" || e.label === "C");
  if (labeled.length < 2) {
    return { predictions: new Map(), note: `pas assez d'exemples étiquetés (${labeled.length} < 2)` };
  }
  const predictions = new Map();
  for (const target of labeled) {
    const targetVector = vectors.get(target.id);
    if (!targetVector) continue;
    const neighbours = labeled
      .filter((o) => o.id !== target.id)
      .filter((o) => vectors.has(o.id))
      .map((o) => ({ label: o.label, sim: cosineSimilarity(targetVector, vectors.get(o.id)) }))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, k);
    if (neighbours.length === 0) continue;
    const votes = { A: 0, B: 0, C: 0 };
    for (const n of neighbours) votes[n.label] += 1;
    const winner = ["A", "B", "C"].reduce((best, l) => (votes[l] > votes[best] ? l : best), "A");
    predictions.set(target.id, winner);
  }
  return { predictions, note: null };
}

/**
 * GAO-valuation-m-001 — embeddings SANS cache (la latence mesurée est celle
 * d'un appel réel, modèle déjà chargé) pour les quatre profils réels.
 * `prefix` : préfixe de tâche éventuel (nomic-embed-text documente
 * « classification: »), fixé a priori.
 * @returns {Promise<{ vectors: Map<string, number[]>, latencies: Map<string, number> }>}
 */
export async function embedItems(items, { model, prefix = "", endpoint = OLLAMA_ENDPOINT }) {
  await callOllamaEmbed({ model, input: "chauffe", endpoint }); // charge le modèle hors mesure
  const vectors = new Map();
  const latencies = new Map();
  for (const item of items) {
    const start = performance.now();
    const payload = await callOllamaEmbed({ model, input: `${prefix}${item.text}`, endpoint });
    latencies.set(item.id, performance.now() - start);
    const vector = payload.embeddings?.[0];
    if (vector) vectors.set(item.id, vector);
  }
  return { vectors, latencies };
}

function knnVote(targetVector, pool, vectors, k) {
  const neighbours = pool
    .map((o) => ({ gold: o.gold, sim: cosineSimilarity(targetVector, vectors.get(o.id)) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, k);
  const votes = new Map();
  for (const n of neighbours) {
    const v = votes.get(n.gold) ?? { count: 0, sim: 0 };
    v.count += 1;
    v.sim += n.sim;
    votes.set(n.gold, v);
  }
  let best = null;
  for (const [gold, v] of votes) {
    if (!best || v.count > best.v.count || (v.count === best.v.count && v.sim > best.v.sim)) best = { gold, v };
  }
  return best ? best.gold : null;
}

/**
 * k-NN leave-one-out sur étiquettes `gold` (profils). Si `kGrid` contient
 * plusieurs valeurs, k est choisi PAR CAS par un LOO interne sur les n-1
 * autres exemples seulement (validation croisée imbriquée : le cas testé ne
 * participe jamais au choix de k). Avec `groupByCategory`, toute sa catégorie
 * est exclue (voisins ET choix de k).
 * @returns {Map<string, { profileId: string|null, k: number }>}
 */
export function knnLooProfiles(items, vectors, kGrid = [3], { groupByCategory = false } = {}) {
  const labeled = items.filter((i) => i.gold && vectors.has(i.id));
  const out = new Map();
  // `groupByCategory` : validation « leave-one-category-out » — le cas testé
  // n'a aucun voisin de SA catégorie (les cas d'une même catégorie, écrits par
  // le même auteur, se ressemblent : le LOO simple en profite).
  const apart = (a, b) => a.id !== b.id && (!groupByCategory || a.category !== b.category);
  for (const target of labeled) {
    const pool = labeled.filter((o) => apart(o, target));
    let k = kGrid[0];
    if (kGrid.length > 1) {
      let bestScore = -1;
      for (const candidate of kGrid) {
        let correct = 0;
        for (const inner of pool) {
          const innerPool = pool.filter((o) => apart(o, inner));
          if (knnVote(vectors.get(inner.id), innerPool, vectors, candidate) === inner.gold) correct += 1;
        }
        if (correct > bestScore) { bestScore = correct; k = candidate; }
      }
    }
    out.set(target.id, { profileId: knnVote(vectors.get(target.id), pool, vectors, k), k });
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const datasetPath = args.find((a) => !a.startsWith("--")) ?? DATASET_PATH;
  const modelArg = args.find((a) => a.startsWith("--model="));
  const model = modelArg ? modelArg.split("=")[1] : DEFAULT_EMBED_MODEL;

  const entries = await readJsonl(datasetPath);
  if (entries.length === 0) {
    console.log(`Embeddings k-NN : jeu de données vide (${datasetPath}), rien à calculer.`);
    return;
  }

  let embeddingsResult;
  try {
    embeddingsResult = await computeEmbeddings(entries, { model });
  } catch (err) {
    if (err instanceof OllamaUnavailableError) {
      console.log(`Embeddings k-NN indisponible : ${err.message}`);
      return;
    }
    throw err;
  }

  const { vectors, latencies, usedCache, computed } = embeddingsResult;
  console.log(
    `Embeddings (${model}) : ${vectors.size}/${entries.length} vecteurs (${computed} calculés, ${usedCache} en cache) — ` +
      `latence médiane ${formatMs(median(latencies))}, p95 ${formatMs(percentile(latencies, 95))}`
  );

  const { predictions, note } = knnLeaveOneOut(entries, vectors);
  if (note) {
    console.log(`k-NN leave-one-out non exécuté : ${note} (jeu non étiqueté aujourd'hui).`);
    return;
  }
  console.log(`k-NN leave-one-out : ${predictions.size} prédiction(s) — distribution ${formatDistribution(distributionOf([...predictions.values()]))}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`embeddings-knn.mjs : échec (${err.message})`);
    process.exitCode = 1;
  });
}
