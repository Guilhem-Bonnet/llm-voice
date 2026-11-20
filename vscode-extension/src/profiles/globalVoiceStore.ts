/**
 * `global-voice.json` and the ADR-017 §2 migration sequence, on `node:fs` alone so
 * vitest can drive them on a real folder, races and crashes included.
 *
 * The file holds the voice and nothing else (ADR-017 §1.2): the state of the
 * migration is the mark inside `profiles.json`. Written like `profiles.json`
 * (temporary file then rename) and validated on every read. An unreadable file is
 * an error naming it, never a reason to overwrite it.
 */

import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { GlobalVoice, ProfileCollection } from "../core/profile.js";
import { GlobalVoiceFileSchema, ProfileCollectionSchema } from "../core/profile.schema.js";
import {
  classifyModes,
  computeInitialVoice,
  migrateProfileCollection,
  type InitialVoiceInput,
  type VoiceNotice
} from "./migrations.js";
import type { TtsSettings } from "../pipeline/resolveProviderConfig.js";

export const PROFILES_FILE = "profiles.json";
export const GLOBAL_VOICE_FILE = "global-voice.json";
export const PRE_MIGRATION_BACKUP_FILE = "profiles.pre-adr-017.json";

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export function isEnoent(error: unknown): boolean {
  return isNodeError(error) && error.code === "ENOENT";
}

function temporaryNameFor(filePath: string): string {
  // `pid` + `Date.now()` alone can collide: two writes issued in quick succession
  // from the same process can land in the same millisecond, so the second
  // `rename()` fails ENOENT once the first has consumed that path.
  return `${filePath}.tmp-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

/**
 * Windows can transiently hold a brief exclusive handle on the destination of a
 * rename (AV/indexer scan, a previous read not yet released), which surfaces as
 * `EPERM`/`EBUSY` even though nothing in this process still has the file open: the
 * retry is the fix, not a real conflict to resolve. Linux/macOS `rename(2)` never
 * raises these for a same-volume replace, so the loop is a no-op there.
 */
async function renameWithRetry(tmp: string, dest: string, attempts = 5, delayMs = 25): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await fs.rename(tmp, dest);
      return;
    } catch (error) {
      const retryable = isNodeError(error) && (error.code === "EPERM" || error.code === "EBUSY");
      if (!retryable || attempt >= attempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
}

/** Replaces `filePath` at once: a reader sees the old content or the new one, never half of it. */
export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const tmp = temporaryNameFor(filePath);
  await fs.writeFile(tmp, content, "utf8");
  await renameWithRetry(tmp, filePath);
}

/**
 * Creates `filePath` only if it does not exist, whole or not at all: a hard link to
 * a temporary file, falling back to `wx` where links are refused. `false` when
 * someone else's file was already there; it is left untouched.
 */
export async function createFileExclusive(filePath: string, content: string | Uint8Array): Promise<boolean> {
  const tmp = temporaryNameFor(filePath);
  await fs.writeFile(tmp, content);
  try {
    await fs.link(tmp, filePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      return false;
    }
    try {
      await fs.writeFile(filePath, content, { flag: "wx" });
      return true;
    } catch (fallbackError) {
      if (isNodeError(fallbackError) && fallbackError.code === "EEXIST") {
        return false;
      }
      throw fallbackError;
    }
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

function serializeVoice(voice: GlobalVoice): string {
  return `${JSON.stringify({ schemaVersion: 1, voice }, null, 2)}\n`;
}

/** The voice on disk; `undefined` if there is no file. Throws, naming the file, if it is unreadable. */
export async function readGlobalVoice(storageDir: string): Promise<GlobalVoice | undefined> {
  const filePath = path.join(storageDir, GLOBAL_VOICE_FILE);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isEnoent(error)) {
      return undefined;
    }
    throw error;
  }
  try {
    return GlobalVoiceFileSchema.parse(JSON.parse(raw)).voice as GlobalVoice;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${GLOBAL_VOICE_FILE} est illisible, corrigez ou supprimez ce fichier. ${detail}`);
  }
}

export async function writeGlobalVoice(storageDir: string, voice: GlobalVoice): Promise<void> {
  await writeFileAtomic(path.join(storageDir, GLOBAL_VOICE_FILE), serializeVoice(voice));
}

