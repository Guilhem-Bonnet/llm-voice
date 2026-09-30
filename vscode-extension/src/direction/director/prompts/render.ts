/**
 * Text renderings shared by the direction prompts (analyst and stage
 * director): the blocks of the document, the effective bible, the cues already
 * directed, the controller's re-prompt. Pure functions, no I/O.
 *
 * Nothing here carries a prosody rule or a genre: the prompts describe the
 * output contract and the fidelity rules, and what a passage should sound like
 * is the model's call (ADR-015 §2, "Aucune règle de style").
 *
 * A voice (`assignments`) is never rendered: the director must not see, let
 * alone choose, a voice (ADR-015 §2, `voice-override`).
 */

import type { Bible, Cue, Role } from "../../../core/direction.js";
import type { Resend } from "../../controller/index.js";
import type { LlmBlock } from "../llm.js";

/** Roles rendered per call; a longer cast is cut, the rest is still in the bible. */
export const MAX_RENDERED_ROLES = 30;

/**
 * Fidelity rules, taken from the narrator evaluation
 * (`scripts/narrator-eval/styles-v2.json`): numbers with their unit,
 * versions, file names, commands, code identifiers, proper nouns and
 * negations are kept as they are, nothing is added.
 */
export const FIDELITY_RULES =
  "Règles de fidélité impératives : le texte à lire (`spokenText`) reprend le texte du segment mot pour mot. " +
  "Reprends tels quels, sans les arrondir, les convertir ni les remplacer, tous les nombres avec leur unité, " +
  "les versions, les noms de fichiers, les commandes, les identifiants de code et les noms propres. " +
  "Conserve chaque négation (« ne pas », « jamais », « aucun ») attachée à ce qu'elle concerne. " +
  "N'ajoute aucun fait, chiffre ou unité absent du texte. Ne résume pas, ne reformule pas, ne supprime rien.";

/** `[id]` then the text, blocks separated by a blank line. */
export function renderBlocks(blocks: readonly LlmBlock[]): string {
  return blocks.map((block) => `[${block.id}]\n${block.text}`).join("\n\n");
}

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

function renderRole(role: Role, label: string): string {
  const parts: string[] = [];
  const names = role.names.filter((name) => name.length > 0);
  if (names.length > 0) {
    parts.push(`noms : ${names.map(oneLine).join(", ")}`);
  }
  const traits = Object.entries(role.traits).map(([key, fact]) => `${oneLine(key)} = ${oneLine(fact.value)}`);
  if (traits.length > 0) {
    parts.push(`traits : ${traits.join(" ; ")}`);
  }
  if (role.voice.descriptor !== undefined) {
    parts.push(`descripteur : ${oneLine(role.voice.descriptor.value)}`);
  }
  const states = (role.states ?? []).map(
    (state) => `${oneLine(state.label)} [${state.fromSourceId} -> ${state.untilSourceId ?? "…"}]`
  );
  if (states.length > 0) {
    parts.push(`états : ${states.join(" ; ")}`);
  }
  return `- ${label}${parts.length > 0 ? ` — ${parts.join(" | ")}` : ""}`;
}

/** The effective bible as the model reads it. */
export function renderBible(bible: Bible): string {
  const lines: string[] = [];
  const analysis = bible.analysis;
  const fields: Array<[string, string | undefined]> = [
    ["genre", analysis?.genre],
    ["intention", analysis?.intent],
    ["public", analysis?.audience],
    ["ton de base", analysis?.baseTone],
    ["narrateur", analysis?.narratorPersona]
  ];
  const known = fields.filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1].length > 0);
  lines.push("Analyse du document :");
  lines.push(known.length > 0 ? known.map(([key, value]) => `- ${key} : ${oneLine(value)}`).join("\n") : "- (aucune)");
  lines.push("Rôles (speakerId autorisés) :");
  lines.push(renderRole(bible.narrator, `narrator`));
  const shown = bible.characters.slice(0, MAX_RENDERED_ROLES);
  for (const character of shown) {
    lines.push(renderRole(character, character.id));
  }
  if (bible.characters.length > shown.length) {
    lines.push(`- (${bible.characters.length - shown.length} autres personnages non listés : ne les utilise pas)`);
  }
  return lines.join("\n");
}

const numberOf = (value: number): string => String(Math.round(value * 100) / 100);

/** One line per cue already directed: what the model said last time, for continuity. */
export function renderCues(cues: readonly Cue[]): string {
  return cues
    .map((cue) => {
      const parts = [cue.sourceIds.join("+"), cue.speakerId];
      if (cue.emotion !== undefined) {
        parts.push(`${oneLine(cue.emotion.label)} ${numberOf(cue.emotion.intensity)}`);
      }
      if (cue.tempo !== undefined) {
        parts.push(`tempo ${numberOf(cue.tempo)}`);
      }
      if (cue.direction !== undefined) {
        parts.push(oneLine(cue.direction));
      }
      return `- ${parts.join(" | ")}`;
    })
    .join("\n");
}

/** What the controller found wrong in the previous answer, segment by segment. */
export function renderResend(resend: readonly Resend[]): string {
  return resend
    .map((entry) => `- [${entry.sourceId}] ${entry.reasons.map((reason) => `${reason.code} : ${oneLine(reason.detail)}`).join(" ; ")}`)
    .join("\n");
}
