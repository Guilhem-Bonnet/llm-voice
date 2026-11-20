#!/usr/bin/env node
/**
 * GAO-valuation-m-001 — relecture des étiquettes par l'utilisateur.
 *
 *   node apply-labels.mjs --generate   # (ré)écrit dataset/LABELS-TO-REVIEW.md depuis le jsonl
 *   node apply-labels.mjs              # applique la colonne « Profil validé » au jsonl
 *
 * Application : pour chaque ligne du tableau, `Profil validé` vide = proposition
 * acceptée, sinon l'id saisi remplace la proposition. Chaque cas relu reçoit
 * `userLabel` et `labelSource: "user"` ; `proposedProfile` est conservé pour
 * mesurer l'accord Claude ↔ utilisateur. Un id inconnu arrête tout sans rien
 * écrire. `run-all.mjs` utilise `userLabel` en priorité.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { PROFILE_IDS } from "./auto-profiles.mjs";
import { readJsonl } from "./common.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATASET = path.join(HERE, "dataset", "auto-eval-v1.jsonl");
const REVIEW = path.join(HERE, "dataset", "LABELS-TO-REVIEW.md");

function excerpt(text) {
  const flat = text.replace(/\s+/g, " ").replace(/\|/g, "/").replace(/`/g, "'").trim();
  return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat;
}

async function generate() {
  const entries = await readJsonl(DATASET);
  const lines = [
    "# Étiquettes à relire — jeu d'évaluation du mode « Auto » (GAO-valuation-m-001)",
    "",
    "Les profils ci-dessous ont été **proposés par Claude**, pas par toi. Tant qu'ils ne sont pas relus, tout",
    "score du banc mesure seulement l'accord avec ces propositions. Texte complet de chaque cas :",
    "`dataset/auto-eval-v1.jsonl` (champ `text`, même `id`), avec la justification dans `rationale`.",
    "",
    "Profils possibles : `faithful-local` (Lecture fidèle : tel quel, mot à mot) · `llm-summary` (Résumé LLM :",
    "fait, limites, reste à faire) · `technical-teacher` (Professeur technique : explication pédagogique) ·",
    "`quick-review` (Révision rapide : concepts, pièges, essentiel). `system-voice` n'est pas une option : même",
    "mode que `faithful-local`, seule la voix change.",
    "",
    "## Consigne (5 minutes)",
    "",
    "1. Parcours le tableau. Si le profil proposé te convient, **laisse « Profil validé » vide**.",
    "2. Sinon, écris l'id du bon profil dans « Profil validé » (un des quatre ci-dessus).",
    "3. Applique : `node vscode-extension/scripts/decision-spike/apply-labels.mjs` — chaque cas reçoit",
    "   `userLabel` et `labelSource: \"user\"` (la proposition reste dans `proposedProfile`).",
    "4. Remesure : `node vscode-extension/scripts/decision-spike/run-all.mjs` (le banc lit `userLabel` d'abord).",
    "",
    "| id | Catégorie | Extrait (80 car.) | Profil proposé | Profil validé |",
    "|---|---|---|---|---|"
  ];
  for (const e of entries) lines.push(`| ${e.id} | ${e.category} | ${excerpt(e.text)} | ${e.proposedProfile} |  |`);
  await fs.writeFile(REVIEW, lines.join("\n") + "\n");
  console.log(`LABELS-TO-REVIEW.md : ${entries.length} lignes écrites.`);
}

async function apply() {
  const md = await fs.readFile(REVIEW, "utf8");
  const decisions = new Map();
  for (const line of md.split("\n")) {
    const m = line.match(/^\|\s*(auto-\d+)\s*\|/);
    if (!m) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    const proposed = cells[3];
    const validated = cells[4] ?? "";
    const label = validated === "" ? proposed : validated;
    if (!PROFILE_IDS.includes(label)) throw new Error(`${m[1]} : profil « ${label} » inconnu (attendu : ${PROFILE_IDS.join(", ")})`);
    decisions.set(m[1], label);
  }
  const entries = await readJsonl(DATASET);
  let changed = 0;
  const out = entries.map((e) => {
    if (!decisions.has(e.id)) return e;
    const userLabel = decisions.get(e.id);
    if (userLabel !== e.proposedProfile) changed += 1;
    return { ...e, userLabel, labelSource: "user" };
  });
  await fs.writeFile(DATASET, out.map((e) => JSON.stringify(e)).join("\n") + "\n");
  console.log(`${decisions.size} cas relus appliqués (labelSource: "user"), dont ${changed} corrigé(s) ; accord Claude ↔ utilisateur ${Math.round(((decisions.size - changed) / Math.max(1, decisions.size)) * 100)} %.`);
}

(process.argv.includes("--generate") ? generate() : apply()).catch((err) => {
  console.error(`apply-labels.mjs : échec (${err.message})`);
  process.exitCode = 1;
});
