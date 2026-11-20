#!/usr/bin/env node
/**
 * GAO-spike-valuat-001 — témoin à règles (aucun LLM, aucun réseau).
 *
 * Choisit un profil A/B/C à partir de trois signaux dérivés du message :
 * longueur (`chars`), part de blocs de code (`codeRatio`), présence de
 * questions (`questionMarks`). Sert de référence : les techniques SemIf et
 * embeddings ne sont retenues (§10 de `decision-models-jev-v1.md`) que si
 * elles battent ce témoin.
 *
 * Aucune sortie n'affiche le texte d'un message : seules les métriques et la
 * lettre prédite sont manipulées ici.
 */

import { DATASET_PATH, distributionOf, formatDistribution, readJsonl } from "./common.mjs";

/** Seuils choisis à dire d'expert, documentés pour être révisés facilement. */
export const RULES = {
  codeRatioThreshold: 0.25,
  shortChars: 300,
  longChars: 1200,
  questionThreshold: 2
};

/**
 * @param {{ chars: number, codeRatio: number, questionMarks: number }} metrics
 * @returns {"A"|"B"|"C"}
 */
export function classifyRules(metrics) {
  const { chars, codeRatio, questionMarks } = metrics;
  if (codeRatio >= RULES.codeRatioThreshold) return "A"; // du code : à lire mot à mot
  if (chars <= RULES.shortChars) return "C"; // réponse courte : survol suffit
  if (questionMarks >= RULES.questionThreshold) return "C"; // beaucoup de questions : vérif rapide
  if (chars >= RULES.longChars) return "B"; // long texte sans code : un résumé suffit
  return "A"; // par défaut, prudent : lecture intégrale
}

async function main() {
  const datasetPath = process.argv[2] ?? DATASET_PATH;
  const entries = await readJsonl(datasetPath);
  if (entries.length === 0) {
    console.log(`Témoin à règles : jeu de données vide (${datasetPath}), rien à classer.`);
    return;
  }
  const predictions = entries.map((entry) => classifyRules(entry));
  console.log(`Témoin à règles : ${entries.length} entrée(s) — distribution ${formatDistribution(distributionOf(predictions))}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`baseline-rules.mjs : échec (${err.message})`);
    process.exitCode = 1;
  });
}
