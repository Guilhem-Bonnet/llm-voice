/**
 * Watches the inbox directory (ADR-004): `fs.watch` for low-latency
 * notifications, plus a 5s polling fallback — `fs.watch` is unreliable on
 * some mounts (network, containers, Flatpak) and cannot survive the watched
 * directory being deleted and recreated. Emits a single debounced (200ms)
 * `changed` event; callers re-`scan()` the directory themselves (this class
 * never reads file contents).
 *
 * Deliberately free of any `vscode` import (unit-testable in plain Node,
 * like `InboxRepository`). No autoplay implication either way: this class
 * only ever calls its own listeners, never anything playback-related.
 */

import * as fs from "node:fs";

const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_DEBOUNCE_MS = 200;

export type InboxWatcherListener = () => void;

export interface InboxWatcherOptions {
  directory: string;
  pollIntervalMs?: number;
  debounceMs?: number;
}

export class InboxWatcher {
  private readonly directory: string;
  private readonly pollIntervalMs: number;
  private readonly debounceMs: number;
  private readonly listeners = new Set<InboxWatcherListener>();

  private fsWatcher: fs.FSWatcher | undefined;
  private pollTimer: NodeJS.Timeout | undefined;
  private debounceTimer: NodeJS.Timeout | undefined;
  private lastSnapshot = "";
  private disposed = false;

  constructor(options: InboxWatcherOptions) {
    this.directory = options.directory;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  onChange(listener: InboxWatcherListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.disposed) {
      return;
    }
    this.attachFsWatch();
    this.pollTimer = setInterval(() => void this.pollOnce(), this.pollIntervalMs);
    this.pollTimer.unref?.();
    void this.pollOnce();
  }

  dispose(): void {
    this.disposed = true;
    this.fsWatcher?.close();
    this.fsWatcher = undefined;
    if (this.pollTimer !== undefined) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    this.listeners.clear();
  }

  /** Test hook: forces an immediate poll without waiting `pollIntervalMs`. */
  async forcePoll(): Promise<void> {
    await this.pollOnce();
  }

  private attachFsWatch(): void {
    if (this.disposed || this.fsWatcher !== undefined) {
      return;
    }
    try {
      const watcher = fs.watch(this.directory, { persistent: false }, () => this.scheduleChange());
      watcher.on("error", () => this.detachFsWatch());
      this.fsWatcher = watcher;
    } catch {
      // Directory does not exist yet (or was just removed): polling will
      // notice the change and this method is retried on the next tick.
      this.fsWatcher = undefined;
    }
  }

  private detachFsWatch(): void {
    this.fsWatcher?.close();
    this.fsWatcher = undefined;
  }

  private scheduleChange(): void {
    if (this.disposed) {
      return;
    }
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => this.emitChange(), this.debounceMs);
    this.debounceTimer.unref?.();
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private async pollOnce(): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (this.fsWatcher === undefined) {
      this.attachFsWatch();
    }
    const snapshot = await this.snapshot();
    if (snapshot !== this.lastSnapshot) {
      this.lastSnapshot = snapshot;
      this.scheduleChange();
    }
  }

  private async snapshot(): Promise<string> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(this.directory, { withFileTypes: true });
    } catch {
      return "";
    }
    const candidates = entries.filter(
      (entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith(".tmp-")
    );
    const parts = await Promise.all(
      candidates.map(async (entry) => {
        try {
          const stat = await fs.promises.stat(`${this.directory}/${entry.name}`);
          return `${entry.name}:${stat.mtimeMs}:${stat.size}`;
        } catch {
          return `${entry.name}:?`;
        }
      })
    );
    return parts.sort().join("|");
  }
}
