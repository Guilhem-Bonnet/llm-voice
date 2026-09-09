/**
 * `profiles.json` storage (ADR-004): created with the four default profiles
 * (CdC §19) on first launch, read/written under `globalStorageUri`, and
 * revalidated with `ProfileCollectionSchema` (AC-SEC-05) on every read — an
 * externally hand-edited file that no longer parses or validates is
 * surfaced as an error rather than silently overwritten with defaults.
 *
 * The last selected profile id lives in `globalState`
 * (`llmVoice.profiles.lastSelectedId`), like every other "perte tolérable"
 * fact in ADR-004's storage table.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import type { ProfileCollection, VoiceProfile } from "../core/profile.js";
import { ProfileCollectionSchema, parseVoiceProfile } from "../core/profile.schema.js";
import type { SourceType } from "../core/source.js";
import { DEFAULT_PROFILES, SYSTEM_VOICE_PROFILE } from "./defaults.js";
import { resolveDefaultProfileId, type BySourceSetting } from "./bySource.js";

const LAST_SELECTED_KEY = "llmVoice.profiles.lastSelectedId";

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isEnoent(error: unknown): boolean {
  return isNodeError(error) && error.code === "ENOENT";
}

export class ProfileRepository {
  private readonly filePath: string;

  constructor(
    private readonly globalStorageDir: string,
    private readonly globalState: vscode.Memento
  ) {
    this.filePath = path.join(globalStorageDir, "profiles.json");
  }

  get uri(): vscode.Uri {
    return vscode.Uri.file(this.filePath);
  }

  /** Reads `profiles.json`, creating it with the defaults on first launch. */
  async load(): Promise<ProfileCollection> {
    await fs.mkdir(this.globalStorageDir, { recursive: true });
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if (!isEnoent(error)) {
        throw error;
      }
      const initial = this.defaultCollection();
      await this.write(initial);
      return initial;
    }
    // Throws (SyntaxError or a Zod error) on malformed content: a broken
    // profiles.json must be fixed by the user, never silently replaced.
    return ProfileCollectionSchema.parse(JSON.parse(raw)) as ProfileCollection;
  }

  async list(): Promise<readonly VoiceProfile[]> {
    return (await this.load()).profiles;
  }

  /**
   * The profile to use for a new session: an explicit `bySource` default for
   * `sourceType` (CdC §47), else the last selected profile, else the
   * collection's own default — falling further back to the first profile if
   * that id no longer exists (a deleted or renamed profile must never throw
   * here).
   */
  async getSelected(sourceType?: SourceType, bySource?: BySourceSetting): Promise<VoiceProfile> {
    const collection = await this.load();
    const lastSelectedId = this.globalState.get<string>(LAST_SELECTED_KEY);
    const wantedId = resolveDefaultProfileId(sourceType, bySource, lastSelectedId, collection.defaultProfileId);
    const byId = (id: string | undefined): VoiceProfile | undefined =>
      id === undefined ? undefined : collection.profiles.find((profile) => profile.id === id);
    const found = byId(wantedId) ?? byId(collection.defaultProfileId) ?? collection.profiles[0];
    if (found === undefined) {
      throw new Error("profiles.json contains no profile");
    }
    return found;
  }

  async select(id: string): Promise<void> {
    await this.globalState.update(LAST_SELECTED_KEY, id);
  }

  /** Opens `profiles.json` for manual editing (`Open Profiles` command). */
  async openInEditor(): Promise<void> {
    await this.load();
    const document = await vscode.workspace.openTextDocument(this.uri);
    await vscode.window.showTextDocument(document);
  }

  /** `Set Default Profile` (CdC §47): rejects an unknown id rather than silently ignoring it. */
  async setDefault(id: string): Promise<void> {
    const collection = await this.load();
    if (!collection.profiles.some((profile) => profile.id === id)) {
      throw new Error(`LLM Voice : profil inconnu « ${id} ».`);
    }
    await this.write({ ...collection, defaultProfileId: id });
  }

  /** `Duplicate Profile` (CdC §47): copies with a unique id, "(copie)" suffixed label. */
  async duplicate(id: string): Promise<VoiceProfile> {
    const collection = await this.load();
    const source = collection.profiles.find((profile) => profile.id === id);
    if (source === undefined) {
      throw new Error(`LLM Voice : profil inconnu « ${id} ».`);
    }
    const newId = this.uniqueId(`${source.id}-copie`, collection.profiles);
    const copy: VoiceProfile = { ...source, id: newId, label: `${source.label} (copie)` };
    await this.write({ ...collection, profiles: [...collection.profiles, copy] });
    return copy;
  }

  /**
   * `Delete Profile` (CdC §47). Refuses to empty `profiles.json` (a
   * `ProfileCollection` always needs at least one profile — the same
   * invariant `ProfileCollectionSchema.profiles` enforces, `.min(1)`), and
   * reassigns `defaultProfileId` to the first remaining profile when the one
   * deleted was the default.
   */
  async delete(id: string): Promise<void> {
    const collection = await this.load();
    if (collection.profiles.length <= 1) {
      throw new Error("LLM Voice : impossible de supprimer le dernier profil.");
    }
    const profiles = collection.profiles.filter((profile) => profile.id !== id);
    if (profiles.length === collection.profiles.length) {
      throw new Error(`LLM Voice : profil inconnu « ${id} ».`);
    }
    const first = profiles[0];
    if (first === undefined) {
      throw new Error("LLM Voice : impossible de supprimer le dernier profil.");
    }
    const defaultProfileId = collection.defaultProfileId === id ? first.id : collection.defaultProfileId;
    await this.write({ ...collection, profiles, defaultProfileId });
  }

  /**
   * `Import Profile` (AC-SEC-05): validates against `VoiceProfileSchema`
   * before touching `profiles.json` — an invalid profile never lands on
   * disk. A colliding id is disambiguated rather than silently overwriting
   * an existing profile; the caller (`Pipeline.importProfile`) is
   * responsible for the "☁ Remote provider" warning (`isRemoteProfile`).
   */
  async import(rawJson: string): Promise<VoiceProfile> {
    const parsed: unknown = JSON.parse(rawJson);
    const profile = parseVoiceProfile(parsed);
    const collection = await this.load();
    const id = this.uniqueId(profile.id, collection.profiles);
    const imported: VoiceProfile = id === profile.id ? profile : { ...profile, id };
    await this.write({ ...collection, profiles: [...collection.profiles, imported] });
    return imported;
  }

  /** `Export Profile`: the profile alone, pretty-printed, ready to write to a `.json` file. */
  async export(id: string): Promise<string> {
    const collection = await this.load();
    const profile = collection.profiles.find((candidate) => candidate.id === id);
    if (profile === undefined) {
      throw new Error(`LLM Voice : profil inconnu « ${id} ».`);
    }
    return `${JSON.stringify(profile, null, 2)}\n`;
  }

  private uniqueId(base: string, existing: readonly VoiceProfile[]): string {
    if (!existing.some((profile) => profile.id === base)) {
      return base;
    }
    let suffix = 2;
    while (existing.some((profile) => profile.id === `${base}-${suffix}`)) {
      suffix += 1;
    }
    return `${base}-${suffix}`;
  }

  /**
   * S7.1: `SYSTEM_VOICE_PROFILE` is the first-launch default — a fresh
   * install must produce sound with zero server/config (the user problem
   * this story exists to fix), not silently fail against a Chatterbox
   * server that was never started.
   */
  private defaultCollection(): ProfileCollection {
    return {
      schemaVersion: 1,
      defaultProfileId: SYSTEM_VOICE_PROFILE.id,
      profiles: [...DEFAULT_PROFILES]
    };
  }

  private async write(collection: ProfileCollection): Promise<void> {
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmp, `${JSON.stringify(collection, null, 2)}\n`, "utf8");
    await fs.rename(tmp, this.filePath);
  }
}
