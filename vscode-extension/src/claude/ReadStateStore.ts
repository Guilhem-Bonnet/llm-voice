/**
 * Read/unread state for inbox entries (ADR-004: "perte tolérable"). The
 * repository injects an implementation; `InMemoryReadStateStore` is the
 * vscode-free default (tests, CLI-adjacent code). The extension wires
 * `GlobalStateReadStore` on top of `context.globalState`.
 */

export interface ReadStateStore {
  isRead(id: string): boolean;
  setRead(id: string, read: boolean): Promise<void>;
  /** Drops keys whose backing inbox file no longer exists (ADR-004). */
  cleanup(existingIds: readonly string[]): Promise<void>;
}

export class InMemoryReadStateStore implements ReadStateStore {
  private readonly readIds = new Set<string>();

  isRead(id: string): boolean {
    return this.readIds.has(id);
  }

  async setRead(id: string, read: boolean): Promise<void> {
    if (read) {
      this.readIds.add(id);
    } else {
      this.readIds.delete(id);
    }
  }

  async cleanup(existingIds: readonly string[]): Promise<void> {
    const keep = new Set(existingIds);
    for (const id of [...this.readIds]) {
      if (!keep.has(id)) {
        this.readIds.delete(id);
      }
    }
  }
}
