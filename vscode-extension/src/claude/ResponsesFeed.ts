/**
 * What the panel's block and the view "Réponses" share: the entries on disk and what
 * their buttons ask for. Refreshing shows a reply and starts nothing: only `handle`
 * reaches an action, and only a click in a webview reaches `handle` (ADR-003).
 */

import type { InboxEntry } from "../core/inbox.js";
import { parseResponseAction, panelResponsesOf, responsesListOf, type PanelResponsesView, type ResponsesListView } from "./responseRow.js";

/** Rows sent to the view at a time: enough to scroll, and a long history stays light. */
export const RESPONSES_PAGE = 100;

export interface ResponseActions {
  speak(entry: InboxEntry): Promise<void>;
  openText(entry: InboxEntry): Promise<void>;
  toggleRead(entry: InboxEntry): Promise<void>;
  remove(entry: InboxEntry): Promise<void>;
  showAll(): Promise<void>;
  readClipboard(): Promise<void>;
  connectTool(): Promise<void>;
}

export interface ResponsesFeedOptions {
  list(): Promise<readonly InboxEntry[]>;
  actions: ResponseActions;
  onChange(): void;
  now?: () => number;
}

export class ResponsesFeed {
  private entries: readonly InboxEntry[] = [];
  private limit = RESPONSES_PAGE;
  private latestRefresh = 0;

  constructor(private readonly options: ResponsesFeedOptions) {}

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  async refresh(): Promise<void> {
    this.latestRefresh += 1;
    const refresh = this.latestRefresh;
    const entries = await this.options.list();
    // Several changes on disk overlap: the scan asked last is the one that tells the truth.
    if (refresh === this.latestRefresh) {
      this.entries = entries;
      this.options.onChange();
    }
  }

  get unreadCount(): number {
    return this.entries.filter((entry) => !entry.read).length;
  }

  panelView(): PanelResponsesView {
    return panelResponsesOf(this.entries, this.now());
  }

  listView(): ResponsesListView {
    return responsesListOf(this.entries, this.limit, this.now());
  }

  async handle(raw: unknown): Promise<void> {
    const request = parseResponseAction(raw);
    if (request === undefined) {
      return;
    }
    const { actions } = this.options;
    switch (request.action) {
      case "showAll":
        return actions.showAll();
      case "readClipboard":
        return actions.readClipboard();
      case "connectTool":
        return actions.connectTool();
      case "showMore":
        this.limit += RESPONSES_PAGE;
        this.options.onChange();
        return;
      default:
        break;
    }
    // An id reaches a file path further on: only one this list holds goes through.
    const entry = this.entries.find((candidate) => candidate.id === request.id);
    if (entry === undefined) {
      return;
    }
    switch (request.action) {
      case "speak":
        return actions.speak(entry);
      case "openText":
        return actions.openText(entry);
      case "toggleRead":
        return actions.toggleRead(entry);
      case "remove":
        return actions.remove(entry);
    }
  }
}
