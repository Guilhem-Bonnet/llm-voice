/**
 * Scope references and their on-disk identities (ADR-015 §4, "Portées" and
 * "Stockage local"). Pure: no I/O, no `vscode`.
 *
 * - A document is identified by `sha256(clé)`: the file name and the bible's
 *   `scopeKey` are the hash, never the URI or the text (the clé may be a file
 *   path; it must not leak into a file name or a log).
 * - A series is a name chosen by the user (or the implicit `source:<id>` of
 *   the inbox); its file name is derived so that any name is safe and two
 *   names never share a file, even on a case-insensitive filesystem.
 */

import { createHash } from "node:crypto";

import { isSafePathSegment } from "../../core/safePath.js";

export interface DocumentScope {
  readonly scope: "document";
  /** `sha256(clé)` as 64 lowercase hex (`DOCUMENT_KEY_PATTERN`). */
  readonly documentKey: string;
  /** false = memory only, nothing is ever written for this document. */
  readonly persist: boolean;
}

export interface SeriesScope {
  readonly scope: "series";
  readonly name: string;
}

export interface UserScope {
  readonly scope: "user";
}

export type ScopeRef = DocumentScope | SeriesScope | UserScope;
export type PersistentScopeRef = SeriesScope | UserScope;

export const USER_SCOPE: UserScope = { scope: "user" };

export const SERIES_NAME_MAX_CHARS = 200;

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Document identifier: the hash of the clé (normalised URI, inbox file name, text fingerprint). */
export function documentKeyOf(rawKey: string): string {
  return sha256Hex(rawKey);
}

export function documentScope(rawKey: string, options: { readonly persist: boolean }): DocumentScope {
  return { scope: "document", documentKey: documentKeyOf(rawKey), persist: options.persist };
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/;

export function seriesScope(name: string): SeriesScope {
  if (name.trim().length === 0 || Array.from(name).length > SERIES_NAME_MAX_CHARS || CONTROL_CHARS.test(name)) {
    throw new RangeError("invalid series name");
  }
  return { scope: "series", name };
}

/** File-name stem of a series. `n-` + the name when it is already a safe lowercase segment, otherwise `h-` + a hash. */
export function seriesSlug(name: string): string {
  if (name === name.toLowerCase() && name.length <= 100 && isSafePathSegment(name)) {
    return `n-${name}`;
  }
  return `h-${sha256Hex(name).slice(0, 32)}`;
}

/** Stable identity of a scope, without any content: used for cache keys and rejection logs. */
export function scopeId(ref: ScopeRef): string {
  switch (ref.scope) {
    case "document":
      return ref.documentKey;
    case "series":
      return seriesSlug(ref.name);
    case "user":
      return "user";
  }
}

/** `Bible.scopeKey` for a scope. */
export function scopeKeyOf(ref: ScopeRef): string {
  switch (ref.scope) {
    case "document":
      return ref.documentKey;
    case "series":
      return ref.name;
    case "user":
      return "user";
  }
}

export type DocumentSourceKind = "file" | "inbox" | "selection" | "clipboard";

/**
 * Whether a document's bible is written to disk (ADR-015 §4): a workspace
 * file, yes; an inbox message only with the `llmVoice.direction.persistInboxBibles`
 * opt-in; a selection or the clipboard only when the user chose "Conserver".
 */
export function shouldPersistDocument(
  kind: DocumentSourceKind,
  options: { readonly persistInboxBibles: boolean; readonly keep?: boolean }
): boolean {
  switch (kind) {
    case "file":
      return true;
    case "inbox":
      return options.persistInboxBibles || options.keep === true;
    case "selection":
    case "clipboard":
      return options.keep === true;
  }
}