/** Poses `voice` unless a voice is already there. The loser of a race reads the winner. */
export async function createGlobalVoice(
  storageDir: string,
  voice: GlobalVoice
): Promise<{ voice: GlobalVoice; created: boolean }> {
  const created = await createFileExclusive(path.join(storageDir, GLOBAL_VOICE_FILE), serializeVoice(voice));
  if (created) {
    return { voice, created };
  }
  const existing = await readGlobalVoice(storageDir);
  if (existing === undefined) {
    throw new Error(`${GLOBAL_VOICE_FILE} a disparu pendant sa création.`);
  }
  return { voice: existing, created: false };
}

export function serializeCollection(collection: ProfileCollection): string {
  return `${JSON.stringify(collection, null, 2)}\n`;
}

async function readBackup(storageDir: string): Promise<ProfileCollection | undefined> {
  try {
    const raw = await fs.readFile(path.join(storageDir, PRE_MIGRATION_BACKUP_FILE), "utf8");
    return ProfileCollectionSchema.parse(JSON.parse(raw)) as ProfileCollection;
  } catch {
    // The backup only ever serves as a proof; without a readable one there is none.
    return undefined;
  }
}

export interface VoiceMigrationInput {
  /** `profiles.json` exactly as read: the backup is this, to the byte. */
  rawProfiles: Uint8Array;
  /** The same content, validated; no `voiceMigration`. */
  collection: ProfileCollection;
  lastSelectedId: string | undefined;
  settings: TtsSettings;
  sourceTargets: readonly string[];
  legacyDefaultProfile?: string | undefined;
  /** Test only: called after each step, to stop the sequence there. */
  afterStep?: (step: "backup" | "voice" | "classify") => void | Promise<void>;
}

export interface VoiceMigrationOutcome {
  collection: ProfileCollection;
  voice: GlobalVoice;
  /** Written by the caller, last (step 4): `globalState` is not a file of this folder. */
  lastSelectedId?: string;
  /** Only for the run that posed the voice: two windows, one message. */
  notice?: VoiceNotice;
}

/**
 * ADR-017 §2, the sequence, run only when the mark is absent. Every step tolerates
 * a replay and a concurrent run: the backup and the voice are exclusive creations,
 * the classification is deterministic, and the voice is written here only when it
 * does not exist, so a concurrent `setGlobalVoice` is never overwritten.
 */
export async function runVoiceMigration(storageDir: string, input: VoiceMigrationInput): Promise<VoiceMigrationOutcome> {
  // 1. Backup, before anything can change the file. Never overwritten: it stays
  // the state from before the first upgrade.
  await createFileExclusive(path.join(storageDir, PRE_MIGRATION_BACKUP_FILE), input.rawProfiles);
  await input.afterStep?.("backup");

  // v1 to v2 happens here, on the file as read, so that a single write carries both.
  const { collection: current } = migrateProfileCollection(input.collection);

  // 2. Voice: read and never recomputed if it exists.
  let voice = await readGlobalVoice(storageDir);
  let notice: VoiceNotice | undefined;
  if (voice === undefined) {
    const initialInput: InitialVoiceInput = {
      lastSelectedId: input.lastSelectedId,
      settings: input.settings,
      backup: await readBackup(storageDir)
    };
    const initial = computeInitialVoice(current, initialInput);
    const posed = await createGlobalVoice(storageDir, initial.voice);
    voice = posed.voice;
    if (posed.created) {
      notice = initial.notice;
    }
  }
  await input.afterStep?.("voice");

  // 3. Classification, against the voice that actually won.
  const classification = classifyModes(current, {
    voice,
    settings: input.settings,
    lastSelectedId: input.lastSelectedId,
    sourceTargets: input.sourceTargets,
    legacyDefaultProfile: input.legacyDefaultProfile
  });
  const profilesPath = path.join(storageDir, PROFILES_FILE);
  const beforeRename = ProfileCollectionSchema.parse(JSON.parse(await fs.readFile(profilesPath, "utf8"))) as ProfileCollection;
  let collection = classification.collection;
  if (beforeRename.voiceMigration !== undefined) {
    // Another window got there first: what it wrote stands.
    collection = beforeRename;
  } else {
    await writeFileAtomic(profilesPath, serializeCollection(collection));
  }
  await input.afterStep?.("classify");

  return {
    collection,
    voice,
    ...(classification.lastSelectedId !== undefined ? { lastSelectedId: classification.lastSelectedId } : {}),
    ...(notice !== undefined ? { notice } : {})
  };
}
