#!/usr/bin/env node
/**
 * GAO-spike-valuat-001 — export d'un jeu de données non étiqueté pour le
 * spike de choix de profil (A = lecture intégrale, B = résumé, C = révision
 * rapide) à partir de l'inbox réelle `~/.llm-voice/inbox/`.
 *
 * Lit les fichiers `*.json` de la racine de l'inbox (schéma ADR-003/ADR-007 :
 * `schemaVersion`, `provider`, `sessionId`, `capturedAt`, `cwd?`, `message`),
 * ignore les fichiers `.tmp-*` (écriture en cours, ADR-004) et le
 * sous-dossier `archive/` — sauf si la racine contient moins de 50 entrées,
 * auquel cas `archive/` est inclus pour compléter le jeu.
 *
 * Confidentialité (AC-SEC-07) : ce script est le SEUL endroit du spike qui
 * persiste le texte des messages (`message`), et seulement dans
 * `~/.llm-voice/eval/decision-spike-v1.jsonl`, hors du dépôt git, destiné à
 * l'étiquetage manuel par l'utilisateur. La sortie standard n'affiche que le
 * nombre de lignes exportées, jamais un extrait de message.
 *
 * Mode `--synthetic` : écrit un jeu de 9 réponses FRANÇAISES INVENTÉES (3 par
 * catégorie A/B/C, `synthetic: true`) dans `decision-spike-smoke.jsonl`, pour
 * prouver que la chaîne `run-all.mjs` fonctionne de bout en bout quand
 * l'inbox réelle est vide. Ce jeu n'est jamais utilisé pour la décision du
 * spike ni pour l'étiquetage réel.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  INBOX_DIR,
  ARCHIVE_DIR,
  ARCHIVE_DIRNAME,
  TMP_PREFIX,
  EVAL_DIR,
  DATASET_PATH,
  SYNTHETIC_DATASET_PATH,
  analyzeMessage,
  normalizeCapturedAt,
  writeJsonl
} from "./common.mjs";

const MAX_ENTRIES = 50;
const MIN_ROOT_ENTRIES_BEFORE_ARCHIVE = 50;

async function listJsonFiles(dir) {
  let dirents;
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  return dirents
    .filter((d) => d.isFile() && d.name.endsWith(".json") && !d.name.startsWith(TMP_PREFIX))
    .map((d) => d.name);
}

async function loadEntry(dir, fileName, idPrefix) {
  const fullPath = path.join(dir, fileName);
  let raw;
  try {
    raw = await fs.readFile(fullPath, "utf8");
  } catch {
    return { ok: false };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  if (typeof parsed.message !== "string" || parsed.message.length === 0) return { ok: false };
  const capturedAt = normalizeCapturedAt(parsed.capturedAt);
  if (capturedAt === null) return { ok: false };
  const metrics = analyzeMessage(parsed.message);
  const id = `${idPrefix}${fileName.replace(/\.json$/, "")}`;
  return {
    ok: true,
    entry: {
      id,
      capturedAt,
      chars: metrics.chars,
      codeRatio: metrics.codeRatio,
      questionMarks: metrics.questionMarks,
      message: parsed.message,
      label: null
    }
  };
}

async function exportRealDataset() {
  const rootFiles = await listJsonFiles(INBOX_DIR);
  let rejectedCount = 0;
  const collected = [];

  for (const fileName of rootFiles) {
    const result = await loadEntry(INBOX_DIR, fileName, "");
    if (result.ok) collected.push(result.entry);
    else rejectedCount += 1;
  }

  let includedArchive = false;
  if (rootFiles.length < MIN_ROOT_ENTRIES_BEFORE_ARCHIVE) {
    const archiveFiles = await listJsonFiles(ARCHIVE_DIR);
    if (archiveFiles.length > 0) includedArchive = true;
    for (const fileName of archiveFiles) {
      const result = await loadEntry(ARCHIVE_DIR, fileName, `${ARCHIVE_DIRNAME}/`);
      if (result.ok) collected.push(result.entry);
      else rejectedCount += 1;
    }
  }

  collected.sort((a, b) => a.capturedAt - b.capturedAt);
  const selected = collected.slice(-MAX_ENTRIES);

  await writeEvalReadme();

  if (rootFiles.length === 0 && !includedArchive) {
    await writeJsonl(DATASET_PATH, []);
    console.log(
      "Inbox vide : 0 fichier dans ~/.llm-voice/inbox/ (le hook Claude « llm-voice-capture » n'est " +
        "probablement pas installé). 0 ligne exportée. Exécuter la commande VS Code " +
        "« LLM Voice: Install Claude Hook », laisser tourner quelques sessions, puis relancer ce script."
    );
    return;
  }

  await writeJsonl(DATASET_PATH, selected);
  const rejectedNote = rejectedCount > 0 ? ` (${rejectedCount} fichier(s) ignoré(s) : schéma invalide)` : "";
  console.log(`Lignes exportées : ${selected.length}${rejectedNote}`);
}

function syntheticEntry(id, message, capturedAt) {
  const metrics = analyzeMessage(message);
  return {
    id,
    capturedAt,
    chars: metrics.chars,
    codeRatio: metrics.codeRatio,
    questionMarks: metrics.questionMarks,
    message,
    label: id.startsWith("synthetic-a") ? "A" : id.startsWith("synthetic-b") ? "B" : "C",
    synthetic: true
  };
}

async function exportSyntheticDataset() {
  const base = Date.parse("2026-09-27T00:00:00Z");
  const messages = [
    [
      "synthetic-a-1",
      "Voici le correctif : il faut vérifier que le flux audio est bien fermé avant de relancer la lecture.\n\n" +
        "```ts\nasync function stopThenPlay(sink: AudioSink, chunk: Chunk): Promise<void> {\n" +
        "  await sink.stop();\n  await sink.play(chunk);\n}\n```\n\n" +
        "Cette séquence évite la superposition de deux flux quand l'utilisateur change de profil en cours de lecture."
    ],
    [
      "synthetic-a-2",
      "Le test échoue parce que le mock ne renvoie pas de promesse résolue. Voici la version corrigée :\n\n" +
        "```ts\nconst fakeRepository = {\n  archive: vi.fn().mockResolvedValue(undefined),\n  remove: vi.fn().mockResolvedValue(undefined)\n};\n```\n\n" +
        "Avec ce mock, `await repository.archive(id)` ne lève plus d'exception non gérée dans le test."
    ],
    [
      "synthetic-a-3",
      "Pour renommer la méthode sans casser l'API publique, ajoute un alias temporaire :\n\n" +
        "```ts\nexport function resolveInboxPath(inputs) { /* ... */ }\nexport const resolvePath = resolveInboxPath; // alias, à retirer en 0.5\n```\n\n" +
        "Retire l'alias une fois tous les appelants migrés."
    ],
    [
      "synthetic-b-1",
      "La question du composant Rust dans le chemin audio touche plusieurs invariants du projet. D'un côté, " +
        "un binaire natif apporterait un contrôle plus fin sur le mixage et la latence, ce qui réglerait " +
        "certains symptômes de surlignage désynchronisé observés sur les machines plus anciennes. De l'autre, " +
        "cela romprait l'invariant « zéro binaire non signé distribué dans le VSIX » sans plan de signature " +
        "et de notarisation déjà en place, et ajouterait une surface de compilation croisée (Windows, macOS, " +
        "Linux) que l'équipe ne maîtrise pas encore. Le compromis proposé est de garder le pont webview actuel " +
        "pour la 0.3, et de rouvrir la question seulement si un ADR dédié démontre un gain mesuré sur au moins " +
        "trois machines représentatives, avec une stratégie de repli vers le pont existant en cas d'échec."
    ],
    [
      "synthetic-b-2",
      "Le choix entre file d'attente en mémoire et file persistée dépend surtout de la tolérance de l'utilisateur " +
        "à perdre une lecture en cours après un redémarrage de VS Code. Une file en mémoire est plus simple, ne " +
        "nécessite aucune migration de schéma et convient à l'usage actuel où une session dure rarement plus de " +
        "quelques dizaines de minutes. Une file persistée sur disque protège contre les coupures mais introduit " +
        "un format de fichier à faire évoluer avec soin, ainsi qu'un verrou explicite pour éviter deux instances " +
        "concurrentes. Étant donné que le CdC ne demande la lecture automatique en tâche de fond qu'à partir " +
        "d'une version ultérieure, garder la file en mémoire aujourd'hui limite la dette tout en gardant la porte " +
        "ouverte à une migration plus tard, quand le besoin réel de persistance sera confirmé par l'usage."
    ],
    [
      "synthetic-b-3",
      "Trois pistes existent pour améliorer la robustesse du narrateur local : augmenter la taille du modèle par " +
        "défaut, ajouter une file de nouvelles tentatives avec recul exponentiel, ou détecter l'absence du " +
        "serveur avant l'appel plutôt qu'après l'échec du réseau. La première piste améliore la qualité perçue " +
        "mais alourdit l'installation et le temps de premier chargement, ce qui contredit l'objectif « rien à " +
        "installer » du profil par défaut. La deuxième piste masque des pannes transitoires mais peut donner une " +
        "fausse impression de fiabilité si le serveur est réellement absent. La troisième piste, un contrôle de " +
        "santé rapide avant l'appel principal, coûte peu et donne un message d'erreur clair et actionnable à " +
        "l'utilisateur, ce qui correspond mieux à l'invariant de transparence déjà retenu pour ce projet."
    ],
    ["synthetic-c-1", "Oui, le fichier existe déjà dans `src/core/inbox.schema.ts`."],
    ["synthetic-c-2", "La version publiée actuellement est la 0.2.4, disponible sur le Marketplace."],
    ["synthetic-c-3", "Non, ce changement ne nécessite pas de migration de schéma."]
  ];

  const entries = messages.map(([id, message], index) => syntheticEntry(id, message, base + index * 60000));
  await writeJsonl(SYNTHETIC_DATASET_PATH, entries);
  console.log(
    `Jeu synthétique écrit : ${entries.length} lignes (3 par catégorie A/B/C, invention de démonstration, ` +
      "jamais destiné à l'étiquetage ni à la décision réelle)."
  );
}

