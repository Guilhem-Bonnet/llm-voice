#!/usr/bin/env node
/**
 * Helpers partagés par les scripts du spike de décision (GAO-spike-valuat-001).
 * Node 22, ESM natif (extension `.mjs`, aucune dépendance npm nouvelle).
 *
 * Confidentialité (AC-SEC-07) : ces helpers ne doivent jamais écrire le texte
 * d'un message (`entry.message`) sur la sortie standard ni dans un fichier du
 * dépôt. Le seul endroit où `message` est persisté est le jsonl sous
 * `~/.llm-voice/eval/`, hors git, destiné à l'étiquetage manuel par
 * l'utilisateur — jamais dans `_grimoire-output/` ni dans le dépôt.
 */

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";

export const HOME = os.homedir();
export const INBOX_DIR = path.join(HOME, ".llm-voice", "inbox");
export const ARCHIVE_DIRNAME = "archive";
export const ARCHIVE_DIR = path.join(INBOX_DIR, ARCHIVE_DIRNAME);
export const TMP_PREFIX = ".tmp-";
export const EVAL_DIR = path.join(HOME, ".llm-voice", "eval");
export const DATASET_PATH = path.join(EVAL_DIR, "decision-spike-v1.jsonl");
export const SYNTHETIC_DATASET_PATH = path.join(EVAL_DIR, "decision-spike-smoke.jsonl");
export const EMBED_CACHE_PATH = path.join(EVAL_DIR, "embeddings-cache.json");
export const OLLAMA_ENDPOINT = (process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").trim() || "http://127.0.0.1:11434";
export const DEFAULT_SEMIF_MODEL = "qwen2.5:3b";
export const DEFAULT_EMBED_MODEL = "nomic-embed-text";
export const LETTERS = ["A", "B", "C"];

/** ADR-003/ADR-007 : `capturedAt` accepte epoch ms ou ISO-8601. */
export function normalizeCapturedAt(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

/**
 * Part des caractères du message situés dans des blocs de code Markdown
 * (``` ... ```). Retourne 0 si le message est vide.
 */
export function codeRatio(message) {
  if (!message || message.length === 0) return 0;
  const fences = message.match(/```[\s\S]*?```/g) ?? [];
  const codeChars = fences.reduce((sum, block) => sum + block.length, 0);
  return Math.min(1, codeChars / message.length);
}

export function questionMarkCount(message) {
  if (!message) return 0;
  return (message.match(/\?/g) ?? []).length;
}

/** Dérive les métriques d'un message brut, sans jamais logger son contenu. */
export function analyzeMessage(message) {
  const text = typeof message === "string" ? message : "";
  return {
    chars: text.length,
    codeRatio: Number(codeRatio(text).toFixed(4)),
    questionMarks: questionMarkCount(text)
  };
}

export async function readJsonl(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

export async function writeJsonl(filePath, entries) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const body = entries.map((entry) => JSON.stringify(entry)).join("\n") + (entries.length > 0 ? "\n" : "");
  await fs.writeFile(filePath, body, { mode: 0o600 });
}

export function median(values) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function percentile(values, p) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

export function distributionOf(labels) {
  const counts = { A: 0, B: 0, C: 0, none: 0 };
  for (const label of labels) {
    if (label === "A" || label === "B" || label === "C") counts[label] += 1;
    else counts.none += 1;
  }
  return counts;
}

export function formatMs(value) {
  return value === null || value === undefined ? "n/d" : `${Math.round(value)} ms`;
}

export function formatDistribution(counts) {
  const total = counts.A + counts.B + counts.C + counts.none;
  if (total === 0) return "n/d";
  const parts = [`A:${counts.A}`, `B:${counts.B}`, `C:${counts.C}`];
  if (counts.none > 0) parts.push(`?:${counts.none}`);
  return parts.join(" ");
}

export function sha256(text) {
  return createHash("sha256").update(text ?? "", "utf8").digest("hex");
}

export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return -1;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return -1;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Erreur "propre" : le serveur Ollama ou le modèle demandé sont indisponibles. */
export class OllamaUnavailableError extends Error {}
