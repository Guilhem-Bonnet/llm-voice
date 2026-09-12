/**
 * Bug fix (voice-selection-not-applied): end-to-end proof that
 * `ProfileRepository.load()` migrates a real, pre-"auto" `profiles.json` —
 * `test/fixtures/profiles/legacy-profiles-v1.json` is the user's own
 * reported `profiles.json` (`schemaVersion: 1`, every profile explicitly
 * pinned to `chatterbox` at the shipped local `baseUrl`), copied verbatim as
 * a fixture: nothing in it identifies the reporter (no username, no host
 * path beyond `localhost`), so no further anonymisation was needed beyond
 * using it as-is.
 *
 * `ProfileRepository` imports `vscode` at module scope (`vscode.Uri.file`,
 * `vscode.workspace.openTextDocument`) — this only runs in the real
 * extension host (`test/integration/**`, the "fake-tts" `.vscode-test.mjs`
 * profile picks up this file's compiled output automatically, same as every
 * other file under `test/integration/`), unlike `src/profiles/migrations.ts`
 * itself, which is plain-Node-testable (`test/unit/profiles/migrations.test.ts`).
 */
import * as assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";
import { ProfileRepository } from "../../src/profiles/ProfileRepository.js";
import { CURRENT_PROFILE_SCHEMA_VERSION } from "../../src/profiles/migrations.js";

/** Minimal `vscode.Memento` — only `get`/`update` are ever called by `ProfileRepository`. */
function fakeMemento(): vscode.Memento {
  const store = new Map<string, unknown>();
  return {
    get: <T>(key: string, defaultValue?: T) => (store.has(key) ? (store.get(key) as T) : defaultValue),
    update: async (key: string, value: unknown) => {
      store.set(key, value);
    },
    keys: () => [...store.keys()]
  } as vscode.Memento;
}

// This compiled test lives at `out/test/integration/profileMigration.test.js`
// (`npm run build`'s `tsc` mirrors `test/` under `out/test/`) — three levels
// up from there is the extension root, same as every other fixture path in
// this suite.
const FIXTURE_PATH = join(__dirname, "..", "..", "..", "test", "fixtures", "profiles", "legacy-profiles-v1.json");

async function legacyFixtureText(): Promise<string> {
  return readFile(FIXTURE_PATH, "utf8");
}

suite("ProfileRepository migration (bug fix: voice-selection-not-applied, defect 2)", () => {
  let storageDir: string;

  setup(async () => {
    storageDir = await mkdtemp(join(tmpdir(), "llm-voice-profile-migration-"));
  });

  teardown(async () => {
    await rm(storageDir, { recursive: true, force: true });
  });

  test("reproduces the reported bug: the raw legacy fixture pins every profile to chatterbox at schemaVersion 1", async () => {
    const raw = JSON.parse(await legacyFixtureText()) as { schemaVersion: number; profiles: { tts: { providerId: string } }[] };
    assert.equal(raw.schemaVersion, 1);
    assert.ok(raw.profiles.every((profile) => profile.tts.providerId === "chatterbox"));
  });

  test("load() migrates a legacy profiles.json in place: every profile now resolves through 'auto', schemaVersion bumped, persisted to disk", async () => {
    await mkdir(storageDir, { recursive: true });
    const profilesPath = join(storageDir, "profiles.json");
    await writeFile(profilesPath, await legacyFixtureText(), "utf8");

    const repository = new ProfileRepository(storageDir, fakeMemento());
    const collection = await repository.load();

    assert.equal(collection.schemaVersion, CURRENT_PROFILE_SCHEMA_VERSION);
    for (const profile of collection.profiles) {
      assert.equal(profile.tts.providerId, "auto", `${profile.id} should resolve through auto after migration`);
      assert.equal(profile.tts.baseUrl, undefined, `${profile.id} should no longer pin a baseUrl`);
    }
    // The specific profile from the bug report: selected by default, was
    // pinned to a stopped Chatterbox, now free to fall back to
    // Piper/système via `resolveTtsProviderConfig` → `autoSelectTts`.
    const faithful = collection.profiles.find((profile) => profile.id === "faithful-local");
    assert.ok(faithful);
    assert.equal(faithful?.tts.providerId, "auto");

    // Persisted: re-reading the raw file directly (not through the
    // repository) proves this is not an in-memory-only migration.
    const onDisk = JSON.parse(await readFile(profilesPath, "utf8")) as { schemaVersion: number };
    assert.equal(onDisk.schemaVersion, CURRENT_PROFILE_SCHEMA_VERSION);
  });

  test("load() is idempotent: a second load of the now-migrated file changes nothing further", async () => {
    await mkdir(storageDir, { recursive: true });
    const profilesPath = join(storageDir, "profiles.json");
    await writeFile(profilesPath, await legacyFixtureText(), "utf8");

    const repository = new ProfileRepository(storageDir, fakeMemento());
    const first = await repository.load();
    const rawAfterFirst = await readFile(profilesPath, "utf8");
    const second = await repository.load();
    const rawAfterSecond = await readFile(profilesPath, "utf8");

    assert.deepEqual(second, first);
    assert.equal(rawAfterSecond, rawAfterFirst);
  });
});
