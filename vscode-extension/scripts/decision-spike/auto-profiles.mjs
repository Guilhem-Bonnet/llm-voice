#!/usr/bin/env node
/**
 * GAO-valuation-m-001 — profils candidats du mode « Auto » et exemples de prompt.
 *
 * Miroir en lecture seule de `vscode-extension/src/profiles/defaults.ts` et de
 * `DEFAULT_PROFILE` (`src/core/profile.schema.ts`) : id, libellé, mode et
 * description réels. `system-voice` n'est pas une classe : il a le même mode
 * `faithful` que `faithful-local` et ne diffère que par la voix, ce qui n'est
 * pas une *manière de lire* ; « Auto » en mode fidèle garde la voix courante.
 *
 * `faithful-local` a pour description produit « Chatterbox sur la machine
 * locale… », qui décrit la voix et non la lecture : le prompt utilise donc la
 * description du MODE `faithful` (CdC §19 : aucune transformation).
 *
 * `PROMPT_EXAMPLES` : un exemple court par profil, écrit À PART du jeu
 * d'évaluation `dataset/auto-eval-v1.jsonl` (aucun cas du jeu n'est recopié
 * ni paraphrasé ici) — garde-fou anti-fuite de la variante (b).
 */

export const AUTO_PROFILES = [
  {
    id: "faithful-local",
    label: "Lecture fidèle (local)",
    mode: "faithful",
    description: "Le texte est lu tel quel, mot à mot, sans aucune transformation.",
    // Variante (c) : nom d'option. Les quatre noms commencent par une lettre
    // différente (f, r, p, e), si bien qu'un jeton de tête n'est jamais ambigu.
    optionName: "fidèle",
    letter: "A"
  },
  {
    id: "llm-summary",
    label: "Résumé LLM",
    mode: "narrated",
    description: "Résumé oral façon collègue développeur : fait, limites, reste à faire.",
    optionName: "résumé",
    letter: "B"
  },
  {
    id: "quick-review",
    label: "Révision rapide",
    mode: "narrated",
    description: "Ne garde que les concepts, pièges et éléments essentiels à retenir.",
    optionName: "essentiel",
    letter: "C"
  },
  {
    id: "technical-teacher",
    label: "Professeur technique",
    mode: "narrated",
    description: "Explication orale pédagogique, avec analogies quand elles aident.",
    optionName: "professeur",
    letter: "D"
  }
];

export const PROFILE_IDS = AUTO_PROFILES.map((p) => p.id);
export const FALLBACK_PROFILE_ID = "faithful-local";

/** Anciennes étiquettes A/B/C du spike GAO-spike-valuat-001 → profils réels. */
export const LEGACY_LETTER_TO_PROFILE = { A: "faithful-local", B: "llm-summary", C: "quick-review" };

/** Écrits pour le prompt, jamais tirés du jeu d'évaluation. */
export const PROMPT_EXAMPLES = {
  "faithful-local": "Corrigé : `timeout` vaut maintenant 30 s dans `settings.py`.",
  "llm-summary":
    "J'ai ajouté la pagination à l'API des utilisateurs (paramètres page et limit) et mis à jour six tests, tous verts. " +
    "Limite : le tri n'est pas encore paginé. Reste à faire : la pagination côté interface.",
  "quick-review":
    "À retenir sur les expressions régulières : le point ne capture pas les retours à la ligne ; l'étoile est gourmande ; " +
    "il faut échapper les points d'une adresse IP.",
  "technical-teacher":
    "Une closure, c'est une fonction qui se souvient des variables de l'endroit où elle a été créée, " +
    "un peu comme un sac à dos qu'elle emporte partout, même quand cet endroit n'existe plus."
};

/**
 * Normalise une ligne de jeu : `text` (nouveau format) ou `message` (spike
 * GAO-spike-valuat-001) ; étiquette `userLabel` > `proposedProfile` > `label`
 * (A/B/C historique converti).
 */
export function normalizeEntry(raw) {
  const text = typeof raw.text === "string" ? raw.text : typeof raw.message === "string" ? raw.message : "";
  let gold = null;
  for (const candidate of [raw.userLabel, raw.proposedProfile, raw.label]) {
    if (typeof candidate !== "string") continue;
    if (PROFILE_IDS.includes(candidate)) { gold = candidate; break; }
    if (candidate in LEGACY_LETTER_TO_PROFILE) { gold = LEGACY_LETTER_TO_PROFILE[candidate]; break; }
  }
  return {
    id: raw.id,
    text,
    category: raw.category ?? "non classé",
    gold,
    labelSource: raw.labelSource ?? (raw.synthetic ? "synthetic" : "inconnu")
  };
}
