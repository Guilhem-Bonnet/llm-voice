/**
 * Le metteur en scène local, pour les états que la table ne connaît pas (amendement du
 * 2026-11-07 d'ADR-018) : « (Il tire son épée.) » avant une réplique dit comment la jouer, sans
 * mot de la table. Le modèle rend un **identifiant d'état** de la table et une citation de
 * l'indication ; le code vérifie la citation et prend la consigne dans la table. Doute, panne
 * ou mode jeu : aucune consigne, la réplique reste en voix figée.
 */

import { STAGE_PLAY_TABLE, isSendableDirection } from "../cast/stagePlay.js";
import { quoteProblem, type ProposalLlm, type ProposalRole, type ScriptRegion } from "./castProposals.js";

export const STATE_DIRECTIONS_PROMPT_VERSION = "state-directions-v1";
const STATE_IDS = STAGE_PLAY_TABLE.map((row) => row.id);
const MAX_REPLY_CHARS = 200;

export interface StateCandidate {
  readonly id: string;
  readonly roleId: string;
  /** Les indications et le récit juste avant la réplique (depuis la réplique précédente). */
  readonly context: string;
  readonly reply: string;
}

function normalized(text: string): string {
  return text.replace(/[’‘]/gu, "'").replace(/[*_]/gu, "").replace(/\s+/gu, " ").trim().toLocaleLowerCase("fr");
}

/** Chaque réplique précédée d'une indication : c'est elle que le metteur en scène lit. */
export function stateCandidates(regions: readonly ScriptRegion[]): StateCandidate[] {
  const out: StateCandidate[] = [];
  let context: string[] = [];
  for (const region of regions) {
    if (region.heading === true) {
      context = [];
      continue;
    }
    if (region.roleId === undefined) {
      context.push(region.text);
      continue;
    }
    if (context.length > 0) {
      out.push({ id: `c${out.length + 1}`, roleId: region.roleId, context: context.join(" "), reply: region.text });
    }
    context = [];
  }
  return out;
}

export interface StateDirection {
  readonly roleId: string;
  readonly reply: string;
  readonly stateId: string;
  readonly direction: string;
  readonly quote: string;
}

export interface StateCheck {
  readonly directions: readonly StateDirection[];
  /** Sans mot du document : identifiant de la candidate et raison. */
  readonly rejected: readonly { readonly id: string; readonly reason: "unknown-candidate" | "invalid-state" | "quote-absent" | "name-only" }[];
}

/** Ce que le modèle a rendu, passé au crible des indications. Pur. */
export function verifyStateDirections(raw: unknown, candidates: readonly StateCandidate[], roles: readonly ProposalRole[]): StateCheck {
  const items = typeof raw === "object" && raw !== null ? (raw as { items?: unknown }).items : undefined;
  const directions: StateDirection[] = [];
  const rejected: StateCheck["rejected"][number][] = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const { id, state, quote } = item as { id?: unknown; state?: unknown; quote?: unknown };
    const candidate = candidates.find((entry) => entry.id === id);
    if (candidate === undefined) {
      rejected.push({ id: typeof id === "string" ? id.slice(0, 12) : "?", reason: "unknown-candidate" });
      continue;
    }
    if (state === null || state === undefined) {
      continue;
    }
    const row = STAGE_PLAY_TABLE.find((entry) => entry.id === state);
    if (row === undefined || !isSendableDirection(row.direction) || typeof quote !== "string") {
      rejected.push({ id: candidate.id, reason: "invalid-state" });
      continue;
    }
    // La citation est prise dans l'indication de cette réplique, jamais ailleurs.
    const problem = quoteProblem(quote, candidate.context, roles);
    if (problem !== undefined) {
      rejected.push({ id: candidate.id, reason: problem });
      continue;
    }
    directions.push({ roleId: candidate.roleId, reply: candidate.reply, stateId: row.id, direction: row.direction, quote: quote.trim() });
  }
  return { directions, rejected };
}

/** La consigne d'un passage : même personnage, et ses mots dans la réplique. */
export function directionLookup(directions: readonly StateDirection[]): (speakerId: string, spokenText: string) => string | undefined {
  return (speakerId, spokenText) => {
    const words = normalized(spokenText).slice(0, 40);
    if (words.length === 0) {
      return undefined;
    }
    return directions.find((entry) => entry.roleId === speakerId && normalized(entry.reply).includes(words))?.direction;
  };
}

