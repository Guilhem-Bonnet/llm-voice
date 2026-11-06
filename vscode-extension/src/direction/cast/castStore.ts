/**
 * La distribution dans la bible (ADR-018 §3), sans `vscode` : portée `document`, rangée par
 * moteur. `addRole` part en origine `analyst` : `casting` n'a droit qu'à `assignVoice`
 * (`MODEL_EVENT_TYPES`), et un texte ne peut donc jamais écrire `user`.
 */

import type { BibleStore } from "../bible/BibleStore.js";
import type { DocumentScope } from "../bible/scopes.js";
import { castVoices, type CastEntry, type CastResult, type CastVoice, type ExistingAssignment } from "./casting.js";

export interface CastParse {
  readonly roles: readonly { readonly roleId: string; readonly name?: string; readonly lines?: number }[];
  readonly declarations: readonly { readonly roleId: string; readonly voiceText: string }[];
}

export interface CastContext {
  readonly providerId: string;
  readonly voices: readonly CastVoice[];
  readonly narratorVoice: string | undefined;
  /** Une sélection dans un fichier : relit la distribution du fichier, sans y écrire. */
  readonly readOnly?: boolean;
}

export async function castFromBible(store: BibleStore, scope: DocumentScope, parse: CastParse, context: CastContext): Promise<CastResult> {
  const { bible } = await store.read(scope);
  const existing: Record<string, ExistingAssignment> = {};
  for (const role of bible.characters) {
    const assignment = role.voice.assignments?.[context.providerId];
    if (assignment !== undefined) {
      existing[role.id] = {
        voiceRef: assignment.voiceRef,
        by: assignment.by === "user" ? "user" : "casting",
        ...(assignment.locked === true ? { locked: true } : {})
      };
    }
  }
  const known = new Set(bible.characters.map((role) => role.id));
  const result = castVoices({
    documentKey: scope.documentKey,
    voices: context.voices,
    narratorVoice: context.narratorVoice,
    roles: parse.roles,
    existing,
    declarations: parse.declarations
  });
  if (context.readOnly === true) {
    return result;
  }
  for (const entry of result.entries) {
    if (!known.has(entry.roleId)) {
      await store.appendModelEvent(scope, "analyst", { type: "addRole", roleId: entry.roleId, names: [entry.name.slice(0, 80)] });
    }
  }
  for (const { roleId, voiceRef } of result.newAssignments) {
    await store.appendModelEvent(scope, "casting", { type: "assignVoice", roleId, providerId: context.providerId, voiceRef });
  }
  return result;
}

/** Le seul chemin de `by: user` : une commande de l'interface, jamais un texte. */
export async function recordUserVoice(store: BibleStore, scope: DocumentScope, roleId: string, providerId: string, voiceRef: string): Promise<void> {
  const result = await store.appendUserEvent(scope, {
    type: "userEdit",
    target: { kind: "assignment", roleId, providerId, voiceRef, locked: true }
  });
  if (result.status === "refused") {
    throw new Error("La voix n'a pas pu être enregistrée.");
  }
}

export type { CastEntry, CastResult };
