#!/usr/bin/env node
/**
 * GAO-valuation-m-001 — classifieurs du mode « Auto » sur les QUATRE profils
 * réels (`auto-profiles.mjs`). Chaque classifieur renvoie
 * `{ profileId, distribution, latencyMs }` ; `profileId` vaut `null` si le
 * modèle n'a rien produit d'exploitable (compté comme une erreur).
 *
 * Variantes (brief de la carte) :
 *  - témoin à règles : `classifyRules` du spike (A/B/C) converti en profils ;
 *  - SemIf « lettres » : prompt du spike étendu à 4 options A–D (départ) ;
 *  - (b) prompt enrichi : libellé + description + 1 exemple par profil
 *    (`PROMPT_EXAMPLES`, hors jeu) + métadonnées (longueur, part de code) ;
 *  - (c) options par NOM (`optionName`), logprobs du premier jeton rapportées
 *    au nom dont il est un préfixe ;
 *  - (g) calibration contextuelle (Zhao et al. 2021) : distribution divisée par
 *    celle obtenue sur une entrée vide (« N/A ») — aucune étiquette utilisée ;
 *  - (f) gpt-oss:20b, sortie JSON contrainte par `format` (schéma enum) ;
 *  - (d) hybride et (e) embeddings : voir `hybrid()` et `embeddings-knn.mjs`.
 *
 * Aucune entrée n'est jamais journalisée ; seul Ollama en loopback est appelé.
 */

import { RULES, classifyRules } from "./baseline-rules.mjs";
import { AUTO_PROFILES, FALLBACK_PROFILE_ID, LEGACY_LETTER_TO_PROFILE, PROFILE_IDS, PROMPT_EXAMPLES } from "./auto-profiles.mjs";
import { OLLAMA_ENDPOINT, OllamaUnavailableError, analyzeMessage, codeRatio } from "./common.mjs";

export const MAX_PROMPT_CHARS = 1500;
export const TOP_LOGPROBS = 20;
export const KEEP_ALIVE = "30m";

function truncate(text) {
  return text.length > MAX_PROMPT_CHARS ? `${text.slice(0, MAX_PROMPT_CHARS)}…` : text;
}

// ---------------------------------------------------------------- règles ---

/** Témoin : logique du spike inchangée, lettres converties (A fidèle, B résumé, C révision). */
export function classifyRulesProfile(text) {
  const start = performance.now();
  const letter = classifyRules(analyzeMessage(text));
  return { profileId: LEGACY_LETTER_TO_PROFILE[letter], distribution: null, latencyMs: performance.now() - start };
}

/**
 * Témoin v2 : MÊMES signaux et MÊMES seuils que le spike (`RULES`), mais
 * sémantique des profils réels : le spike envoyait les textes courts vers
 * « C = survol très bref », or le profil réel `quick-review` est une
 * RÉÉCRITURE narrée (« concepts, pièges, essentiel ») — pour un texte court,
 * le survol le plus bref est la lecture telle quelle. Règles figées a priori :
 * code, court ou questions → lecture fidèle ; long sans code → résumé ;
 * sinon lecture fidèle. Aucun seuil réglé sur le jeu.
 */
export function classifyRulesV2(text) {
  const start = performance.now();
  const m = analyzeMessage(text);
  let profileId = FALLBACK_PROFILE_ID;
  if (m.codeRatio >= RULES.codeRatioThreshold) profileId = FALLBACK_PROFILE_ID;
  else if (m.chars <= RULES.shortChars) profileId = FALLBACK_PROFILE_ID;
  else if (m.questionMarks >= RULES.questionThreshold) profileId = FALLBACK_PROFILE_ID;
  else if (m.chars >= RULES.longChars) profileId = "llm-summary";
  return { profileId, distribution: null, latencyMs: performance.now() - start };
}

/**
 * (d) Cas triviaux, seuils fixés A PRIORI (avant toute mesure, jamais réglés
 * sur le jeu) : très court (< 200 caractères) ou essentiellement du code
 * (≥ 60 % dans des blocs ```), lus tels quels.
 */
export const HYBRID_RULES = { shortChars: 200, codeRatio: 0.6 };
export function trivialProfile(text) {
  if (text.length < HYBRID_RULES.shortChars) return FALLBACK_PROFILE_ID;
  if (codeRatio(text) >= HYBRID_RULES.codeRatio) return FALLBACK_PROFILE_ID;
  return null;
}

// ---------------------------------------------------------------- prompts ---

