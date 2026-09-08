/**
 * The `narration-segments` structured-output contract (CdC §20-21): both
 * `OllamaNarrator` (`format`) and `OpenAICompatibleNarrator`
 * (`response_format.json_schema.schema`) send this exact JSON Schema, and
 * both prompt with the same system message so the two providers behave
 * identically from the pipeline's point of view.
 */

/** JSON Schema for `{ segments: [{ sourceIds, spokenText }] }`. */
export const NARRATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    segments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sourceIds: {
            type: "array",
            items: { type: "string" },
            minItems: 1
          },
          spokenText: { type: "string", minLength: 1 }
        },
        required: ["sourceIds", "spokenText"]
      }
    }
  },
  required: ["segments"]
} as const;

/** Name OpenAI-compatible servers expect for `response_format.json_schema.name`. */
export const NARRATION_SCHEMA_NAME = "narration_segments";

/**
 * System prompt: the profile's free-form style (CdC §19, `profile.style`,
 * forwarded as `NarrationRequest.style`) followed by the mandatory BLOCK_xxx
 * mapping instruction (CdC §21) that holds regardless of style.
 */
export function narrationSystemPrompt(style?: string): string {
  const mapping =
    "Tu reçois un texte découpé en blocs, chacun précédé d'une étiquette " +
    "BLOCK_xxx sur sa propre ligne. Réponds uniquement avec un JSON conforme " +
    'au schéma suivant, sans aucun texte hors JSON : {"segments":[{"sourceIds":' +
    '["BLOCK_xxx", ...],"spokenText":"..."}]}. Chaque sourceIds doit lister un ' +
    "ou plusieurs identifiants BLOCK_xxx parmi ceux fournis ; regrouper plusieurs " +
    "blocs dans un seul sourceIds est autorisé quand cela améliore la fluidité " +
    "orale. Chaque bloc source fourni doit être couvert par au moins un segment.";
  const trimmedStyle = style?.trim();
  return trimmedStyle !== undefined && trimmedStyle.length > 0 ? `${trimmedStyle}\n\n${mapping}` : mapping;
}
