/**
 * Propositions de voix d'après le texte (amendement du 2026-11-07 d'ADR-018, point 3).
 *
 * L'analyste local propose âge, genre et caractère d'un personnage **uniquement d'après un
 * indice écrit** (« Madame », « Elle pose sa lampe », « le vieux comte ») ; il rend des
 * identifiants d'une liste fermée et une citation. Le code vérifie chaque citation : absente du
 * document, ou réduite au nom d'un personnage, la proposition est rejetée. Sans indice : rien.
 * Une proposition n'est jamais un choix (`by: user`) : l'utilisateur garde le dernier mot.
 * Aucune branche par genre : les valeurs sont des données, traduites par des tables.
 */

import { createHash } from "node:crypto";
import type { Age, Gender, VoiceTrait } from "../../views/castPanel/castPanelModel.js";
import { VOICE_TRAITS } from "../../views/castPanel/castPanelModel.js";

export const PROPOSAL_PROMPT_VERSION = "cast-proposals-v1";

export const PROPOSAL_AGES: readonly Exclude<Age, never>[] = ["child", "young", "adult", "elderly"];
export const PROPOSAL_GENDERS: readonly Exclude<Gender, "unspecified">[] = ["woman", "man"];
export const PROPOSAL_TRAITS = Object.keys(VOICE_TRAITS) as VoiceTrait[];

/** Libellés français de l'écran (jamais envoyés au moteur). */
const AGE_LABEL: Record<Age, string> = { child: "enfant", young: "jeune", adult: "adulte", elderly: "âgé" };
const GENDER_LABEL: Record<Exclude<Gender, "unspecified">, string> = { woman: "femme", man: "homme" };

/** Les mots anglais qu'une description de voix porte pour chaque valeur : une donnée par valeur. */
const AGE_WORDS: Record<Age, readonly string[]> = {
  child: ["child", "girl", "boy", "kid"],
  young: ["young", "youthful"],
  adult: ["adult", "mature", "middle-aged"],
  elderly: ["elderly", "old", "aged", "older"]
};
const GENDER_WORDS: Record<Exclude<Gender, "unspecified">, readonly string[]> = {
  woman: ["woman", "female", "feminine", "girl", "lady"],
  man: ["man", "male", "masculine", "boy", "gentleman"]
};

export interface ProposedField<T extends string> {
  readonly value: T;
  readonly quote: string;
}

export interface VerifiedProposal {
  readonly roleId: string;
  readonly age?: ProposedField<Age>;
  readonly gender?: ProposedField<Exclude<Gender, "unspecified">>;
  readonly character?: ProposedField<VoiceTrait>;
}

export interface ProposalRole {
  readonly roleId: string;
  readonly name: string;
}

export interface ProposalCheck {
  readonly proposals: readonly VerifiedProposal[];
  /** Raisons de rejet, sans aucun mot du document (journal). */
  readonly rejected: readonly { readonly roleId: string; readonly field: string; readonly reason: "quote-absent" | "name-only" | "invalid-value" | "unknown-role" }[];
}

