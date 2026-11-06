/**
 * `profiles.json` and the voice around it (ADR-004, ADR-017), free of `vscode` so
 * every rule here runs under vitest; `ProfileRepository` adds what needs an editor.
 *
 * Created with the default modes (CdC §19) on first launch, read/written under
 * `globalStorageUri`, and revalidated with `ProfileCollectionSchema` (AC-SEC-05) on
 * every read: an externally hand-edited file that no longer parses or validates is
 * surfaced as an error rather than silently overwritten with defaults.
 *
 * The last selected mode id lives in `globalState`
 * (`llmVoice.profiles.lastSelectedId`), like every other "perte tolérable" fact in
 * ADR-004's storage table.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { GlobalVoice, ProfileCollection, TtsBinding, VoiceProfile } from "../core/profile.js";
import { ProfileCollectionSchema, parseGlobalVoice, parseVoiceProfile } from "../core/profile.schema.js";
import type { SourceType } from "../core/source.js";
import type { TtsSettings } from "../pipeline/resolveProviderConfig.js";
import { resolveDefaultProfileId, type BySourceSetting } from "./bySource.js";
import { DEFAULT_PROFILES, FAITHFUL_PROFILE, INITIAL_GLOBAL_VOICE } from "./defaults.js";
import {
  createGlobalVoice,
  isEnoent,
  PROFILES_FILE,
  readGlobalVoice,
  runVoiceMigration,
  serializeCollection,
  writeFileAtomic,
  writeGlobalVoice
} from "./globalVoiceStore.js";
import {
  CURRENT_PROFILE_SCHEMA_VERSION,
  migrateProfileCollection,
  VOICE_MIGRATION_MARK,
  type VoiceNotice
} from "./migrations.js";
import { bindingOfGlobalVoice, effectiveModeOf, withEffectiveVoice, type EffectiveMode } from "./voiceResolution.js";

const LAST_SELECTED_KEY = "llmVoice.profiles.lastSelectedId";

/** What `vscode.Memento` offers and this store uses. */
export interface StateStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

/** What the migration needs to know of the settings, read only when it runs. */
export interface ProfileStoreEnvironment {
  ttsSettings(): TtsSettings;
  modesBySource(): BySourceSetting;
  legacyDefaultProfile(): string | undefined;
  onVoiceNotice(notice: VoiceNotice): void;
}

/** The resolution of one reading, with the mode as stored and as it speaks. */
export interface ReadingResolution extends EffectiveMode {
  voice: GlobalVoice;
}

export class ProfileStore {
  protected readonly filePath: string;

  constructor(
    protected readonly globalStorageDir: string,
    private readonly globalState: StateStore,
    private readonly environment: ProfileStoreEnvironment
  ) {
    this.filePath = path.join(globalStorageDir, PROFILES_FILE);
  }

  /**
   * Reads `profiles.json`, creating it with the defaults on first launch.
   *
   * Bug fix (voice-selection-not-applied, defect 2): a file still at
   * `schemaVersion: 1` (written before `"auto"`/the Chatterbox → Piper → système
   * fallback chain existed) is migrated in place (`migrateProfileCollection`) and
   * the result persisted immediately; every *other* read of it (a concurrent
   * instance, a crash between migrate and write) redoes the same idempotent
   * migration rather than reading half-migrated state.
   *
   * ADR-017 §2: a file without the mark goes through `runVoiceMigration`, whose
   * single write carries both migrations, after a backup of the bytes read here.
   */
  async load(): Promise<ProfileCollection> {
    await fs.mkdir(this.globalStorageDir, { recursive: true });
    let raw: Buffer;
    try {
      raw = await fs.readFile(this.filePath);
    } catch (error) {
      if (!isEnoent(error)) {
        throw error;
      }
      return this.createDefaults();
    }
    // Throws (SyntaxError or a Zod error) on malformed content: a broken
    // profiles.json must be fixed by the user, never silently replaced.
    const parsed = ProfileCollectionSchema.parse(JSON.parse(raw.toString("utf8"))) as ProfileCollection;
    if (parsed.voiceMigration === undefined) {
      return this.migrateVoiceModel(raw, parsed);
    }
    const { collection, migrated } = migrateProfileCollection(parsed);
    if (migrated) {
      await this.write(collection);
    }
    return collection;
  }

  private async migrateVoiceModel(raw: Buffer, collection: ProfileCollection): Promise<ProfileCollection> {
    const selectedBefore = this.lastSelectedId();
    const outcome = await runVoiceMigration(this.globalStorageDir, {
      rawProfiles: raw,
      collection,
      lastSelectedId: selectedBefore,
      settings: this.environment.ttsSettings(),
      sourceTargets: Object.values(this.environment.modesBySource()).filter(
        (id): id is string => typeof id === "string"
      ),
      legacyDefaultProfile: this.environment.legacyDefaultProfile()
    });
    // The migration takes time: a mode chosen in the meantime wins over what it computed.
    if (outcome.lastSelectedId !== undefined && this.lastSelectedId() === selectedBefore) {
      await this.globalState.update(LAST_SELECTED_KEY, outcome.lastSelectedId);
    }
    if (outcome.notice !== undefined) {
      this.environment.onVoiceNotice(outcome.notice);
    }
    return outcome.collection;
  }

