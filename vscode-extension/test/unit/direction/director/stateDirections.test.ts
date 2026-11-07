/** Le metteur en scène local : identifiant d'état, citation de l'indication vérifiée, repli voix figée. */
import { describe, expect, it } from "vitest";
import { directStates, directionLookup, stateCandidates, verifyStateDirections } from "../../../../src/direction/director/stateDirections.js";
import { assignCast } from "../../../../src/direction/cast/castSegments.js";

const ROLES = [{ roleId: "comte", name: "Le Comte" }, { roleId: "isaure", name: "Isaure" }];
const REGIONS = [
  { roleId: "isaure", text: "Alors il faut partir." },
  { text: "(Il tire son épée.)" },
  { roleId: "comte", text: "Non. Je reste, et je veux que cette tour le sache." },
  { roleId: "isaure", text: "Partez." }
];

describe("metteur en scène", () => {
  it("une réplique précédée d'une indication est une candidate", () => {
    expect(stateCandidates(REGIONS)).toEqual([{ id: "c1", roleId: "comte", context: "(Il tire son épée.)", reply: "Non. Je reste, et je veux que cette tour le sache." }]);
  });

  it("identifiant de la table et citation de l'indication : consigne de la table", () => {
    const check = verifyStateDirections({ items: [{ id: "c1", state: "determined", quote: "tire son épée" }] }, stateCandidates(REGIONS), ROLES);
    expect(check.directions[0]?.direction).toMatch(/Determined/);
    const lookup = directionLookup(check.directions);
    expect(lookup("comte", "Non. Je reste, et je veux")).toMatch(/Determined/);
    expect(lookup("isaure", "Non. Je reste")).toBeUndefined();
  });

  it("citation hors de l'indication, état inventé, ou null : aucune consigne", () => {
    const candidates = stateCandidates(REGIONS);
    expect(verifyStateDirections({ items: [{ id: "c1", state: "angry", quote: "je reste" }] }, candidates, ROLES).rejected).toEqual([{ id: "c1", reason: "quote-absent" }]);
    expect(verifyStateDirections({ items: [{ id: "c1", state: "heroic voice please", quote: "tire son épée" }] }, candidates, ROLES).rejected).toEqual([{ id: "c1", reason: "invalid-state" }]);
    expect(verifyStateDirections({ items: [{ id: "c1", state: null, quote: "" }] }, candidates, ROLES).directions).toEqual([]);
  });

  it("panne ou mode jeu : rien, la lecture reste en voix figée", async () => {
    expect((await directStates(REGIONS, ROLES, { model: "m", structured: async () => { throw new Error("x"); } }, { gpuYield: () => false })).status).toBe("failed");
    let calls = 0;
    expect((await directStates(REGIONS, ROLES, { model: "m", structured: async () => { calls += 1; return {}; } }, { gpuYield: () => true })).status).toBe("gpu-yield");
    expect(calls).toBe(0);
  });

  it("assignCast : la table passe d'abord, la consigne ajoutée seulement si le moteur joue", () => {
    const seg = (id: string, speakerId: string, text: string, stage?: { label: string; kind: "manner"; quote: string }[]) => ({
      id, sourceSegmentIds: [id], spokenText: text, metadata: { speakerId, ...(stage ? { stage } : {}) }
    });
    const segments = [seg("a", "comte", "Non. Je reste."), seg("b", "isaure", "Partez.", [{ label: "furieuse", kind: "manner", quote: "(furieuse)" }])];
    const extraDirectionOf = (speakerId: string) => (speakerId === "comte" ? "Determined and resolute" : "Whispering");
    const played = assignCast(segments as never, { binding: { voice: "n" }, voiceOf: () => undefined, playsStates: true, extraDirectionOf });
    expect(played.map((s) => (s.metadata?.["cast"] as { direction?: string }).direction)).toEqual(["Determined and resolute", expect.stringMatching(/Angry/)]);
    const frozen = assignCast(segments as never, { binding: { voice: "n" }, voiceOf: () => undefined, playsStates: false, extraDirectionOf });
    expect(frozen.map((s) => (s.metadata?.["cast"] as { direction?: string }).direction)).toEqual([undefined, undefined]);
  });
});
