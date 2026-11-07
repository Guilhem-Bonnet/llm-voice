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
  /** Les caractères du formulaire « Créer une voix », libellés français. */
  readonly traitChoices: readonly { readonly id: string; readonly label: string }[];
}

export type Gender = "woman" | "man" | "unspecified";
export type Age = "child" | "young" | "adult" | "elderly";
export type Timbre = "deep" | "medium" | "high";

/**
 * Les caractères proposés : libellé français pour l'écran, traduction anglaise fixe pour la
 * consigne. Le serveur Qwen3 refuse une description non ASCII (400) : rien de saisi librement
 * n'y entre.
 */
export const VOICE_TRAITS = {
  calm: { label: "calme", english: "calm and composed" },
  warm: { label: "chaleureux", english: "warm and kind" },
  tender: { label: "tendre", english: "tender and gentle" },
  cheerful: { label: "enjoué", english: "cheerful and lively" },
  mischievous: { label: "malicieux", english: "mischievous and playful" },
  proud: { label: "fier", english: "proud and haughty" },
  authoritative: { label: "autoritaire", english: "authoritative and firm" },
  solemn: { label: "solennel", english: "solemn and grave" },
  cold: { label: "froid", english: "cold and distant" },
  anxious: { label: "inquiet", english: "anxious and worried" },
  weary: { label: "las", english: "weary and tired" },
  fierce: { label: "emporté", english: "quick-tempered and fierce" }
} as const;

export type VoiceTrait = keyof typeof VOICE_TRAITS;
export const MAX_TRAITS = 3;

export interface VoiceRecipe {
  readonly gender: Gender;
  readonly age: Age;
  readonly timbre: Timbre;
  readonly traits: readonly VoiceTrait[];
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
  const { gender, age, timbre, traits } = raw;
  if (!GENDERS.includes(gender as Gender) || !AGES.includes(age as Age) || !TIMBRES.includes(timbre as Timbre)) {
    return undefined;
  }
  if (!Array.isArray(traits) || traits.length > MAX_TRAITS || !traits.every((trait) => typeof trait === "string" && Object.hasOwn(VOICE_TRAITS, trait))) {
    return undefined;
  }
  return { gender: gender as Gender, age: age as Age, timbre: timbre as Timbre, traits: [...new Set(traits as VoiceTrait[])] };
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
 * anglaise, et le serveur refuse tout ce qui n'est pas ASCII. Composée uniquement de morceaux
 * fixes du code ; le dernier filtre ne sert que de garde.
 */
export function composeVoiceDescription(recipe: VoiceRecipe): string {
  const noun = NOUN[recipe.gender][recipe.age];
  // Le français en tête : placé en fin de consigne, il a laissé un accent anglais à une voix
  // d'enfant (15 % d'anglais détecté) ; nommer l'anglais l'aggrave (failure-museum, 2026-11-07).
  const parts = [`A French ${noun}, native speaker from France, with ${PITCH[recipe.timbre]}.`];
  const traits = recipe.traits.slice(0, MAX_TRAITS).map((trait) => VOICE_TRAITS[trait].english);
  if (traits.length > 0) {
    const sentence = traits.join(", ");
    parts.push(`${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`);
  }
  return parts.join(" ").replace(/[^\x20-\x7e]/g, "").slice(0, MAX_DESCRIPTION);
}

export function traitChoices(): { id: string; label: string }[] {
  return Object.entries(VOICE_TRAITS).map(([id, trait]) => ({ id, label: trait.label }));
}

/** La première lecture figée d'une voix créée encode d'abord son extrait (~28 s, serveur Qwen3). */
export const FIRST_CREATED_VOICE_SECONDS = 30;

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

const ENGINE_LABELS: Readonly<Record<string, string>> = {
  qwen3: "voix Qwen3",
  "kyutai-1-6b": "Kyutai 1.6B",
  "kyutai-pocket": "Kyutai",
  kokoro: "Kokoro",
  chatterbox: "Chatterbox",
  "piper-local": "Piper",
  system: "voix du système"
};

/** Le nom du moteur dans le panneau, en mots simples. */
export function engineLabelOf(providerId: string): string {
  return ENGINE_LABELS[providerId] ?? providerId;
}