  /**
   * First launch. The voice is created first: a window reading between the two
   * writes must not see a marked file without a voice, which means "reset".
   */
  private async createDefaults(): Promise<ProfileCollection> {
    await createGlobalVoice(this.globalStorageDir, { ...INITIAL_GLOBAL_VOICE });
    const initial: ProfileCollection = {
      schemaVersion: CURRENT_PROFILE_SCHEMA_VERSION,
      voiceMigration: VOICE_MIGRATION_MARK,
      defaultProfileId: FAITHFUL_PROFILE.id,
      profiles: [...DEFAULT_PROFILES]
    };
    await this.write(initial);
    return initial;
  }

  private lastSelectedId(): string | undefined {
    return this.globalState.get<string>(LAST_SELECTED_KEY);
  }

  async list(): Promise<readonly VoiceProfile[]> {
    return (await this.load()).profiles;
  }

  /**
   * The mode to use for a new session: an explicit `bySource` default for
   * `sourceType` (CdC §47), else the last selected one, else the collection's own
   * default, falling further back to the first if none of these ids exists (a
   * deleted mode, or the reserved `auto` of ADR-013, must never throw here).
   */
  async getSelected(sourceType?: SourceType, bySource?: BySourceSetting): Promise<VoiceProfile> {
    const collection = await this.load();
    const lastSelectedId = this.lastSelectedId();
    const wantedId = resolveDefaultProfileId(sourceType, bySource, lastSelectedId, collection.defaultProfileId);
    const byId = (id: string | undefined): VoiceProfile | undefined =>
      id === undefined ? undefined : collection.profiles.find((profile) => profile.id === id);
    const found =
      byId(wantedId) ?? byId(lastSelectedId) ?? byId(collection.defaultProfileId) ?? collection.profiles[0];
    if (found === undefined) {
      throw new Error("profiles.json contains no profile");
    }
    return found;
  }

  /**
   * The one resolution of a reading (ADR-017 §1.3). Everything downstream receives
   * `effective` and never needs to know where the voice came from.
   */
  async resolveReading(sourceType?: SourceType, modesBySource?: BySourceSetting): Promise<ReadingResolution> {
    const mode = await this.getSelected(sourceType, modesBySource);
    const voice = await this.getGlobalVoice();
    return { ...effectiveModeOf(mode, voice), voice };
  }

  /**
   * The modes a list offers, with the voice they speak with: what `isRemoteProfile`
   * must judge, or a remote global voice would leave every inheriting mode 🔒.
   */
  async listEffective(): Promise<readonly EffectiveMode[]> {
    const { profiles } = await this.load();
    const voice = await this.getGlobalVoice();
    const visible = profiles.filter((mode) => mode.hidden !== true);
    return (visible.length > 0 ? visible : profiles).map((mode) => effectiveModeOf(mode, voice));
  }

  /** A candidate mode, maybe unsaved (the editor's form), as it would speak. */
  async effectiveOf(mode: VoiceProfile): Promise<VoiceProfile> {
    return withEffectiveVoice(mode, await this.getGlobalVoice());
  }

  /**
   * The global voice, validated on every read. No file once classified: nothing
   * left to recompute it from, so the system voice, and one message (the exclusive
   * creation makes sure a single window says it).
   */
  async getGlobalVoice(): Promise<GlobalVoice> {
    const existing = await readGlobalVoice(this.globalStorageDir);
    if (existing !== undefined) {
      return existing;
    }
    await this.load();
    const afterLoad = await readGlobalVoice(this.globalStorageDir);
    if (afterLoad !== undefined) {
      return afterLoad;
    }
    const reset = await createGlobalVoice(this.globalStorageDir, { ...INITIAL_GLOBAL_VOICE });
    if (reset.created) {
      this.environment.onVoiceNotice({ kind: "voice-reset" });
    }
    return reset.voice;
  }

  /** Replaces the whole voice but its speed (ADR-017 §1.3): nothing of the former one can survive under it. */
  async setGlobalVoice(binding: TtsBinding & { providerId: string }): Promise<GlobalVoice> {
    const current = await this.getGlobalVoice();
    const next = parseGlobalVoice({ ...binding, speed: current.speed });
    await writeGlobalVoice(this.globalStorageDir, next);
    return next;
  }

