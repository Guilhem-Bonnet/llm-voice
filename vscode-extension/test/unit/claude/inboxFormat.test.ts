import { describe, expect, it } from "vitest";
import { computeInboxBadge, formatRelativeTime } from "../../../src/claude/inboxFormat.js";

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-09-08T12:00:00.000Z");

  it("under a minute", () => {
    expect(formatRelativeTime(now - 10_000, now)).toBe("à l'instant");
  });

  it("minutes", () => {
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("il y a 5 min");
  });

  it("hours", () => {
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("il y a 3 h");
  });

  it("days", () => {
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe("il y a 2 j");
  });
});

describe("computeInboxBadge", () => {
  it("returns undefined when everything is read (badge cleared)", () => {
    expect(computeInboxBadge(0)).toBeUndefined();
  });

  it("says one reply in the singular, several in the plural", () => {
    expect(computeInboxBadge(1)).toEqual({ value: 1, tooltip: "1 réponse non lue" });
    expect(computeInboxBadge(3)).toEqual({ value: 3, tooltip: "3 réponses non lues" });
  });

  it("returns a value + French tooltip for several unread messages", () => {
    expect(computeInboxBadge(7)).toEqual({ value: 7, tooltip: "7 réponses non lues" });
  });
});