const SPIKE_OPTION_TEXT = {
  "faithful-local": "Lecture intégrale (le texte est lu mot à mot, par exemple du code ou une instruction précise)",
  "llm-summary": "Résumé (une synthèse orale plus courte que le texte suffit)",
  "quick-review": "Révision rapide (un survol très bref de quelques secondes suffit)",
  "technical-teacher": "Explication pédagogique (le contenu est reformulé oralement pour être compris)"
};

/** Prompt du spike GAO-spike-valuat-001, étendu à la 4e option (profil réel `technical-teacher`). */
function buildLetterPrompt(text) {
  return [
    "Voici une réponse générée par un assistant IA (éventuellement tronquée) :",
    '"""',
    truncate(text),
    '"""',
    "",
    "Question : quel est le meilleur profil de lecture à voix haute pour cette réponse ?",
    ...AUTO_PROFILES.map((p) => `${p.letter}. ${SPIKE_OPTION_TEXT[p.id]}`),
    "",
    "Réponds uniquement par une seule lettre parmi A, B, C ou D, sans aucune explication.",
    "Réponse :"
  ].join("\n");
}

function metadataLine(text) {
  const m = analyzeMessage(text);
  return `(Longueur : ${m.chars} caractères ; part de code : ${Math.round(m.codeRatio * 100)} % ; points d'interrogation : ${m.questionMarks}.)`;
}

/**
 * (b)/(c) Prompt enrichi : libellé + description + exemple par profil, options
 * par lettre ou par nom. `guidelines` (variante « b+ ») ajoute une ligne de
 * consignes qui reprend le GUIDE D'ÉTIQUETAGE de Claude : elle peut gonfler
 * l'accord avec les étiquettes proposées (circularité) — à re-mesurer sur les
 * étiquettes de l'utilisateur avant de la retenir.
 */
function buildRichPrompt(text, { byName, guidelines = false }) {
  const key = (p) => (byName ? p.optionName : p.letter);
  const lines = [
    "Tu choisis comment lire à voix haute la réponse finale d'un assistant de programmation.",
    "Profils disponibles :",
    ""
  ];
  for (const p of AUTO_PROFILES) {
    lines.push(`${key(p)} — « ${p.label} » : ${p.description}`);
    lines.push(`   Exemple typique : « ${PROMPT_EXAMPLES[p.id]} »`);
  }
  if (guidelines) lines.push(
    "",
    "Règles : une réponse courte, une question posée à l'utilisateur ou une commande exacte se lit telle quelle ; " +
      "un compte rendu de travail se résume ; une explication de concept ou un tutoriel s'explique ; " +
      "une revue, une liste de pièges ou un aide-mémoire se réduit à l'essentiel."
  );
  lines.push(
    "",
    "Réponse à lire (éventuellement tronquée) :",
    '"""',
    truncate(text),
    '"""',
    metadataLine(text),
    "",
    byName
      ? `Réponds uniquement par un seul mot parmi : ${AUTO_PROFILES.map((p) => p.optionName).join(", ")}.`
      : `Réponds uniquement par une seule lettre parmi ${AUTO_PROFILES.map((p) => p.letter).join(", ")}.`,
    "Réponse :"
  );
  return lines.join("\n");
}

// ----------------------------------------------------------------- Ollama ---

