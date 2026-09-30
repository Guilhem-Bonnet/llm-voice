/**
 * Analyst prompt (ADR-015 §2, role 1). Versioned: bump `ANALYST_PROMPT_VERSION`
 * on any change of wording or of the requested output; it is part of the
 * partition cache key through `DIRECTION_PROMPT_VERSION`.
 */

import { DIRECTION_BOUNDS } from "../../../core/direction.js";
import type { AnalysisLlmRequest } from "../llm.js";
import { renderBible, renderBlocks } from "./render.js";

export const ANALYST_PROMPT_VERSION = 1;

export function analystSystemPrompt(): string {
  return [
    "Tu es l'analyste d'une lecture à voix haute. Tu lis un extrait d'un document et tu décris ce qu'il faut savoir pour le lire à voix haute : de quoi il s'agit et qui y parle.",
    "Tu réponds uniquement par un objet JSON, sans commentaire, de la forme { \"analysis\": {...}, \"characters\": [...] }.",
    "",
    "`analysis` (chaque valeur : une phrase courte, au plus " + DIRECTION_BOUNDS.factValueMaxChars + " caractères, en français) :",
    "- genre : la nature du texte, en quelques mots libres ;",
    "- intent : ce que le texte cherche à obtenir de celui qui l'écoute ;",
    "- audience : à qui il s'adresse ;",
    "- baseTone : le ton de fond de la lecture ;",
    "- narratorPersona : la façon dont la voix qui lit doit se tenir.",
    "Omets un champ que le texte ne permet pas de dire.",
    "",
    "`characters` : les personnes ou entités qui prennent la parole ou dont la voix se distingue de celle du narrateur dans le texte. Liste vide si personne ne parle ainsi.",
    "Pour chacune :",
    "- id : identifiant court en minuscules, sans accent, uniquement lettres a-z, chiffres et tirets, différent de « narrator » ;",
    "- names : les noms sous lesquels le texte la désigne ;",
    "- traits : des paires { key, value } courtes établies par le texte (par exemple âge, rôle, caractère) ;",
    "- voiceDescriptor : une phrase décrivant la voix qui lui convient.",
    "",
    "N'invente rien : tout ce que tu écris doit venir du texte. Quand un extrait suit d'autres extraits, les personnages déjà connus te sont donnés : n'ajoute que les nouveaux et laisse `analysis` vide.",
    "Les noms propres et les identifiants cités sont recopiés exactement, sans traduction ni correction."
  ].join("\n");
}

export function analystUserPrompt(request: AnalysisLlmRequest): string {
  const position =
    request.chunkCount > 1 ? `Extrait ${request.chunkIndex + 1} sur ${request.chunkCount} du document.` : "Document entier.";
  return [
    position,
    "",
    "Ce qui est déjà établi :",
    renderBible(request.bible),
    "",
    "Texte à analyser :",
    renderBlocks(request.blocks)
  ].join("\n");
}
