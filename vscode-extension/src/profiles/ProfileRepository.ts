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
import { ProfileCollectionSchema } from "../core/profile.schema.js";
import { DEFAULT_PROFILES, FAITHFUL_PROFILE } from "./defaults.js";

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

  /** The profile to use for a new session: last selected, else the collection default. */
  async getSelected(): Promise<VoiceProfile> {
    const collection = await this.load();
    const lastSelectedId = this.globalState.get<string>(LAST_SELECTED_KEY);
    const byId = (id: string | undefined): VoiceProfile | undefined =>
      id === undefined ? undefined : collection.profiles.find((profile) => profile.id === id);
    const found = byId(lastSelectedId) ?? byId(collection.defaultProfileId) ?? collection.profiles[0];
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

  private defaultCollection(): ProfileCollection {
    return {
      schemaVersion: 1,
      defaultProfileId: FAITHFUL_PROFILE.id,
      profiles: [...DEFAULT_PROFILES]
    };
  }

  private async write(collection: ProfileCollection): Promise<void> {
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmp, `${JSON.stringify(collection, null, 2)}\n`, "utf8");
    await fs.rename(tmp, this.filePath);
  }
}
