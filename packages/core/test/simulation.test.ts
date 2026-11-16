import { describe, expect, it } from "vitest";
import { classicRules as rules } from "@melchior/data";
import { aidAmount, dampGrowth, minimalWinningCoalition, Rng, Simulation } from "../src/index.js";
import { hasOriginal, loadOriginal } from "./original.js";

describe("generatore casuale", () => {
  it("è ripetibile e rispetta gli estremi", () => {
    const a = new Rng(7);
    const b = new Rng(7);
    const xs = Array.from({ length: 1000 }, () => a.int(1, 6));
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b.int(1, 6)));
    expect(Math.min(...xs)).toBe(1);
    expect(Math.max(...xs)).toBe(6);
  });
});

describe("regole elementari", () => {
  it("smorza le crescite sopra il 5%", () => {
    expect(dampGrowth(0.03)).toBe(0.03);
    expect(dampGrowth(0.2)).toBeCloseTo(0.1);
    expect(dampGrowth(0.08)).toBe(0.05);
    expect(dampGrowth(2)).toBeCloseTo(0.4);
  });

  it("riproduce l'errore dell'originale sugli aiuti solo nel profilo classico", () => {
    expect(aidAmount(1e9, 2e7, 0.1, true)).toBe(1e8 - 2e7);
    expect(aidAmount(1e9, 2e7, 0.1, false)).toBe(2e7);
    expect(aidAmount(5e8, 1e9, 0.1, true)).toBe(5e7);
  });

  it("coalizione minima vincente: egemone, coppia minima, nessuna", () => {
    expect(minimalWinningCoalition([{ index: 1, share: 60 }, { index: 2, share: 40 }], rules)).toEqual([1]);
    const pair = minimalWinningCoalition(
      [{ index: 1, share: 30 }, { index: 2, share: 28 }, { index: 3, share: 25 }, { index: 4, share: 17 }],
      rules,
    );
    expect(pair).toHaveLength(2);
    expect(minimalWinningCoalition([], rules)).toEqual([]);
  });
});

describe.skipIf(!hasOriginal)("ciclo di gioco sul mondo del 1990", () => {
  const start = new Date(Date.UTC(1990, 5, 1));
  const make = (seed: number) => {
    const { world } = loadOriginal("0");
    const player = world.countries.findIndex((c) => c.key === "United States");
    return new Simulation({ world, rules, seed, start, player });
  };
  const fingerprint = (s: Simulation) => JSON.stringify(s.save());

  it("con lo stesso seme due partite sono identiche", () => {
    const a = make(42);
    const b = make(42);
    a.advanceDays(730);
    b.advanceDays(730);
    expect(fingerprint(a)).toEqual(fingerprint(b));
  });

  it("con semi diversi le partite divergono", () => {
    const a = make(42);
    const b = make(43);
    a.advanceDays(400);
    b.advanceDays(400);
    expect(fingerprint(a)).not.toEqual(fingerprint(b));
  });

  it("salvataggio e ripresa danno lo stesso futuro", () => {
    const a = make(9);
    a.advanceDays(150);
    const b = Simulation.load(a.save(), rules);
    a.advanceDays(400);
    b.advanceDays(400);
    expect(fingerprint(a)).toEqual(fingerprint(b));
  });

  it("dopo due anni lo stato resta nei limiti", () => {
    const s = make(1);
    s.advanceDays(2 * 365 + 30);
    const w = s.world;
    expect(s.reports.filter((r) => r.key === "endOfYear")).toHaveLength(2);
    expect(w.worldPeace).toBeGreaterThanOrEqual(1);
    expect(w.worldPeace).toBeLessThanOrEqual(6);
    for (const c of w.countries.filter((c) => c.econPower > 0)) {
      for (const v of [c.econPower, c.influence, c.peace, c.ler, c.outcry, c.milPower, ...Object.values(c.anxiety), ...Object.values(c.hunger)]) {
        expect(Number.isFinite(v), c.key).toBe(true);
      }
      expect(c.ler).toBeGreaterThanOrEqual(0);
      expect(c.ler).toBeLessThanOrEqual(1);
      expect(c.outcry).toBeLessThanOrEqual(100);
      for (const a of Object.values(c.anxiety)) expect(a).toBeLessThanOrEqual(100);
    }
    const shares = w.countries.reduce((t, c) => t + c.milShare, 0);
    expect(shares).toBeCloseTo(100, 6);
  });
});
