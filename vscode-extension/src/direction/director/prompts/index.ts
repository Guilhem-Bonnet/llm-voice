/**
 * Versioned prompts and output schemas of the direction roles. The version
 * that reaches the partition cache key is `DIRECTION_PROMPT_VERSION`
 * (`OllamaDirectionLlm.promptVersion`): a change of either prompt invalidates
 * every cached partition.
 */
import { ANALYST_PROMPT_VERSION } from "./analyst.js";
import { DIRECTOR_PROMPT_VERSION } from "./director.js";

export const DIRECTION_PROMPT_VERSION = `analyst-${ANALYST_PROMPT_VERSION}.director-${DIRECTOR_PROMPT_VERSION}`;

export { ANALYST_PROMPT_VERSION, analystSystemPrompt, analystUserPrompt } from "./analyst.js";
export { DIRECTOR_PROMPT_VERSION, directorSystemPrompt, directorUserPrompt } from "./director.js";
export {
  ANALYSIS_OUTPUT_JSON_SCHEMA,
  CUE_JSON_SCHEMA,
  DIRECTION_OUTPUT_JSON_SCHEMA,
  FACT_JSON_SCHEMA,
  FACT_TYPES
} from "./schemas.js";
export { FIDELITY_RULES, MAX_RENDERED_ROLES } from "./render.js";
