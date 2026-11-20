/** A real temporary folder and a `ProfileStore` on it, with settings and messages in the test's hands. */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProfileCollection } from "../../../../src/core/profile.js";
import type { BySourceSetting } from "../../../../src/profiles/bySource.js";
import type { VoiceNotice } from "../../../../src/profiles/migrations.js";
import { ProfileStore, type StateStore } from "../../../../src/profiles/profileStore.js";

export const LAST_SELECTED_KEY = "llmVoice.profiles.lastSelectedId";
export const SETTINGS = { provider: "auto", baseUrl: "http://127.0.0.1:8004" };

export interface Harness {
  dir: string;
  state: StateStore & { values: Map<string, unknown> };
  notices: VoiceNotice[];
  store(options?: { modesBySource?: BySourceSetting; legacyDefaultProfile?: string }): ProfileStore;
  writeProfiles(content: string | ProfileCollection): Promise<void>;
  readProfiles(): Promise<ProfileCollection & { voiceMigration?: number }>;
  readRaw(name: string): Promise<string>;
  dispose(): Promise<void>;
}

export async function createHarness(lastSelectedId?: string): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), "llm-voice-store-"));
  const values = new Map<string, unknown>(lastSelectedId !== undefined ? [[LAST_SELECTED_KEY, lastSelectedId]] : []);
  const state: Harness["state"] = {
    values,
    get: <T>(key: string) => values.get(key) as T | undefined,
    update: async (key, value) => {
      values.set(key, value);
    }
  };
  const notices: VoiceNotice[] = [];
  return {
    dir,
    state,
    notices,
    store: (options = {}) =>
      new ProfileStore(dir, state, {
        ttsSettings: () => SETTINGS,
        modesBySource: () => options.modesBySource ?? { "claude-code": "llm-summary" },
        legacyDefaultProfile: () => options.legacyDefaultProfile,
        onVoiceNotice: (notice) => notices.push(notice)
      }),
    writeProfiles: (content) =>
      writeFile(join(dir, "profiles.json"), typeof content === "string" ? content : JSON.stringify(content, null, 2)),
    readProfiles: async () => JSON.parse(await readFile(join(dir, "profiles.json"), "utf8")),
    readRaw: (name) => readFile(join(dir, name), "utf8"),
    dispose: () => rm(dir, { recursive: true, force: true })
  };
}
