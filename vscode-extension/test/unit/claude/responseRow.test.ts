/**
 * The list "Réponses": what one line says. Pure, and tested on made-up replies only.
 */
import { describe, expect, it } from "vitest";
import type { InboxEntry } from "../../../src/core/inbox.js";
import {
  ASSUMED_CHARS_PER_SECOND,
  estimateSpeechSeconds,
  formatSpeechDuration,
  panelResponsesOf,
  parseResponseAction,
  responsePickTexts,
  responseProject,
  responseRowOf,
  responsesListOf,
  responseSourceLabel,
  responseTitle,
  spokenTextOf
} from "../../../src/claude/responseRow.js";

const NOW = Date.parse("2026-11-06T12:00:00.000Z");

function entry(message: string, options: Partial<InboxEntry["message"]> & { id?: string; read?: boolean } = {}): InboxEntry {
  const { id = "a", read = false, ...fields } = options;
  return {
    id,
    fileName: `${id}.json`,
    read,
    archived: false,
    bytes: message.length,
    modifiedAt: NOW,
    message: { schemaVersion: 1, provider: "claude-code", sessionId: "s", capturedAt: NOW - 12 * 60_000, message, ...fields }
  };
}

describe("the duration of a reply", () => {
  it("rests on a named assumption, measured on Kyutai", () => {
    expect(ASSUMED_CHARS_PER_SECOND).toBe(17);
    expect(estimateSpeechSeconds("x".repeat(17 * 27))).toBe(27);
  });

  it("counts the adapted text, not the markup around it", () => {
    expect(spokenTextOf("**Les deux pannes** sont [corrigées](https://example.test/a).")).toBe("Les deux pannes sont corrigées.");
    expect(estimateSpeechSeconds(spokenTextOf("**abc**"))).toBe(estimateSpeechSeconds("abc"));
  });

  it("gives seconds under a minute", () => {
    expect(formatSpeechDuration(27)).toBe("27 s");
    expect(formatSpeechDuration(59.4)).toBe("59 s");
  });

  it("never says zero: a word takes a moment", () => {
    expect(formatSpeechDuration(0)).toBe("1 s");
    expect(formatSpeechDuration(0.2)).toBe("1 s");
  });

  it("past a minute, rounds to ten seconds: no false precision", () => {
    expect(formatSpeechDuration(157)).toBe("2 min 40");
    expect(formatSpeechDuration(160)).toBe("2 min 40");
    expect(formatSpeechDuration(450)).toBe("7 min 30");
    expect(formatSpeechDuration(143)).toBe("2 min 20");
  });

  it("a whole minute is said without seconds", () => {
    expect(formatSpeechDuration(59.6)).toBe("1 min");
    expect(formatSpeechDuration(60)).toBe("1 min");
    expect(formatSpeechDuration(121)).toBe("2 min");
  });

  it("past an hour, says hours and minutes", () => {
    expect(formatSpeechDuration(3600)).toBe("1 h");
    expect(formatSpeechDuration(3900)).toBe("1 h 05");
  });
});