/**
 * Les mots qu'une citation peut reprendre : chaque indication entière et ses propositions.
 * Diagnostic du 2026-11-07 sur 07 : laissé libre, le modèle citait la réplique au lieu de
 * l'indication ; le schéma ne lui laisse plus que des fragments exacts des indications.
 */
export function indicationFragments(candidates: readonly StateCandidate[]): string[] {
  const out = new Set<string>();
  for (const candidate of candidates) {
    const whole = candidate.context.replace(/^[\s(]+|[\s).!?…]+$/gu, "");
    if (whole.length > 0) {
      out.add(whole);
    }
    for (const part of whole.split(/\s*[,;:.!?…]\s*|\s+(?:et|puis|mais)\s+/u)) {
      if (part.trim().length >= 3) {
        out.add(part.trim());
      }
    }
  }
  return [...out];
}

export function stateJsonSchema(candidates: readonly StateCandidate[]): object {
  const fragments = indicationFragments(candidates);
  return {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", enum: candidates.map((candidate) => candidate.id) },
            state: { anyOf: [{ type: "null" }, { type: "string", enum: STATE_IDS }] },
            quote: fragments.length > 0 ? { type: "string", enum: fragments } : { type: "string" }
          },
          required: ["id", "state", "quote"]
        }
      }
    },
    required: ["items"]
  };
}

export function stateSystemPrompt(): string {
  return [
    "Tu es metteur en scène. Chaque ligne donne une indication écrite, puis la réplique qui la suit. Dis comment l'acteur doit dire la réplique, d'après l'indication seulement.",
    `Choisis un état dans cette liste fermée : ${STATE_IDS.join(", ")} ; ou null si l'indication ne change pas la façon de parler.`,
    "Une action peut mener à un état de la voix, ou à rien : à toi de juger d'après le sens de l'action.",
    "`quote` reprend les mots de l'INDICATION (jamais ceux de la réplique) qui justifient ton choix, même quand l'état est null.",
    "Exemples :",
    // Exemples volontairement absents des textes d'essai : la preuve ne doit pas réciter la consigne.
    '- indication « Il brandit le poing vers la porte. » → {"state":"determined","quote":"Il brandit le poing"} (une menace, une résolution) ;',
    '- indication « Elle range ses lunettes dans leur étui. » → {"state":null,"quote":"Elle range ses lunettes dans leur étui"} (un geste neutre) ;',
    '- indication « Il revient en courant. » → {"state":"breathless","quote":"Il revient en courant"} ;',
    '- indication « Elle se détourne pour cacher ses larmes. » → {"state":"crying","quote":"cacher ses larmes"}.',
    "En cas de doute : null.",
    'Réponds uniquement en JSON : {"items":[{"id":"c1","state":"…"|null,"quote":"…"}]}.'
  ].join("\n");
}

export function stateUserPrompt(candidates: readonly StateCandidate[], roles: readonly ProposalRole[]): string {
  const nameOf = (roleId: string): string => roles.find((role) => role.roleId === roleId)?.name ?? roleId;
  return candidates.map((candidate) => `${candidate.id} | ${nameOf(candidate.roleId)} | INDICATION : ${candidate.context} | réplique qui suit : ${candidate.reply.slice(0, MAX_REPLY_CHARS)}`).join("\n");
}

export type StateOutcome =
  | { readonly status: "ok"; readonly check: StateCheck; readonly candidates: number; readonly durationMs: number }
  | { readonly status: "gpu-yield" }
  | { readonly status: "failed"; readonly reason: string };

/** Un appel, hors du chemin de lecture ; mode jeu : aucun appel. */
export async function directStates(regions: readonly ScriptRegion[], roles: readonly ProposalRole[], llm: ProposalLlm, options: { readonly gpuYield: () => boolean; readonly signal?: AbortSignal }): Promise<StateOutcome> {
  if (options.gpuYield()) {
    return { status: "gpu-yield" };
  }
  const candidates = stateCandidates(regions);
  if (candidates.length === 0) {
    return { status: "ok", check: { directions: [], rejected: [] }, candidates: 0, durationMs: 0 };
  }
  const started = Date.now();
  try {
    const raw = await llm.structured(stateSystemPrompt(), stateUserPrompt(candidates, roles), stateJsonSchema(candidates), options.signal);
    return { status: "ok", check: verifyStateDirections(raw, candidates, roles), candidates: candidates.length, durationMs: Date.now() - started };
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.name : "error" };
  }
}