async function postJson(path, body, endpoint = OLLAMA_ENDPOINT) {
  let response;
  try {
    response = await fetch(`${endpoint}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (err) {
    throw new OllamaUnavailableError(`Ollama injoignable sur ${endpoint} (${err.message})`);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    if (response.status === 404 || /not found/i.test(text)) throw new OllamaUnavailableError(`Modèle « ${body.model} » absent (404).`);
    throw new OllamaUnavailableError(`Ollama a répondu ${response.status} sur ${path}.`);
  }
  return response.json();
}

async function firstTokenLogprobs(model, prompt) {
  const payload = await postJson("/api/generate", {
    model,
    prompt,
    stream: false,
    logprobs: true,
    top_logprobs: TOP_LOGPROBS,
    keep_alive: KEEP_ALIVE,
    options: { temperature: 0, num_predict: 1 }
  });
  const first = payload?.logprobs?.[0];
  if (!first) return { candidates: [], response: payload?.response ?? "" };
  const candidates = Array.isArray(first.top_logprobs) && first.top_logprobs.length > 0 ? first.top_logprobs : [first];
  return { candidates, response: payload.response ?? "" };
}

function normalizeToken(token) {
  return (token ?? "").toLowerCase().replace(/^[^\p{L}]+/u, "").trim();
}

/**
 * Agrège la masse de probabilité du premier jeton par profil. Lettres : jeton
 * exactement égal à la lettre. Noms : jeton (sans ponctuation de tête) préfixe
 * du nom d'option — les initiales f/r/e/p étant distinctes, un jeton ne compte
 * jamais pour deux profils. Distribution renormalisée sur les profils.
 */
export function aggregate(candidates, { byName }) {
  const mass = Object.fromEntries(PROFILE_IDS.map((id) => [id, 0]));
  const seen = new Set();
  for (const c of candidates) {
    const raw = (c.token ?? "").trim();
    const norm = byName ? normalizeToken(raw) : raw.toUpperCase();
    if (!norm || seen.has(`${raw}`)) continue;
    seen.add(raw);
    for (const p of AUTO_PROFILES) {
      const hit = byName ? p.optionName.startsWith(norm) : norm === p.letter;
      if (hit) { mass[p.id] += Math.exp(c.logprob); break; }
    }
  }
  const total = Object.values(mass).reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  for (const id of PROFILE_IDS) mass[id] /= total;
  return mass;
}

export function argmax(distribution) {
  if (!distribution) return null;
  return PROFILE_IDS.reduce((best, id) => (distribution[id] > distribution[best] ? id : best), PROFILE_IDS[0]);
}

/**
 * SemIf générique. `style` : "letters" (prompt du spike), "rich-letters" (b),
 * "rich-names" (c). `calibration` : distribution de référence (g) ou null.
 */
export async function classifySemIf(text, { model, style, guidelines = false, calibration = null }) {
  const byName = style === "rich-names";
  const prompt = style === "letters" ? buildLetterPrompt(text) : buildRichPrompt(text, { byName, guidelines });
  const start = performance.now();
  const { candidates } = await firstTokenLogprobs(model, prompt);
  const latencyMs = performance.now() - start;
  let distribution = aggregate(candidates, { byName });
  if (distribution && calibration) {
    const adjusted = Object.fromEntries(PROFILE_IDS.map((id) => [id, distribution[id] / Math.max(calibration[id], 1e-4)]));
    const total = Object.values(adjusted).reduce((a, b) => a + b, 0);
    distribution = Object.fromEntries(PROFILE_IDS.map((id) => [id, adjusted[id] / total]));
  }
  return { profileId: argmax(distribution), distribution, latencyMs };
}

/** (g) Distribution « sans contenu » : même prompt, entrée « N/A ». Ne lit aucune étiquette. */
export async function contentFreeDistribution({ model, style, guidelines = false }) {
  const byName = style === "rich-names";
  const prompt = style === "letters" ? buildLetterPrompt("N/A") : buildRichPrompt("N/A", { byName, guidelines });
  const { candidates } = await firstTokenLogprobs(model, prompt);
  return aggregate(candidates, { byName });
}

/** (f) Sortie JSON contrainte par schéma (`format`), raisonnement « low » pour gpt-oss. */
export async function classifyJson(text, { model, think = "low", guidelines = false }) {
  const prompt = buildRichPrompt(text, { byName: true, guidelines }).replace(
    /Réponds uniquement par un seul mot parmi : .*\nRéponse :$/,
    `Réponds en JSON {"profile": <id>} avec id parmi : ${AUTO_PROFILES.map((p) => `${p.id} (= ${p.optionName})`).join(", ")}.`
  );
  const start = performance.now();
  const payload = await postJson("/api/chat", {
    model,
    messages: [{ role: "user", content: prompt }],
    stream: false,
    think,
    keep_alive: KEEP_ALIVE,
    format: {
      type: "object",
      properties: { profile: { type: "string", enum: PROFILE_IDS } },
      required: ["profile"]
    },
    options: { temperature: 0 }
  });
  const latencyMs = performance.now() - start;
  let profileId = null;
  try {
    const parsed = JSON.parse(payload?.message?.content ?? "");
    if (PROFILE_IDS.includes(parsed.profile)) profileId = parsed.profile;
  } catch {
    profileId = null;
  }
  return { profileId, distribution: null, latencyMs };
}

/** Charge un modèle génératif hors jeu d'évaluation, pour exclure la charge à froid des latences. */
export async function warmUp(model) {
  await postJson("/api/generate", { model, prompt: "Bonjour.", stream: false, keep_alive: KEEP_ALIVE, options: { num_predict: 1 } });
}

export async function unload(model) {
  await postJson("/api/generate", { model, prompt: "", stream: false, keep_alive: 0 }).catch(() => {});
}