  async setGlobalSpeed(speed: number): Promise<GlobalVoice> {
    const current = await this.getGlobalVoice();
    const next = parseGlobalVoice({ ...bindingOfGlobalVoice(current), speed });
    await writeGlobalVoice(this.globalStorageDir, next);
    return next;
  }

  /** The voice of one mode, for the edit of that mode alone; `undefined` makes it inherit again. */
  async setModeVoice(id: string, binding: TtsBinding | undefined): Promise<VoiceProfile> {
    return this.update(id, (current) => ({ ...current, tts: binding ?? {} }));
  }

  async select(id: string): Promise<void> {
    await this.globalState.update(LAST_SELECTED_KEY, id);
  }

  /** `Set Default Profile` (CdC §47): rejects an unknown id rather than silently ignoring it. */
  async setDefault(id: string): Promise<void> {
    const collection = await this.load();
    if (!collection.profiles.some((profile) => profile.id === id)) {
      throw new Error(`LLM Voice : profil inconnu « ${id} ».`);
    }
    await this.write({ ...collection, defaultProfileId: id });
  }

  /** `Duplicate Profile` (CdC §47): copies with a unique id, "(copie)" suffixed label; a copy is always offered. */
  async duplicate(id: string): Promise<VoiceProfile> {
    const collection = await this.load();
    const source = collection.profiles.find((profile) => profile.id === id);
    if (source === undefined) {
      throw new Error(`LLM Voice : profil inconnu « ${id} ».`);
    }
    const newId = this.uniqueId(`${source.id}-copie`, collection.profiles);
    const { hidden: _hidden, ...visible } = source;
    const copy: VoiceProfile = { ...visible, id: newId, label: `${source.label} (copie)` };
    await this.write({ ...collection, profiles: [...collection.profiles, copy] });
    return copy;
  }

  /**
   * The profile editor and `setModeVoice` (S8.2): the one generic, validated write
   * path for "change this existing profile's fields". `updater` receives the current
   * profile and returns the next one; `parseVoiceProfile` re-validates the result
   * before it ever reaches disk (AC-SEC-05 applies to a hand-built edit exactly like
   * an import), and the id may not change here.
   */
  async update(id: string, updater: (profile: VoiceProfile) => VoiceProfile): Promise<VoiceProfile> {
    const collection = await this.load();
    const index = collection.profiles.findIndex((profile) => profile.id === id);
    if (index === -1) {
      throw new Error(`LLM Voice : profil inconnu « ${id} ».`);
    }
    const current = collection.profiles[index]!;
    const candidate = updater(current);
    if (candidate.id !== id) {
      throw new Error("LLM Voice : l'identifiant d'un profil ne peut pas changer via update().");
    }
    const updated = parseVoiceProfile(candidate);
    const profiles = [...collection.profiles];
    profiles[index] = updated;
    await this.write({ ...collection, profiles });
    return updated;
  }

  /**
   * `Delete Profile` (CdC §47). Refuses to remove the last offered mode (a hidden one
   * cannot be chosen, and `ProfileCollectionSchema.profiles` needs one anyway), and
   * reassigns `defaultProfileId` to the first remaining offered one when needed.
   */
  async delete(id: string): Promise<void> {
    const collection = await this.load();
    const profiles = collection.profiles.filter((profile) => profile.id !== id);
    if (profiles.length === collection.profiles.length) {
      throw new Error(`LLM Voice : profil inconnu « ${id} ».`);
    }
    const first = profiles.find((profile) => profile.hidden !== true);
    if (first === undefined) {
      throw new Error("LLM Voice : impossible de supprimer le dernier profil.");
    }
    const defaultProfileId = collection.defaultProfileId === id ? first.id : collection.defaultProfileId;
    await this.write({ ...collection, profiles, defaultProfileId });
  }

  /**
   * `Import Profile` (AC-SEC-05): validates against `VoiceProfileSchema` before
   * touching `profiles.json`. A colliding id is disambiguated rather than silently
   * overwriting an existing profile; an imported file cannot hide what it adds; the
   * caller (`Pipeline.importProfile`) is responsible for the "☁ Remote provider"
   * warning (`isRemoteProfile`), on the mode as imported.
   */
  async import(rawJson: string): Promise<VoiceProfile> {
    const parsed: unknown = JSON.parse(rawJson);
    const { hidden: _hidden, ...profile } = parseVoiceProfile(parsed);
    const collection = await this.load();
    const id = this.uniqueId(profile.id, collection.profiles);
    const imported: VoiceProfile = id === profile.id ? profile : { ...profile, id };
    await this.write({ ...collection, profiles: [...collection.profiles, imported] });
    return imported;
  }

  /** `Export Profile`: the profile alone, pretty-printed; never the global voice (ADR-017 §1.2). */
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

  private async write(collection: ProfileCollection): Promise<void> {
    await writeFileAtomic(this.filePath, serializeCollection(collection));
  }
}