async function writeEvalReadme() {
  await fs.mkdir(EVAL_DIR, { recursive: true, mode: 0o700 });
  const readmePath = path.join(EVAL_DIR, "README.md");
  const content = `# Jeu de données du spike de décision (GAO-spike-valuat-001)

Ce dossier est **hors dépôt git** (\`~/.llm-voice/eval/\`) : il contient le texte des réponses
Claude capturées, qui ne doit jamais être copié dans le projet TTS-Voice.

## Fichiers

- \`decision-spike-v1.jsonl\` : jeu réel, exporté depuis \`~/.llm-voice/inbox/\` par
  \`export-dataset.mjs\`. Une ligne JSON par réponse :
  \`{ id, capturedAt, chars, codeRatio, questionMarks, message, label }\`.
- \`decision-spike-smoke.jsonl\` : jeu synthétique (9 réponses inventées, \`synthetic: true\`),
  produit par \`export-dataset.mjs --synthetic\`. Sert uniquement à vérifier que \`run-all.mjs\`
  fonctionne de bout en bout ; ne compte jamais comme preuve de qualité d'une méthode.
- \`embeddings-cache.json\` : cache des vecteurs d'embedding par \`id\`, régénéré automatiquement.

## Comment étiqueter \`decision-spike-v1.jsonl\`

1. Ouvre le fichier dans un éditeur de texte (il ne fait pas partie du dépôt, tu peux l'éditer
   directement).
2. Pour chaque ligne, lis le champ \`message\` et décide comment TU aurais voulu l'entendre :
   - \`"A"\` — lecture intégrale (le texte doit être lu mot à mot, par exemple du code ou une
     instruction précise) ;
   - \`"B"\` — résumé (une synthèse orale plus courte suffit, par exemple une explication longue) ;
   - \`"C"\` — révision rapide (un survol de quelques secondes suffit, par exemple une réponse
     courte ou une confirmation).
3. Remplace \`"label": null\` par \`"label": "A"\` (ou \`"B"\`/\`"C"\`) sur la ligne correspondante.
   Le fichier reste un JSON Lines valide : une ligne = un objet JSON complet.
4. Ne modifie aucun autre champ. Une fois toutes les lignes étiquetées (ou une partie
   suffisante), relance \`node run-all.mjs\` pour obtenir l'exactitude de chaque méthode.

**Important** : étiquette toi-même, sans demander à un LLM de le faire à ta place — sinon le
spike n'apprend que le goût d'un LLM, pas le tien.
`;
  await fs.writeFile(readmePath, content, { mode: 0o600 });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--synthetic")) {
    await exportSyntheticDataset();
    return;
  }
  await exportRealDataset();
}

main().catch((err) => {
  console.error(`export-dataset.mjs : échec (${err.message})`);
  process.exitCode = 1;
});
