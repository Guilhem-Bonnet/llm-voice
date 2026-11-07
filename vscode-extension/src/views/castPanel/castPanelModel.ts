/**
 * Le panneau Distribution (ADR-018 §3 et §7 étape 5), sans `vscode` : ce que la page montre,
 * les messages qu'elle peut envoyer (tous validés ici), et la description anglaise d'une voix
 * à créer, composée par l'extension à partir de choix simples.
 */

export interface CastProposal {
  readonly age?: string;
  readonly gender?: string;
  readonly character?: string;
  /** Les mots du texte qui fondent la proposition. */
  readonly quote?: string;
}

export interface CastPanelRow {
  readonly roleId: string;
  readonly name: string;
  readonly lines: number;
  /** La première réplique, telle qu'écrite : c'est elle que dit « Écouter ». */
  readonly firstLine: string;
  readonly voiceId: string | undefined;
  readonly voiceLabel: string | undefined;
  readonly byUser: boolean;
  readonly shared: boolean;
  readonly unavailable: boolean;
  readonly narratorClash: boolean;
  /** Rempli par l'étape suivante (metteur en scène local) ; jamais déduit ici. */
  readonly proposal?: CastProposal;
}

export interface CastPanelVoice {
  readonly id: string;
  readonly label: string;
  readonly created: boolean;
  /** Personnages qui la tiennent déjà. */
  readonly takenBy: readonly string[];
  readonly narrator: boolean;
}

export interface CastPanelState {
  readonly documentName: string;
  readonly engineLabel: string;
  readonly narrator: { readonly voiceLabel: string | undefined; readonly firstLine: string };
  readonly rows: readonly CastPanelRow[];
  readonly voices: readonly CastPanelVoice[];
  /** Ce qui manque pour que chaque personnage ait sa voix, dit simplement. */
  readonly notice: string | undefined;
  readonly canCreateVoice: boolean;
  /** Secondes de calcul par seconde d'audio, si le moteur est plus lent que l'écoute. */
  readonly slowFactor: number | undefined;
}

export type Gender = "woman" | "man" | "unspecified";
export type Age = "child" | "young" | "adult" | "elderly";
export type Timbre = "deep" | "medium" | "high";

export interface VoiceRecipe {
  readonly gender: Gender;
  readonly age: Age;
  readonly timbre: Timbre;
  readonly character: string;
}

export type CastPanelMessage =
  | { readonly type: "ready" }
  | { readonly type: "listen"; readonly roleId: string; readonly voiceId?: string; readonly requestId: number }
  | { readonly type: "sampleVoice"; readonly voiceId: string; readonly requestId: number }
  | { readonly type: "cancel"; readonly requestId: number }
  | { readonly type: "assign"; readonly roleId: string; readonly voiceId: string }
  | { readonly type: "createVoice"; readonly name: string; readonly recipe: VoiceRecipe; readonly forRoleId?: string; readonly requestId: number }
  | { readonly type: "read" }
  | { readonly type: "recast" };

export const MAX_VOICE_NAME = 40;
export const MAX_CHARACTER = 80;
export const MAX_DESCRIPTION = 300;
export const MAX_SAMPLE_TEXT = 300;

const GENDERS: readonly Gender[] = ["woman", "man", "unspecified"];
const AGES: readonly Age[] = ["child", "young", "adult", "elderly"];
const TIMBRES: readonly Timbre[] = ["deep", "medium", "high"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shortId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200;
}

function requestIdOf(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Une ligne de commande, de la ponctuation, pas de contrôle : rien qui façonne un chemin ou un en-tête. */
export function cleanVoiceName(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return name.length >= 1 && name.length <= MAX_VOICE_NAME ? name : undefined;
}

function recipeOf(raw: unknown): VoiceRecipe | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const { gender, age, timbre, character } = raw;
  if (!GENDERS.includes(gender as Gender) || !AGES.includes(age as Age) || !TIMBRES.includes(timbre as Timbre)) {
    return undefined;
  }
  if (typeof character !== "string" || character.length > MAX_CHARACTER) {
    return undefined;
  }
  return { gender: gender as Gender, age: age as Age, timbre: timbre as Timbre, character };
}