describe("a line of the list", () => {
  it("puts the duration first, so that a cut takes the project and never the duration", () => {
    const row = responseRowOf(entry("x".repeat(17 * 27), { cwd: "/home/x/TTS-Voice" }), NOW);
    expect(row.line).toBe("27 s · Claude Code · TTS-Voice · il y a 12 min");
  });

  it("leaves out a project it does not know", () => {
    expect(responseRowOf(entry("x".repeat(17 * 40), { provider: "codex" }), NOW).line).toBe("40 s · Codex · il y a 12 min");
  });

  it("names every known tool, and keeps a free-form one as declared", () => {
    expect(responseSourceLabel("claude-code")).toBe("Claude Code");
    expect(responseSourceLabel("codex")).toBe("Codex");
    expect(responseSourceLabel("gemini-cli")).toBe("Gemini CLI");
    expect(responseSourceLabel("copilot")).toBe("Copilot");
    expect(responseSourceLabel("external")).toBe("Autre outil");
    expect(responseSourceLabel("mon-outil")).toBe("mon-outil");
  });

  it("takes the project from a POSIX or a Windows path", () => {
    expect(responseProject("/home/x/TTS-Voice/")).toBe("TTS-Voice");
    expect(responseProject("C:\\Users\\x\\Infra")).toBe("Infra");
    expect(responseProject(undefined)).toBeUndefined();
  });

  it("titles a line with the declared title, else the first line said aloud", () => {
    expect(responseTitle(entry("ignoré", { title: "Les deux pannes sont corrigées" }))).toBe("Les deux pannes sont corrigées");
    expect(responseTitle(entry("\n\n## **Le déploiement** est terminé\nLa suite."))).toBe("Le déploiement est terminé");
    expect(responseTitle(entry("- Trois tests échouent encore"))).toBe("Trois tests échouent encore");
  });

  it("takes terminal escapes and control characters out of a title", () => {
    expect(responseTitle(entry("\u001b[31mRouge\u001b[0m\u0007 fini"))).toBe("Rouge fini");
  });

  it("does not hand a whole reply to the webview for a title", () => {
    const tail = "FIN-DU-TEXTE";
    const row = responseRowOf(entry(`${"mot ".repeat(5000)}${tail}`), NOW);
    expect(row.title.length).toBeLessThanOrEqual(161);
    expect(JSON.stringify(row)).not.toContain(tail);
  });

  it("gives the Quick Pick a title and, below it, the same line", () => {
    const texts = responsePickTexts(entry("x".repeat(17 * 27), { title: "Fait", cwd: "/a/TTS-Voice" }), NOW);
    expect(texts.label).toBe("$(circle-filled) Fait");
    expect(texts.detail).toBe("27 s · Claude Code · TTS-Voice · il y a 12 min");
    expect(responsePickTexts(entry("x", { title: "Fait", read: true }), NOW).label).toBe("Fait");
  });

  it("does not let a reply draw icons in the Quick Pick", () => {
    expect(responsePickTexts(entry("x", { title: "$(alert) urgent", read: true }), NOW).label).not.toContain("$(alert)");
    expect(responsePickTexts(entry("x", { provider: "$(alert)", read: true }), NOW).detail).not.toContain("$(alert)");
  });
});

describe("the panel's block", () => {
  const rows = [
    entry("a", { id: "1", title: "Un" }),
    entry("b", { id: "2", title: "Deux", read: true }),
    entry("c", { id: "3", title: "Trois" }),
    entry("d", { id: "4", title: "Quatre" })
  ];

  it("is empty when there is no reply", () => {
    expect(panelResponsesOf([], NOW)).toEqual({ total: 0, unread: 0, latest: null, others: [] });
  });

  it("shows the latest of any tool, then two lines at most, and counts them all", () => {
    const view = panelResponsesOf(rows, NOW);
    expect(view.latest?.id).toBe("1");
    expect(view.others.map((row) => row.id)).toEqual(["2", "3"]);
    expect(view.total).toBe(4);
    expect(view.unread).toBe(3);
  });
});

describe("the whole list", () => {
  it("is cut at the asked number and says that more exists", () => {
    const entries = [entry("a", { id: "1" }), entry("b", { id: "2" }), entry("c", { id: "3" })];
    const view = responsesListOf(entries, 2, NOW);
    expect(view.rows.map((row) => row.id)).toEqual(["1", "2"]);
    expect(view.total).toBe(3);
    expect(view.hasMore).toBe(true);
    expect(responsesListOf(entries, 3, NOW).hasMore).toBe(false);
  });
});

describe("what the webview may ask", () => {
  it("accepts the known actions", () => {
    expect(parseResponseAction({ type: "responseAction", action: "speak", id: "a" })).toEqual({ action: "speak", id: "a" });
    expect(parseResponseAction({ type: "responseAction", action: "showAll" })).toEqual({ action: "showAll" });
  });

  it("refuses everything else", () => {
    for (const raw of [
      null,
      "speak",
      { type: "responseAction" },
      { type: "userAction", action: "speak", id: "a" },
      { type: "responseAction", action: "rm -r", id: "a" },
      { type: "responseAction", action: "speak" },
      { type: "responseAction", action: "remove", id: 3 }
    ]) {
      expect(parseResponseAction(raw)).toBeUndefined();
    }
  });
});