function normalized(text: string): string {
  return text
    .replace(/[’‘]/gu, "'")
    .replace(/[«»“”]/gu, '"')
    .replace(/[*_]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("fr");
}

function words(text: string): string[] {
  return normalized(text).split(/[^\p{L}\p{N}'-]+/u).filter((word) => word.length > 0);
}

/**
 * Une citation recevable : écrite telle quelle dans le document, et pas seulement un nom de
 * personnage (le prénom seul ne dit rien de l'âge ni du genre).
 */
export function quoteProblem(quote: string, documentText: string, roles: readonly ProposalRole[]): "quote-absent" | "name-only" | undefined {
  const wanted = normalized(quote).replace(/^["'.,;:!?…\s]+|["'.,;:!?…\s]+$/gu, "");
  if (wanted.length < 2 || wanted.length > 200 || !normalized(documentText).includes(wanted)) {
    return "quote-absent";
  }
  const names = new Set(roles.flatMap((role) => words(role.name)));
  const left = words(wanted).filter((word) => !names.has(word) && word.length >= 3);
  return left.length === 0 ? "name-only" : undefined;
}

function field<T extends string>(raw: unknown, allowed: readonly string[]): { value: T; quote: string } | "invalid" | undefined {
  if (raw === null || raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "object") {
    return "invalid";
  }
  const { value, quote } = raw as { value?: unknown; quote?: unknown };
  if (typeof value !== "string" || !allowed.includes(value) || typeof quote !== "string") {
    return "invalid";
  }
  return { value: value as T, quote: quote.trim() };
}

/** Ce que le modèle a rendu, passé au crible du document. Pur. */
export function verifyProposals(raw: unknown, documentText: string, roles: readonly ProposalRole[]): ProposalCheck {
  const list = typeof raw === "object" && raw !== null ? (raw as { roles?: unknown }).roles : undefined;
  const known = new Set(roles.map((role) => role.roleId));
  const proposals: VerifiedProposal[] = [];
  const rejected: ProposalCheck["rejected"][number][] = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const roleId = (item as { roleId?: unknown }).roleId;
    if (typeof roleId !== "string" || !known.has(roleId)) {
      rejected.push({ roleId: typeof roleId === "string" ? roleId.slice(0, 40) : "?", field: "*", reason: "unknown-role" });
      continue;
    }
    const kept: Record<string, ProposedField<string>> = {};
    const fields: readonly [string, readonly string[]][] = [
      ["age", PROPOSAL_AGES],
      ["gender", PROPOSAL_GENDERS],
      ["character", PROPOSAL_TRAITS]
    ];
    for (const [name, allowed] of fields) {
      const found = field<string>((item as Record<string, unknown>)[name], allowed);
      if (found === undefined) {
        continue;
      }
      if (found === "invalid") {
        rejected.push({ roleId, field: name, reason: "invalid-value" });
        continue;
      }
      const problem = quoteProblem(found.quote, documentText, roles);
      if (problem !== undefined) {
        rejected.push({ roleId, field: name, reason: problem });
        continue;
      }
      kept[name] = found;
    }
    if (Object.keys(kept).length > 0 && !proposals.some((proposal) => proposal.roleId === roleId)) {
      proposals.push({ roleId, ...kept } as VerifiedProposal);
    }
  }
  return { proposals, rejected };
}

export interface ProposalVoice {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

/** Les mots que la proposition attend dans une description : rien d'inventé, des tables. */
function wantedWords(proposal: VerifiedProposal): Set<string> {
  return new Set([
    ...(proposal.age !== undefined ? AGE_WORDS[proposal.age.value] : []),
    ...(proposal.gender !== undefined ? GENDER_WORDS[proposal.gender.value] : []),
    ...(proposal.character !== undefined ? words(VOICE_TRAITS[proposal.character.value].english).filter((word) => word.length >= 4) : [])
  ]);
}

/**
 * La voix disponible la plus proche, par sa description anglaise : on compte les mots
 * attendus qu'elle contient. À égalité, une voix libre passe devant. Jamais la voix du
 * narrateur ; rien si aucune description ne contient un seul mot attendu.
 */
export function nearestVoice(proposal: VerifiedProposal, voices: readonly ProposalVoice[], options: { narratorVoice?: string; taken?: ReadonlySet<string> } = {}): ProposalVoice | undefined {
  const wanted = wantedWords(proposal);
  let best: { voice: ProposalVoice; score: number } | undefined;
  for (const voice of voices) {
    if (voice.id === options.narratorVoice || voice.description === undefined) {
      continue;
    }
    const have = new Set(words(voice.description));
    const hits = [...wanted].filter((word) => have.has(word)).length;
    const score = hits * 2 + (options.taken?.has(voice.id) === true ? 0 : 1);
    if (hits > 0 && (best === undefined || score > best.score)) {
      best = { voice, score };
    }
  }
  return best?.voice;
}

/** Ce que montre le panneau : libellés français, citations du texte. */
export function proposalLabels(proposal: VerifiedProposal): { age?: string; gender?: string; character?: string; quotes: string[] } {
  const quotes = [proposal.gender?.quote, proposal.age?.quote, proposal.character?.quote].filter((quote): quote is string => quote !== undefined);
  return {
    ...(proposal.age !== undefined ? { age: AGE_LABEL[proposal.age.value] } : {}),
    ...(proposal.gender !== undefined ? { gender: GENDER_LABEL[proposal.gender.value] } : {}),
    ...(proposal.character !== undefined ? { character: VOICE_TRAITS[proposal.character.value].label } : {}),
    quotes: [...new Set(quotes)]
  };
}

/** La clé du cache : le texte, les personnages, le modèle et la consigne. */
export function proposalCacheKey(documentText: string, roles: readonly ProposalRole[], model: string): string {
  return createHash("sha256")
    .update([PROPOSAL_PROMPT_VERSION, model, roles.map((role) => `${role.roleId}=${role.name}`).join("|"), documentText].join("\u0000"), "utf8")
    .digest("hex");
}

const fieldSchema = (values: readonly string[]) => ({
  anyOf: [{ type: "null" }, { type: "object", properties: { value: { type: "string", enum: values }, quote: { type: "string" } }, required: ["value", "quote"] }]
});

export const PROPOSAL_JSON_SCHEMA = {
  type: "object",
  properties: {
    roles: {
      type: "array",
      items: {
        type: "object",
        properties: {
          roleId: { type: "string" },
          gender: fieldSchema(PROPOSAL_GENDERS),
          age: fieldSchema(PROPOSAL_AGES),
          character: fieldSchema(PROPOSAL_TRAITS)
        },
        required: ["roleId", "gender", "age", "character"]
      }
    }
  },
  required: ["roles"]
} as const;

export function proposalSystemPrompt(): string {
  return [
    "Tu lis une pièce ou un récit en français et tu proposes, pour chaque personnage, son genre, son âge et son caractère.",
    "Règle absolue : tu ne proposes une valeur que si le texte contient un indice écrit, et tu recopies cet indice mot pour mot dans `quote`.",
    "Indices valables : une façon de s'adresser à lui ou à elle (« Madame », « seigneur », « mon fils »), un pronom ou un accord dans une indication ou un récit qui le désigne clairement (« Elle pose sa lampe », « il est furieux »), un mot qui le décrit (« le vieux comte », « la petite »).",
    "Interdit : déduire quoi que ce soit du prénom seul ou du nom affiché du personnage. Un prénom n'est jamais un indice.",
    "Sans indice écrit : mets null. Mieux vaut null qu'une supposition.",
    `Valeurs permises : gender ${PROPOSAL_GENDERS.join("|")} ; age ${PROPOSAL_AGES.join("|")} ; character ${PROPOSAL_TRAITS.join("|")}.`,
    'Réponds uniquement en JSON : {"roles":[{"roleId":"…","gender":{"value":"…","quote":"…"}|null,"age":…,"character":…}]}.'
  ].join("\n");
}

/** Le document est numéroté en lignes ; le nom affiché reste dans le texte, c'est la règle qui l'écarte. */
export function proposalUserPrompt(documentText: string, roles: readonly ProposalRole[], maxChars = 12_000): string {
  return [
    `Personnages (roleId : nom affiché) :`,
    ...roles.map((role) => `- ${role.roleId} : ${role.name}`),
    "",
    "Texte :",
    documentText.slice(0, maxChars)
  ].join("\n");
}

export interface ProposalLlm {
  readonly model: string;
  structured(system: string, user: string, schema: object, signal?: AbortSignal): Promise<unknown>;
}

export interface ProposeOptions {
  readonly gpuYield: () => boolean;
  readonly signal?: AbortSignal;
}

export type ProposeOutcome =
  | { readonly status: "ok"; readonly check: ProposalCheck; readonly durationMs: number }
  | { readonly status: "gpu-yield" }
  | { readonly status: "failed"; readonly reason: string };

/** Un appel, hors du chemin de lecture. Mode jeu : aucun appel, aucune proposition. */
export async function proposeCast(documentText: string, roles: readonly ProposalRole[], llm: ProposalLlm, options: ProposeOptions): Promise<ProposeOutcome> {
  if (options.gpuYield()) {
    return { status: "gpu-yield" };
  }
  if (roles.length === 0) {
    return { status: "ok", check: { proposals: [], rejected: [] }, durationMs: 0 };
  }
  const started = Date.now();
  try {
    const raw = await llm.structured(proposalSystemPrompt(), proposalUserPrompt(documentText, roles), PROPOSAL_JSON_SCHEMA, options.signal);
    return { status: "ok", check: verifyProposals(raw, documentText, roles), durationMs: Date.now() - started };
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.name : "error" };
  }
}
