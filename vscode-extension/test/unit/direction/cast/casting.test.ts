/** ADR-018 §3 et §7 étape 3 : distribution stable par document, sans inférence. */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BibleStore } from "../../../../src/direction/bible/BibleStore.js";
import { documentScope } from "../../../../src/direction/bible/scopes.js";
import { castVoices, resolveVoiceRef, voiceOrder } from "../../../../src/direction/cast/casting.js";
import { castFromBible, recordUserVoice } from "../../../../src/direction/cast/castStore.js";
import { assignCast } from "../../../../src/direction/cast/castSegments.js";
import { KYUTAI16_VOICE_CATALOG } from "../../../../src/tts/kyutai16VoiceCatalog.js";

const HERE = __dirname;
const VOICES = KYUTAI16_VOICE_CATALOG;
const NARRATOR = "cml-577_394";
const KEY = "a".repeat(64);

const roles = (...ids: string[]) => ids.map((roleId) => ({ roleId, name: roleId, lines: 1 }));

function input(overrides: Partial<Parameters<typeof castVoices>[0]> = {}): Parameters<typeof castVoices>[0] {
  return { documentKey: KEY, voices: VOICES, narratorVoice: NARRATOR, roles: roles("romeo", "juliette"), existing: {}, declarations: [], ...overrides };
}

describe("castVoices", () => {
  it("est stable : mêmes entrées, même résultat, et l'ordre dépend du document", () => {
    expect(castVoices(input())).toEqual(castVoices(input()));
    expect(voiceOrder(KEY, VOICES).map((voice) => voice.id)).not.toEqual(voiceOrder("b".repeat(64), VOICES).map((voice) => voice.id));
  });

  it("n'attribue jamais la voix du narrateur", () => {
    const many = roles(...Array.from({ length: 80 }, (_, index) => `r${index}`));
    const { entries } = castVoices(input({ roles: many }));
    expect(entries.every((entry) => entry.voice !== NARRATOR)).toBe(true);
  });

  it("donne une voix unique jusqu'à 35 personnages, puis partage la moins partagée et le signale", () => {
    const thirtyFive = castVoices(input({ roles: roles(...Array.from({ length: 35 }, (_, index) => `r${index}`)) })).entries;
    expect(new Set(thirtyFive.map((entry) => entry.voice)).size).toBe(35);
    expect(thirtyFive.some((entry) => entry.shared)).toBe(false);
    const thirtySix = castVoices(input({ roles: roles(...Array.from({ length: 36 }, (_, index) => `r${index}`)) })).entries;
    expect(thirtySix.filter((entry) => entry.shared)).toHaveLength(2);
    const seventy = castVoices(input({ roles: roles(...Array.from({ length: 70 }, (_, index) => `r${index}`)) })).entries;
    const counts = new Map<string, number>();
    seventy.forEach((entry) => counts.set(entry.voice ?? "", (counts.get(entry.voice ?? "") ?? 0) + 1));
    expect(Math.max(...counts.values())).toBe(2);
  });

  it("un personnage ajouté plus haut ne décale pas les autres", () => {
    const first = castVoices(input());
    const existing = Object.fromEntries(first.entries.map((entry) => [entry.roleId, { voiceRef: entry.voice ?? "", by: "casting" as const }]));
    const second = castVoices(input({ roles: roles("nouveau", "romeo", "juliette"), existing }));
    expect(second.entries.find((entry) => entry.roleId === "romeo")?.voice).toBe(first.entries[0]?.voice);
    expect(second.entries.find((entry) => entry.roleId === "juliette")?.voice).toBe(first.entries[1]?.voice);
    expect(second.newAssignments.map((item) => item.roleId)).toEqual(["nouveau"]);
  });

  it("un choix verrouillé n'est jamais remplacé, même par `%` ou s'il devient la voix du narrateur, et il est signalé", () => {
    const existing = { romeo: { voiceRef: NARRATOR, by: "user" as const, locked: true } };
    const { entries } = castVoices(input({ existing, declarations: [{ roleId: "romeo", voiceText: "estelle" }] }));
    expect(entries[0]).toMatchObject({ voice: NARRATOR, locked: true, narratorClash: true, origin: "user" });
    expect(entries[1]?.voice).not.toBe(NARRATOR);
  });

  it("une attribution automatique devenue la voix du narrateur est refaite", () => {
    const { entries } = castVoices(input({ existing: { romeo: { voiceRef: NARRATOR, by: "casting" } } }));
    expect(entries[0]?.voice).not.toBe(NARRATOR);
    expect(entries[0]?.origin).toBe("casting");
  });

  it("`%` par identifiant ou prénom, sans casse ni accent, reste `casting` ; une voix inconnue ou celle du narrateur est ignorée", () => {
    expect(resolveVoiceRef("EDEN", VOICES)).toBe("cml-1770_1028");
    expect(resolveVoiceRef("estelle", VOICES)).toBe("estelle");
    expect(resolveVoiceRef("vera", VOICES)).toBeUndefined();
    const { entries } = castVoices(
      input({
        declarations: [
          { roleId: "romeo", voiceText: "estelle" },
          { roleId: "juliette", voiceText: "camille" }
        ]
      })
    );
    expect(entries[0]).toMatchObject({ voice: "estelle", origin: "casting", locked: false });
    expect(entries[1]?.voice).not.toBe(NARRATOR);
  });

  it("`%` passe devant une attribution automatique, jamais devant `user`", () => {
    const existing = { romeo: { voiceRef: "cml-928_486", by: "casting" as const } };
    const { entries, newAssignments } = castVoices(input({ existing, declarations: [{ roleId: "romeo", voiceText: "estelle" }] }));
    expect(entries[0]?.voice).toBe("estelle");
    expect(newAssignments.map((item) => item.roleId)).toEqual(["juliette"]);
  });

  it("une voix verrouillée absente du serveur rend ce personnage au narrateur, signalé", () => {
    const existing = { romeo: { voiceRef: "disparue", by: "user" as const, locked: true } };
    const { entries } = castVoices(input({ existing }));
    expect(entries[0]).toMatchObject({ unavailable: true, locked: true });
    expect(entries[0]?.voice).toBeUndefined();
  });

  it("test statique : aucune branche sur le genre, aucune liste de prénoms", () => {
    const code = readFileSync(resolve(HERE, "../../../../src/direction/cast/casting.ts"), "utf8");
    expect(code).not.toMatch(/gender|genre|femme|homme|masculin|féminin/i);
  });
});

