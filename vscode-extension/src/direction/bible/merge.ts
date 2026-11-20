/**
 * Effective bible = `user` ⊂ `series` ⊂ `document` (ADR-015 §4, "précédence").
 * The most specific scope wins, except that a fact `by: "user"` or `locked`
 * is never replaced by a model-authored one, whatever its scope. Series and
 * user bibles only hold user facts, so a document's model fact never
 * overrides them; a user fact of the document does.
 */

import type { Bible, Fact, Role, RoleState, VoiceAssignment } from "../../core/direction.js";

export interface BibleLayers {
  readonly user?: Bible | undefined;
  readonly series?: Bible | undefined;
  readonly document?: Bible | undefined;
}

const protectedFact = (fact: { readonly by: string; readonly locked?: boolean | undefined }): boolean =>
  fact.by === "user" || fact.locked === true;

function pickFact(base: Fact | undefined, over: Fact): Fact {
  return base !== undefined && over.by !== "user" && protectedFact(base) ? base : over;
}

function pickAssignment(base: VoiceAssignment | undefined, over: VoiceAssignment): VoiceAssignment {
  return base !== undefined && over.by !== "user" && protectedFact(base) ? base : over;
}

function mergeRole(base: Role | undefined, over: Role): Role {
  if (base === undefined) {
    return over;
  }
  const traits: Record<string, Fact> = { ...base.traits };
  for (const [key, fact] of Object.entries(over.traits)) {
    traits[key] = pickFact(Object.prototype.hasOwnProperty.call(traits, key) ? traits[key] : undefined, fact);
  }
  const assignments: Record<string, VoiceAssignment> = { ...(base.voice.assignments ?? {}) };
  for (const [providerId, assignment] of Object.entries(over.voice.assignments ?? {})) {
    assignments[providerId] = pickAssignment(
      Object.prototype.hasOwnProperty.call(assignments, providerId) ? assignments[providerId] : undefined,
      assignment
    );
  }
  const descriptor =
    over.voice.descriptor === undefined ? base.voice.descriptor : pickFact(base.voice.descriptor, over.voice.descriptor);
  const states: RoleState[] = [...(base.states ?? [])];
  for (const state of over.states ?? []) {
    if (!states.some((s) => s.label === state.label && s.fromSourceId === state.fromSourceId)) {
      states.push(state);
    }
  }
  return {
    id: base.id,
    names: [...new Set([...base.names, ...over.names])],
    traits,
    ...(states.length > 0 ? { states } : {}),
    voice: {
      ...(descriptor !== undefined ? { descriptor } : {}),
      ...(Object.keys(assignments).length > 0 ? { assignments } : {})
    }
  };
}

export function effectiveBible(layers: BibleLayers): Bible {
  const ordered = [layers.user, layers.series, layers.document].filter((bible): bible is Bible => bible !== undefined);
  const top = ordered[ordered.length - 1];
  if (top === undefined) {
    throw new RangeError("effectiveBible needs at least one layer");
  }
  let narrator: Role | undefined;
  const characters = new Map<string, Role>();
  for (const bible of ordered) {
    narrator = mergeRole(narrator, bible.narrator);
    for (const role of bible.characters) {
      characters.set(role.id, mergeRole(characters.get(role.id), role));
    }
  }
  return {
    schemaVersion: top.schemaVersion,
    scope: top.scope,
    scopeKey: top.scopeKey,
    revision: ordered.reduce((sum, bible) => sum + bible.revision, 0),
    ...(layers.document?.analysis !== undefined ? { analysis: layers.document.analysis } : {}),
    narrator: narrator as Role,
    characters: [...characters.values()]
  };
}
