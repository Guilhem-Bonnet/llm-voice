/**
 * Distribution automatique (ADR-018 §3) : pure, stable par document, ordre haché fixe.
 * Le seul moyen de l'orienter est le choix de l'utilisateur : ce module ne lit des voix que
 * leur identifiant et leur étiquette, et ne déduit rien d'autre d'elles.
 */

import { createHash } from "node:crypto";

export interface CastVoice {
  readonly id: string;
  readonly label: string;
}

export interface ExistingAssignment {
  readonly voiceRef: string;
  readonly by: "user" | "casting";
  readonly locked?: boolean;
}

export interface CastInput {
  readonly documentKey: string;
  /** Voix réellement disponibles du moteur. */
  readonly voices: readonly CastVoice[];
  /** La voix effective du mode : jamais donnée à un personnage. */
  readonly narratorVoice: string | undefined;
  /** Par ordre d'apparition. */
  readonly roles: readonly { readonly roleId: string; readonly name?: string; readonly lines?: number }[];
  readonly existing: Readonly<Record<string, ExistingAssignment>>;
  readonly declarations: readonly { readonly roleId: string; readonly voiceText: string }[];
}

export interface CastEntry {
  readonly roleId: string;
  readonly name: string;
  readonly lines: number;
  /** Absente : cette voix n'existe plus sur le serveur, le personnage parle avec le narrateur. */
  readonly voice: string | undefined;
  readonly origin: "user" | "casting";
  readonly locked: boolean;
  readonly shared: boolean;
  /** Choix verrouillé devenu la voix du narrateur : gardé et signalé (ADR-017 §4). */
  readonly narratorClash: boolean;
  readonly unavailable: boolean;
}

export interface CastResult {
  readonly entries: readonly CastEntry[];
  /** Ce que la bible ne porte pas encore. */
  readonly newAssignments: readonly { readonly roleId: string; readonly voiceRef: string }[];
}

function hash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** L'ordre propre au document : deux documents n'ont pas la même distribution. */
export function voiceOrder<T extends CastVoice>(documentKey: string, voices: readonly T[]): T[] {
  return [...voices]
    .map((voice) => ({ voice, rank: hash(documentKey + voice.id) }))
    .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))
    .map((row) => row.voice);
}

function folded(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** `% nom = voix` : identifiant ou prénom du catalogue, sans casse ni accent. */
export function resolveVoiceRef(text: string, voices: readonly CastVoice[]): string | undefined {
  const wanted = folded(text);
  return voices.find((voice) => folded(voice.id) === wanted)?.id ?? voices.find((voice) => folded(voice.label) === wanted)?.id;
}

export function castVoices(input: CastInput): CastResult {
  const pool = voiceOrder(input.documentKey, input.voices).filter((voice) => voice.id !== input.narratorVoice);
  const available = new Set(input.voices.map((voice) => voice.id));
  const declared = new Map(input.declarations.map((item) => [item.roleId, resolveVoiceRef(item.voiceText, input.voices)]));
  const chosen = new Map<string, Omit<CastEntry, "shared" | "name" | "lines" | "roleId">>();
  const uses = new Map<string, number>();
  const newAssignments: { roleId: string; voiceRef: string }[] = [];

  const take = (roleId: string, entry: Omit<CastEntry, "shared" | "name" | "lines" | "roleId">): void => {
    chosen.set(roleId, entry);
    if (entry.voice !== undefined) {
      uses.set(entry.voice, (uses.get(entry.voice) ?? 0) + 1);
    }
  };
  const plain = { locked: false, narratorClash: false, unavailable: false };

  // Le plus fort d'abord, pour que les automatiques ne prennent pas une voix déjà tenue.
  for (const { roleId } of input.roles) {
    const existing = input.existing[roleId];
    if (existing !== undefined && (existing.by === "user" || existing.locked === true)) {
      const here = available.has(existing.voiceRef);
      take(roleId, {
        voice: here ? existing.voiceRef : undefined,
        origin: "user",
        locked: true,
        narratorClash: existing.voiceRef === input.narratorVoice,
        unavailable: !here
      });
    }
  }
  for (const { roleId } of input.roles) {
    const voice = declared.get(roleId);
    if (!chosen.has(roleId) && voice !== undefined && voice !== input.narratorVoice) {
      take(roleId, { voice, origin: "casting", ...plain });
      if (input.existing[roleId] === undefined) {
        newAssignments.push({ roleId, voiceRef: voice });
      }
    }
  }
  for (const { roleId } of input.roles) {
    const existing = input.existing[roleId];
    if (!chosen.has(roleId) && existing !== undefined && available.has(existing.voiceRef) && existing.voiceRef !== input.narratorVoice) {
      take(roleId, { voice: existing.voiceRef, origin: "casting", ...plain });
    }
  }
  for (const { roleId } of input.roles) {
    if (chosen.has(roleId)) {
      continue;
    }
    let best: string | undefined;
    let bestUses = Number.POSITIVE_INFINITY;
    for (const voice of pool) {
      const count = uses.get(voice.id) ?? 0;
      if (count < bestUses) {
        best = voice.id;
        bestUses = count;
      }
    }
    take(roleId, { voice: best, origin: "casting", ...plain });
    // Une attribution refaite n'écrit rien : la bible garderait l'ancienne, et le calcul est stable.
    if (best !== undefined && input.existing[roleId] === undefined) {
      newAssignments.push({ roleId, voiceRef: best });
    }
  }

  return {
    entries: input.roles.map(({ roleId, name, lines }) => {
      const entry = chosen.get(roleId) as Omit<CastEntry, "shared" | "name" | "lines" | "roleId">;
      return {
        roleId,
        name: name ?? roleId,
        lines: lines ?? 0,
        ...entry,
        shared: entry.voice !== undefined && (uses.get(entry.voice) ?? 0) > 1
      };
    }),
    newAssignments
  };
}