describe("castFromBible", () => {
  const parse = { roles: roles("romeo", "juliette"), declarations: [] };
  const context = { providerId: "kyutai-1-6b", voices: VOICES, narratorVoice: NARRATOR };

  it("stable sur deux sessions, bible rechargée depuis le disque", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cast-"));
    const scope = documentScope("file:///piece.md", { persist: true });
    const first = await castFromBible(new BibleStore({ directory }), scope, parse, context);
    const again = await castFromBible(new BibleStore({ directory }), scope, { ...parse, roles: roles("nouveau", "romeo", "juliette") }, context);
    expect(again.entries.find((entry) => entry.roleId === "romeo")?.voice).toBe(first.entries[0]?.voice);
    expect(first.newAssignments).toHaveLength(2);
    expect(again.newAssignments.map((item) => item.roleId)).toEqual(["nouveau"]);
  });

  it("un choix de l'utilisateur est retrouvé verrouillé à la session suivante, et `%` est écrit en `casting`", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cast-"));
    const scope = documentScope("file:///piece.md", { persist: true });
    const store = new BibleStore({ directory });
    await castFromBible(store, scope, { roles: roles("romeo"), declarations: [{ roleId: "romeo", voiceText: "estelle" }] }, context);
    const view = await new BibleStore({ directory }).read(scope);
    expect(view.bible.characters[0]?.voice.assignments?.["kyutai-1-6b"]).toEqual({ voiceRef: "estelle", by: "casting" });

    await recordUserVoice(store, scope, "romeo", "kyutai-1-6b", "cml-928_486");
    const next = await castFromBible(new BibleStore({ directory }), scope, { roles: roles("romeo"), declarations: [{ roleId: "romeo", voiceText: "estelle" }] }, context);
    expect(next.entries[0]).toMatchObject({ voice: "cml-928_486", locked: true, origin: "user" });
  });

  it("portée en mémoire : rien n'est écrit sur le disque, et la distribution tient dans la session", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cast-"));
    const scope = documentScope("presse-papiers", { persist: false });
    const store = new BibleStore({ directory });
    const first = await castFromBible(store, scope, parse, context);
    const second = await castFromBible(store, scope, parse, context);
    expect(second.entries.map((entry) => entry.voice)).toEqual(first.entries.map((entry) => entry.voice));
    expect(second.newAssignments).toEqual([]);
    const elsewhere = await new BibleStore({ directory }).read(scope);
    expect(elsewhere.bible.characters).toEqual([]);
  });

  it("lecture seule : relit la bible sans rien y écrire", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cast-"));
    const scope = documentScope("file:///piece.md", { persist: true });
    await castFromBible(new BibleStore({ directory }), scope, parse, { ...context, readOnly: true });
    expect((await new BibleStore({ directory }).read(scope)).bible.characters).toEqual([]);
  });
});

describe("assignCast", () => {
  const segments = [
    { id: "faithful-seg-0", spokenText: "Il était.", sourceSegmentIds: ["seg-0"], sourceRanges: [] },
    { id: "faithful-seg-1", spokenText: "Bonjour.", sourceSegmentIds: ["seg-1"], sourceRanges: [], metadata: { speakerId: "romeo" } },
    { id: "faithful-seg-2", spokenText: "Salut.", sourceSegmentIds: ["seg-2"], sourceRanges: [], metadata: { speakerId: "juliette" } },
    { id: "faithful-seg-3", spokenText: "Eh.", sourceSegmentIds: ["seg-3"], sourceRanges: [], metadata: { speakerId: "inconnu" } }
  ];
  const binding = { language: "fr", voice: NARRATOR };
  const voices: Record<string, string> = { romeo: "estelle", juliette: NARRATOR };

  it("passe par le traducteur : la voix du personnage va dans `metadata.cast`, le narrateur reste sans voix, le texte ne change pas", () => {
    const out = assignCast(segments, { binding, voiceOf: (id) => voices[id] });
    expect(out.map((seg) => seg.metadata?.["cast"])).toEqual([
      { speakerId: "narrator" },
      { speakerId: "romeo", voice: "estelle" },
      { speakerId: "juliette" },
      { speakerId: "inconnu" }
    ]);
    expect(out.map((seg) => seg.spokenText)).toEqual(segments.map((seg) => seg.spokenText));
    expect(out.map((seg) => seg.id)).toEqual(segments.map((seg) => seg.id));
  });
});
