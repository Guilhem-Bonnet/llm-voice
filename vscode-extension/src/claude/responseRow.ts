/**
 * What one line of the list "Réponses" says, for every tool. No `vscode` import and
 * no HTML: the webviews write these strings with `textContent`, and they hold the
 * start of an untrusted reply, never the reply itself.
 */

import type { InboxEntry } from "../core/inbox.js";
import { normalize } from "../parser/SpokenTextNormalizer.js";
import { formatRelativeTime } from "./inboxFormat.js";

/**
 * Hypothesis behind every displayed duration: Kyutai TTS 1.6B says about 17
 * characters per second in French (measured, see `src/direction/cast/synthesisPlan.ts`).
 * Another voice or another speed changes the real duration, which is why it is shown
 * rounded.
 */
export const ASSUMED_CHARS_PER_SECOND = 17;

/** A title is a line to recognise a reply by, and the only text of it a webview receives. */
const TITLE_MAX_CHARS = 160;
const FREE_SOURCE_MAX_CHARS = 40;

const SOURCE_LABELS: Readonly<Record<string, string>> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  "gemini-cli": "Gemini CLI",
  gemini: "Gemini",
  copilot: "Copilot",
  external: "Autre outil"
};

const TERMINAL_ESCAPE = /\p{Cc}\[[0-9;?]*[A-Za-z]/gu;
const CONTROL_CHARACTER = /\p{Cc}/gu;
const LINE_MARKER = /^\s*(?:#{1,6}\s+|>\s*)+/;

/** The text a reading adapts today. A later card narrows it, and the duration follows. */
export function spokenTextOf(message: string): string {
  return normalize(message);
}

export function estimateSpeechSeconds(spokenText: string): number {
  return spokenText.length / ASSUMED_CHARS_PER_SECOND;
}

/** Seconds under a minute, then to the nearest ten seconds, then to the minute past an hour. */
export function formatSpeechDuration(seconds: number): string {
  const wholeSeconds = Math.round(seconds);
  if (wholeSeconds < 60) {
    return `${Math.max(1, wholeSeconds)} s`;
  }
  const tens = Math.round(seconds / 10) * 10;
  if (tens < 3600) {
    const rest = tens % 60;
    const minutes = (tens - rest) / 60;
    return rest === 0 ? `${minutes} min` : `${minutes} min ${rest}`;
  }
  const totalMinutes = Math.round(seconds / 60);
  const rest = totalMinutes % 60;
  const hours = (totalMinutes - rest) / 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, "0")}`;
}

function withoutControls(text: string): string {
  return text.replace(TERMINAL_ESCAPE, "").replace(CONTROL_CHARACTER, "");
}

function capped(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Any tool can declare any name (D8): a known id reads well, another is kept as declared. */
export function responseSourceLabel(provider: string): string {
  return SOURCE_LABELS[provider] ?? capped(withoutControls(provider).trim(), FREE_SOURCE_MAX_CHARS);
}

/** The last folder of `cwd`, whichever system wrote it. */
export function responseProject(cwd: string | undefined): string | undefined {
  const last = cwd
    ?.split(/[/\\]/)
    .filter((part) => part.length > 0)
    .pop();
  return last !== undefined ? capped(withoutControls(last), FREE_SOURCE_MAX_CHARS) : undefined;
}

/** The declared title, else the first line that says something. */
export function responseTitle(entry: InboxEntry): string {
  const lines = [entry.message.title ?? "", ...entry.message.message.split(/\r?\n/)];
  for (const line of lines) {
    const said = normalize(withoutControls(line).replace(LINE_MARKER, ""));
    if (said.length > 0) {
      return capped(said, TITLE_MAX_CHARS);
    }
  }
  return "Réponse sans titre";
}

export interface ResponseRowView {
  id: string;
  title: string;
  source: string;
  project?: string;
  age: string;
  duration: string;
  read: boolean;
  /** The second line: the duration first, so that a cut takes the rest and never it. */
  line: string;
}

export function responseRowOf(entry: InboxEntry, now: number): ResponseRowView {
  const source = responseSourceLabel(entry.message.provider);
  const project = responseProject(entry.message.cwd);
  const age = formatRelativeTime(entry.message.capturedAt, now);
  const duration = formatSpeechDuration(estimateSpeechSeconds(spokenTextOf(entry.message.message)));
  return {
    id: entry.id,
    title: responseTitle(entry),
    source,
    ...(project !== undefined ? { project } : {}),
    age,
    duration,
    read: entry.read,
    line: [duration, source, project, age].filter((part) => part !== undefined).join(" · ")
  };
}

/** The panel's block: the latest reply, and two more lines at most. */
export const PANEL_OTHER_LINES = 2;

export interface PanelResponsesView {
  total: number;
  unread: number;
  latest: ResponseRowView | null;
  others: ResponseRowView[];
}

export function panelResponsesOf(entries: readonly InboxEntry[], now: number): PanelResponsesView {
  const [latest, ...rest] = entries;
  return {
    total: entries.length,
    unread: entries.filter((entry) => !entry.read).length,
    latest: latest !== undefined ? responseRowOf(latest, now) : null,
    others: rest.slice(0, PANEL_OTHER_LINES).map((entry) => responseRowOf(entry, now))
  };
}

export interface ResponsesListView {
  total: number;
  rows: ResponseRowView[];
  hasMore: boolean;
}

export function responsesListOf(entries: readonly InboxEntry[], limit: number, now: number): ResponsesListView {
  return {
    total: entries.length,
    rows: entries.slice(0, limit).map((entry) => responseRowOf(entry, now)),
    hasMore: entries.length > limit
  };
}

/** A Quick Pick draws `$(name)` as an icon, and a reply must not be able to draw one. */
function withoutIcons(text: string): string {
  return text.replaceAll("$(", "$​(");
}

export function responsePickTexts(entry: InboxEntry, now: number): { label: string; detail: string } {
  const row = responseRowOf(entry, now);
  return {
    label: `${row.read ? "" : "$(circle-filled) "}${withoutIcons(row.title)}`,
    detail: withoutIcons(row.line)
  };
}

const ENTRY_ACTIONS = ["speak", "openText", "toggleRead", "remove"] as const;
const PLAIN_ACTIONS = ["showAll", "showMore", "readClipboard", "connectTool"] as const;

export type ResponseAction =
  | { action: (typeof ENTRY_ACTIONS)[number]; id: string }
  | { action: (typeof PLAIN_ACTIONS)[number] };

/** Webviews are not trusted with the shape of what they send: anything else is nothing. */
export function parseResponseAction(raw: unknown): ResponseAction | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const { type, action, id } = raw as { type?: unknown; action?: unknown; id?: unknown };
  if (type !== "responseAction") {
    return undefined;
  }
  const entryAction = ENTRY_ACTIONS.find((known) => known === action);
  if (entryAction !== undefined) {
    return typeof id === "string" ? { action: entryAction, id } : undefined;
  }
  const plainAction = PLAIN_ACTIONS.find((known) => known === action);
  return plainAction !== undefined ? { action: plainAction } : undefined;
}
