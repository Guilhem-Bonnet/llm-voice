#!/usr/bin/env node
/**
 * GAO-spike-valuat-001 — technique SemIf réimplémentée en TypeScript^Wnode
 * sur l'API native Ollama (arbitrage §10 de `decision-models-jev-v1.md` :
 * "Ollama n'expose pas les logprobs" est faux pour `/api/generate`, contraire
 * à ce que dit la couche compatible OpenAI de `/v1/chat/completions`).
 *
 * Principe : demander une seule lettre (A/B/C) au modèle narrateur
 * (`temperature: 0`, `num_predict: 1`), puis lire la distribution de
 * probabilité sur ce premier jeton dans `logprobs[0].top_logprobs` — vérifié
 * par appel réel le 2026-09-27 sur Ollama 0.21.0 : chaque élément de
 * `top_logprobs` a la forme `{ token, logprob, bytes }`.
 *
 * Confidentialité (AC-SEC-07) : le prompt envoyé à Ollama contient le texte
 * du message (tronqué), par nécessité (c'est l'objet même de la technique),
 * mais ce texte n'est jamais écrit sur la sortie standard, dans un fichier de
 * preuve ou dans le dépôt — seules les métriques (lettre, distribution,
 * latence) le sont.
 */

import { DATASET_PATH, DEFAULT_SEMIF_MODEL, LETTERS, OLLAMA_ENDPOINT, OllamaUnavailableError, distributionOf, formatDistribution, formatMs, median, percentile, readJsonl } from "./common.mjs";

const MAX_PROMPT_CHARS = 1500;

function buildPrompt(message) {
  const truncated = message.length > MAX_PROMPT_CHARS ? `${message.slice(0, MAX_PROMPT_CHARS)}…` : message;
  return [
    "Voici une réponse générée par un assistant IA (éventuellement tronquée) :",
    '"""',
    truncated,
    '"""',
    "",
    "Question : quel est le meilleur profil de lecture à voix haute pour cette réponse ?",
    "A. Lecture intégrale (le texte est lu mot à mot, par exemple du code ou une instruction précise)",
    "B. Résumé (une synthèse orale plus courte que le texte suffit)",
    "C. Révision rapide (un survol très bref de quelques secondes suffit)",
    "",
    "Réponds uniquement par une seule lettre parmi A, B ou C, sans aucune explication.",
    "Réponse :"
  ].join("\n");
}

async function callOllamaGenerate({ model, prompt, endpoint }) {
  let response;
  try {
    response = await fetch(`${endpoint}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        logprobs: true,
        top_logprobs: 5,
        options: { temperature: 0, num_predict: 1 }
      })
    });
  } catch (err) {
    throw new OllamaUnavailableError(`Ollama injoignable sur ${endpoint} (${err.message})`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (response.status === 404 || /not found/i.test(body)) {
      throw new OllamaUnavailableError(`Modèle "${model}" absent sur Ollama (404).`);
    }
    throw new OllamaUnavailableError(`Ollama a répondu ${response.status} sur /api/generate.`);
  }
  return response.json();
}

/** Distribution normalisée sur A/B/C à partir de `payload.logprobs[0].top_logprobs`. */
export function distributionFromResponse(payload) {
  const first = payload?.logprobs?.[0];
  if (!first) return null;
  const candidates = Array.isArray(first.top_logprobs) && first.top_logprobs.length > 0 ? first.top_logprobs : [first];
  const raw = {};
  for (const candidate of candidates) {
    const letter = (candidate.token ?? "").trim().toUpperCase();
    if (LETTERS.includes(letter) && !(letter in raw)) raw[letter] = candidate.logprob;
  }
  const probs = {};
  let sum = 0;
  for (const letter of LETTERS) {
    if (letter in raw) {
      probs[letter] = Math.exp(raw[letter]);
      sum += probs[letter];
    } else {
      probs[letter] = 0;
    }
  }
  if (sum > 0) for (const letter of LETTERS) probs[letter] = probs[letter] / sum;
  return probs;
}

export function labelFromDistribution(distribution, fallbackResponseText) {
  if (distribution) {
    const total = LETTERS.reduce((sum, letter) => sum + distribution[letter], 0);
    if (total > 0) {
      return LETTERS.reduce((best, letter) => (distribution[letter] > distribution[best] ? letter : best), "A");
    }
  }
  const fallback = (fallbackResponseText ?? "").trim().toUpperCase()[0];
  return LETTERS.includes(fallback) ? fallback : null;
}

/**
 * Classe une entrée du jeu de données par SemIf sur Ollama.
 * @returns {Promise<{ label: "A"|"B"|"C"|null, distribution: object|null, latencyMs: number }>}
 */
export async function classifySemIf(entry, { model = DEFAULT_SEMIF_MODEL, endpoint = OLLAMA_ENDPOINT } = {}) {
  const prompt = buildPrompt(entry.message);
  const start = performance.now();
  const payload = await callOllamaGenerate({ model, prompt, endpoint });
  const latencyMs = performance.now() - start;
  const distribution = distributionFromResponse(payload);
  const label = labelFromDistribution(distribution, payload.response);
  return { label, distribution, latencyMs };
}

async function main() {
  const args = process.argv.slice(2);
  const datasetPath = args.find((a) => !a.startsWith("--")) ?? DATASET_PATH;
  const modelArg = args.find((a) => a.startsWith("--model="));
  const model = modelArg ? modelArg.split("=")[1] : DEFAULT_SEMIF_MODEL;

  const entries = await readJsonl(datasetPath);
  if (entries.length === 0) {
    console.log(`SemIf/Ollama : jeu de données vide (${datasetPath}), rien à classer.`);
    return;
  }

  const labels = [];
  const latencies = [];
  let failures = 0;

  for (const entry of entries) {
    try {
      const { label, latencyMs } = await classifySemIf(entry, { model });
      labels.push(label);
      latencies.push(latencyMs);
    } catch (err) {
      if (err instanceof OllamaUnavailableError) {
        console.log(`SemIf/Ollama indisponible : ${err.message} — méthode ignorée pour les entrées restantes.`);
        break;
      }
      failures += 1;
    }
  }

  console.log(
    `SemIf/Ollama (${model}) : ${labels.length}/${entries.length} classées${failures > 0 ? `, ${failures} échec(s)` : ""} — ` +
      `distribution ${formatDistribution(distributionOf(labels))} — latence médiane ${formatMs(median(latencies))}, ` +
      `p95 ${formatMs(percentile(latencies, 95))}`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`semif-ollama.mjs : échec (${err.message})`);
    process.exitCode = 1;
  });
}
