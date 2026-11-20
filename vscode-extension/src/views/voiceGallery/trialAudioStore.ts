/**
 * Local cache of the gallery's trial phrases: the same phrase on the same voice is
 * asked of the engine once. Names are a hash and a closed list of extensions, so
 * nothing the page sends can shape a path; the folder is one `localResourceRoots`
 * entry of the tab and holds nothing else.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { TtsBinding } from "../../core/profile.js";
import type { AudioFormat } from "../../core/tts.js";
import { canonicalJson } from "../../profiles/voiceResolution.js";

const MAX_KEPT_FILES = 30;

/** What the page's `<audio>` can read; `pcm` has no header to read. */
const PLAYABLE: Readonly<Partial<Record<AudioFormat, string>>> = { wav: "wav", mp3: "mp3", ogg: "ogg", flac: "flac" };

export function trialKey(binding: TtsBinding & { providerId: string }, language: string, text: string): string {
  return createHash("sha256")
    .update(canonicalJson([binding.providerId, binding.baseUrl ?? "", binding.voice ?? "", binding.model ?? "", binding.parameters ?? {}, language, text]))
    .digest("hex");
}

/** The file already made for this key, if any. Touched, so pruning keeps what is in use. */
export async function findTrial(dir: string, key: string): Promise<string | undefined> {
  for (const extension of Object.values(PLAYABLE)) {
    const candidate = path.join(dir, `${key}.${extension}`);
    try {
      const now = new Date();
      await fs.utimes(candidate, now, now);
      return candidate;
    } catch {
      // Not this one.
    }
  }
  return undefined;
}

export async function storeTrial(dir: string, key: string, format: AudioFormat, data: Uint8Array): Promise<string> {
  const extension = PLAYABLE[format];
  if (extension === undefined) {
    throw new Error(`format audio illisible ici : ${format}`);
  }
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, `${key}.${extension}`);
  const temporary = `${target}.tmp-${process.pid}`;
  await fs.writeFile(temporary, data);
  await fs.rename(temporary, target);
  await prune(dir);
  return target;
}

async function prune(dir: string): Promise<void> {
  const names = await fs.readdir(dir);
  const files = await Promise.all(
    names.map(async (name) => {
      const full = path.join(dir, name);
      return { full, mtime: (await fs.stat(full)).mtimeMs };
    })
  );
  const stale = files.sort((left, right) => right.mtime - left.mtime).slice(MAX_KEPT_FILES);
  await Promise.all(stale.map((file) => fs.rm(file.full, { force: true })));
}