export function parseCastPanelMessage(raw: unknown): CastPanelMessage | undefined {
  if (!isRecord(raw) || typeof raw.type !== "string") {
    return undefined;
  }
  switch (raw.type) {
    case "ready":
    case "read":
    case "recast":
      return { type: raw.type };
    case "listen":
      if (!shortId(raw.roleId) || !requestIdOf(raw.requestId) || (raw.voiceId !== undefined && !shortId(raw.voiceId))) {
        return undefined;
      }
      return { type: "listen", roleId: raw.roleId, requestId: raw.requestId, ...(raw.voiceId !== undefined ? { voiceId: raw.voiceId as string } : {}) };
    case "sampleVoice":
      return shortId(raw.voiceId) && requestIdOf(raw.requestId) ? { type: "sampleVoice", voiceId: raw.voiceId, requestId: raw.requestId } : undefined;
    case "cancel":
      return requestIdOf(raw.requestId) ? { type: "cancel", requestId: raw.requestId } : undefined;
    case "assign":
      return shortId(raw.roleId) && shortId(raw.voiceId) ? { type: "assign", roleId: raw.roleId, voiceId: raw.voiceId } : undefined;
    case "createVoice": {
      const name = cleanVoiceName(raw.name);
      const recipe = recipeOf(raw.recipe);
      if (name === undefined || recipe === undefined || !requestIdOf(raw.requestId) || (raw.forRoleId !== undefined && !shortId(raw.forRoleId))) {
        return undefined;
      }
      return { type: "createVoice", name, recipe, requestId: raw.requestId, ...(raw.forRoleId !== undefined ? { forRoleId: raw.forRoleId as string } : {}) };
    }
    default:
      return undefined;
  }
}

const NOUN: Record<Gender, Record<Age, string>> = {
  woman: { child: "girl", young: "young woman", adult: "woman", elderly: "elderly woman" },
  man: { child: "boy", young: "young man", adult: "man", elderly: "elderly man" },
  unspecified: { child: "child", young: "young person", adult: "adult", elderly: "elderly person" }
};

const PITCH: Record<Timbre, string> = {
  deep: "a deep, low-pitched voice",
  medium: "a medium-pitched voice",
  high: "a high-pitched, bright voice"
};

/**
 * La consigne du moteur, en anglais : l'écoute a montré que Qwen3 suit mieux une consigne
 * anglaise. Le caractère est repris tel que saisi, entre guillemets, borné.
 */
export function composeVoiceDescription(recipe: VoiceRecipe): string {
  const noun = NOUN[recipe.gender][recipe.age];
  const article = /^[aeiou]/.test(noun) ? "An" : "A";
  const character = recipe.character.replace(/[\u0000-\u001f\u007f"]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_CHARACTER);
  const parts = [`${article} ${noun} with ${PITCH[recipe.timbre]}, speaking French naturally.`];
  if (character.length > 0) {
    parts.push(`Character: "${character}".`);
  }
  return parts.join(" ").slice(0, MAX_DESCRIPTION);
}

/** Secondes d'audio d'un texte lu, à environ 15 caractères par seconde. */
export function estimatedAudioSeconds(text: string): number {
  return Math.max(1, Math.round(text.length / 15));
}

/** Ce que la page dit quand les voix manquent : jamais un renvoi vers un autre écran. */
export function castNotice(input: { multiVoice: boolean; canCreateVoice: boolean; characters: number; freeVoices: number }): string | undefined {
  if (!input.multiVoice) {
    return input.canCreateVoice
      ? "Ce moteur lit encore à une seule voix. Créez une voix pour chaque personnage, puis attribuez-la."
      : "Ce moteur ne lit qu'à une seule voix. Pour donner une voix à chaque personnage, choisissez la voix Qwen3 ou Kyutai 1.6B.";
  }
  if (input.freeVoices >= input.characters) {
    return undefined;
  }
  const missing = input.characters - input.freeVoices;
  const plural = missing > 1 ? "voix manquent" : "voix manque";
  return input.canCreateVoice
    ? `${input.characters} personnages, ${input.freeVoices} voix libres : ${missing} ${plural}. Créez une voix, puis attribuez-la avec Changer.`
    : `${input.characters} personnages, ${input.freeVoices} voix libres : certains personnages partagent une voix.`;
}
