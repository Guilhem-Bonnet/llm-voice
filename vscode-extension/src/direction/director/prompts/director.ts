/**
 * Stage director prompt (ADR-015 §2, role 3). Versioned: bump
 * `DIRECTOR_PROMPT_VERSION` on any change of wording or of the requested
 * output; it is part of the partition cache key through
 * `DIRECTION_PROMPT_VERSION`.
 *
 * The prompt states the output contract, the ranges of the safety bounds
 * (ADR-015 §7), the fidelity rules and, since version 3, the demand for an
 * expressive score whatever the kind of text (version 2 gave flat scores for
 * documentation and assistant answers, and a fast tempo everywhere in the
 * tale: `direction-eval/baseline-qwen2.5-7b.md`). Every style value comes from
 * these instructions to the model, never from code: the code only clamps to
 * the bounds. Which kind of text applies is the model's reading of the
 * analysis and of the text; no code branches on it.
 */

import { DIRECTION_BOUNDS, NONVERBAL_KINDS } from "../../../core/direction.js";
import type { DirectionLlmRequest } from "../llm.js";
import { FIDELITY_RULES, renderBible, renderBlocks, renderCues, renderResend } from "./render.js";

export const DIRECTOR_PROMPT_VERSION = 3;

export function directorSystemPrompt(): string {
  const b = DIRECTION_BOUNDS;
  return [
    "Tu es le metteur en scène d'une lecture à voix haute. Tu reçois les segments d'un document à diriger (la fenêtre), avec leur contexte, l'analyse du document et les rôles connus. Tu écris la partition de lecture de la fenêtre : des consignes de jeu, que quelqu'un d'autre lira à voix haute.",
    "Tu réponds uniquement par un objet JSON, sans commentaire, de la forme { \"cues\": [...], \"facts\": [...] }.",
    "",
    FIDELITY_RULES,
    "",
    "Une consigne (cue) :",
    "- cueId : identifiant unique dans ta réponse (lettres, chiffres, _ et -) ;",
    "- sourceIds : les identifiants des segments de la fenêtre que la consigne couvre ;",
    "- speakerId : « narrator » ou l'identifiant d'un rôle de la liste, jamais un autre ;",
    "- spokenText : le texte à prononcer.",
    "Chaque segment de la fenêtre est couvert par au moins une consigne, dans l'ordre. Un segment peut être découpé en plusieurs consignes (par exemple quand celui qui parle change), sans rien perdre ni répéter : mises bout à bout, elles redonnent le texte du segment. Une consigne peut aussi couvrir plusieurs segments qui se suivent.",
    "Champs facultatifs :",
    `- emotion : { label (texte libre, au plus ${b.emotionLabelMaxChars} caractères), intensity 0 à 1, valence -1 à 1, arousal 0 à 1 } ;`,
    `- tempo : multiplicateur de la vitesse normale, de ${b.tempo.min} à ${b.tempo.max} (1 = inchangé) ;`,
    `- pauseBeforeMs, pauseAfterMs : silences en millisecondes, entiers de ${b.pauseMs.min} à ${b.pauseMs.max} (la somme entre deux consignes qui se suivent ne dépasse pas ${b.silenceBetweenCuesMaxMs}) ;`,
    `- emphasis : au plus ${b.emphasisMax} morceaux recopiés exactement dans spokenText ;`,
    `- direction : une note de jeu en langage naturel, au plus ${b.directionMaxChars} caractères, jamais lue à voix haute ;`,
    `- states : au plus ${b.statesMax} états courts de celui qui parle ;`,
    `- nonverbal : au plus ${b.nonverbalMax} éléments { kind (${NONVERBAL_KINDS.join(", ")}), at (before ou after) }.`,
    "Tu ne choisis jamais de voix, de moteur ni de réglage technique.",
    "",
    "Une partition expressive, quel que soit le genre : une partition sans aucune émotion, sans variation de tempo et sans pause est un échec. Renseigne emotion sur chaque consigne (un libellé court en français, une intensité qui suit la scène), et un tempo ou une pause chaque fois que le sens le demande. Ce qui change dans le texte change dans la partition.",
    "Selon la nature du texte, d'après l'analyse et le texte lui-même :",
    "- documentation, texte technique : un tempo régulier, très légèrement ralenti sur les termes clés, les commandes et les nombres ; une pause avant une liste et à chaque changement d'idée ; de l'appui (emphasis) sur les termes importants ; un ton posé et clair ;",
    "- réponse d'un assistant : le ton d'une conversation, naturel et chaleureux ; de petites pauses de respiration entre les idées ; de l'appui sur ce qui compte pour l'auditeur ;",
    "- récit, conte, dialogue : sépare la narration et chaque réplique en consignes distinctes (les incises comme « dit-il » restent au narrateur, la réplique va à son personnage) ; varie l'intensité et le tempo selon la scène, la calme comme la tendue ; le tempo ne doit pas être systématiquement supérieur à 1 : ralentis pour la tristesse, le doute, le suspense ou la tendresse, accélère seulement pour l'urgence ou la joie vive.",
    "",
    "Le contexte (segments précédents et suivants, consignes déjà données) est là pour la continuité : tu ne diriges que la fenêtre.",
    "",
    "`facts` (facultatif) : ce que tu découvres en lisant et qui vaudra pour la suite. Des objets { type, ... } :",
    "- { type: \"addRole\", roleId, names } : un personnage qui parle et n'est pas dans la liste (identifiant en minuscules, lettres a-z, chiffres et tirets). Tant qu'il n'est pas dans la liste, fais parler « narrator » ;",
    "- { type: \"addTrait\", roleId, key, value } ;",
    "- { type: \"addState\", roleId, label, fromSourceId, untilSourceId? } et { type: \"closeState\", roleId, label, fromSourceId, untilSourceId } ;",
    "- { type: \"setDescriptor\", roleId, value }.",
    "Si des corrections te sont demandées, réponds de nouveau pour la fenêtre entière."
  ].join("\n");
}

export function directorUserPrompt(request: DirectionLlmRequest): string {
  const sections: string[] = [renderBible(request.bible)];
  if (request.previous.length > 0) {
    sections.push("Segments précédents (contexte, déjà lus) :\n" + renderBlocks(request.previous));
  }
  if (request.previousCues.length > 0) {
    sections.push("Consignes déjà données pour ces segments :\n" + renderCues(request.previousCues));
  }
  const ids = request.window.map((block) => block.id).join(", ");
  sections.push(
    `Fenêtre à diriger (${request.window.length} segments : ${ids}) — chacun doit être couvert par au moins une consigne :\n` +
      renderBlocks(request.window)
  );
  if (request.following.length > 0) {
    sections.push("Segments suivants (contexte, à ne pas diriger) :\n" + renderBlocks(request.following));
  }
  if (request.resend.length > 0) {
    sections.push(
      `Ta réponse précédente est refusée (essai ${request.attempt + 1}). Corrige ces segments et réponds de nouveau pour toute la fenêtre :\n` +
        renderResend(request.resend)
    );
  }
  return sections.join("\n\n");
}
