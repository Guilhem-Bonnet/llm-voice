/**
 * `ReadStateStore` over `context.globalState` (ADR-004: read/unread is
 * "perte tolérable", shared across windows). Keyed under
 * `llmVoice.inbox.read.<id>` so `cleanup()` can enumerate our own keys
 * without touching anything else `globalState` holds (e.g. the profile
 * selection key from `ProfileRepository`).
 */

import * as vscode from "vscode";
import type { ReadStateStore } from "./ReadStateStore.js";

const KEY_PREFIX = "llmVoice.inbox.read.";

export class GlobalStateReadStore implements ReadStateStore {
  constructor(private readonly globalState: vscode.Memento) {}

  isRead(id: string): boolean {
    return this.globalState.get<boolean>(KEY_PREFIX + id, false);
  }

  async setRead(id: string, read: boolean): Promise<void> {
    await this.globalState.update(KEY_PREFIX + id, read ? true : undefined);
  }

  async cleanup(existingIds: readonly string[]): Promise<void> {
    const keep = new Set(existingIds.map((id) => KEY_PREFIX + id));
    const orphaned = this.globalState.keys().filter((key) => key.startsWith(KEY_PREFIX) && !keep.has(key));
    for (const key of orphaned) {
      await this.globalState.update(key, undefined);
    }
  }
}
