/** ADR-018 §1.3 et §5.1 : `D` calculé sur table. */
import { describe, expect, it } from "vitest";
import { estimateAudioSeconds, estimateSynthesisSeconds, minimumLeadSeconds, planReading } from "../../../../src/direction/cast/synthesisPlan.js";

const CHARS_PER_SECOND = 17;
const passage = (seconds: number, cached = false) => ({ chars: Math.round(seconds * CHARS_PER_SECOND), cached });

describe("modèle de coût", () => {
  it.each([[2, 3.5], [5, 6.0], [10, 10.2], [20, 18.6]])("un passage de %d s coûte environ %d s", (audio, expected) => {
    expect(estimateSynthesisSeconds(audio)).toBeCloseTo(expected, 0);
  });
  it("17 caractères par seconde", () => {
    expect(estimateAudioSeconds(170)).toBe(10);
  });
});

describe("minimumLeadSeconds", () => {
  it("la scène de l'ADR : 10 répliques, 43,5 s d'audio, environ 54 s de synthèse et 15 s d'avance", () => {
    const rows = Array.from({ length: 10 }, () => ({ audioSeconds: 4.35, synthesisSeconds: estimateSynthesisSeconds(4.35) }));
    expect(rows.reduce((sum, row) => sum + row.synthesisSeconds, 0)).toBeCloseTo(54.5, 0);
    expect(minimumLeadSeconds(rows)).toBeCloseTo(15.4, 0);
  });
  it.each([
    [[{ audioSeconds: 10, synthesisSeconds: 5 }, { audioSeconds: 10, synthesisSeconds: 5 }], 5],
    [[{ audioSeconds: 2, synthesisSeconds: 3 }, { audioSeconds: 2, synthesisSeconds: 9 }], 10],
    [[{ audioSeconds: 2, synthesisSeconds: 0 }, { audioSeconds: 2, synthesisSeconds: 0 }], 0],
    [[], 0]
  ])("table %#", (rows, expected) => {
    expect(minimumLeadSeconds(rows)).toBeCloseTo(expected, 5);
  });
});

describe("planReading", () => {
  it("tout en cache : départ immédiat, rien à attendre", () => {
    expect(planReading([passage(5, true), passage(5, true)])).toMatchObject({ decision: "immediate", leadSeconds: 0, leadChunks: 0, missing: 0 });
  });

  it("au plus 20 s : avance préparée puis lecture ; `leadChunks` couvre `D`", () => {
    const plan = planReading(Array.from({ length: 10 }, () => passage(4.35)));
    expect(plan.decision).toBe("lead");
    expect(plan.leadSeconds).toBeGreaterThan(14);
    expect(plan.leadChunks).toBe(2);
    expect(plan.prefetchChunks).toBeGreaterThanOrEqual(plan.leadChunks);
    expect(plan.missing).toBe(10);
  });

  it("au-delà de 20 s : on demande, et le temps total sert au message", () => {
    const plan = planReading(Array.from({ length: 60 }, () => passage(2)));
    expect(plan.decision).toBe("ask");
    expect(plan.synthesisSeconds).toBeCloseTo(60 * estimateSynthesisSeconds(2), 0);
  });

  it("la fenêtre équivaut à 120 s d'audio estimées", () => {
    expect(planReading(Array.from({ length: 200 }, () => passage(10))).prefetchChunks).toBe(12);
    expect(planReading(Array.from({ length: 200 }, () => passage(120))).prefetchChunks).toBe(2);
  });

  it("un passage déjà en cache n'ajoute rien à `D`, et sa durée compte comme de l'avance", () => {
    const plan = planReading([passage(20, true), passage(5)]);
    expect(plan.leadSeconds).toBe(0);
    expect(plan.decision).toBe("lead");
    expect(plan.leadChunks).toBe(0);
    expect(plan.missing).toBe(1);
  });
});
