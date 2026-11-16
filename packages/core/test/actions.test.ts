import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classicRules as rules, generationRules } from "@melchior/data";
import { ACTIONS, actionRefusal, actionThreshold, performAction, Rng, Simulation, worldFromPack, type ScenarioPack } from "../src/index.js";
import { hasOriginal, loadOriginal } from "./original.js";

// Soglie calcolate da tools/sp_odds.py sullo scenario originale del 1990 (due decimali)
const EXPECTED: Record<string, Record<number, number>> = {
  "United States|Iraq": { 0: 27.64, 1: 27.64, 2: 32.64, 3: 32.64, 4: 10, 5: 37.14, 6: 70, 7: 50, 12: 13.96, 14: 17.78, 15: 10.96, 16: 7.55, 18: 11.14, 19: 31.42, 20: 100 },
  "Soviet Union|Cuba": { 0: 50, 1: 37.5, 2: 35.71, 3: 100, 4: 49.14, 5: 50, 6: 70, 7: 50, 12: 50, 14: 21.55, 15: 20.49, 16: 19.95, 18: 39.11, 19: 50, 20: 100 },
  "Israel|Syria": { 0: 5.59, 1: 10, 2: 10.59, 3: 10.59, 4: 10, 5: 10.19, 6: 70, 7: 10.1, 12: 8, 14: 5.11, 15: 5.11, 16: 5.11, 18: 10, 19: 10, 20: 65.1 },
  "Japan|China": { 0: 10.92, 1: 10.92, 2: 24.96, 3: 25, 4: 18.91, 5: 20.26, 6: 70, 7: 15.13, 12: 3.1, 14: 1, 15: 1, 16: 1, 18: 10, 19: 10, 20: 100 },
};

describe.skipIf(!hasOriginal)("soglie delle azioni sullo scenario originale del 1990", () => {
  const { world } = loadOriginal("0");
  const idx = (name: string) => world.countries.findIndex((c) => c.key === name);
  for (const [pair, expected] of Object.entries(EXPECTED)) {
    it(pair.replace("|", " → "), () => {
      const [a, t] = pair.split("|").map(idx) as [number, number];
      for (const [code, s] of Object.entries(expected)) {
        expect(actionThreshold(world, rules, a, t, Number(code)), `azione ${code}`).toBeCloseTo(s, 1);
      }
    });
  }
});

const PACK = resolve(import.meta.dirname, "../../app/public/scenarios/2026.json");

describe.skipIf(!existsSync(PACK))("azioni su un mondo generato", () => {
  const fresh = () => worldFromPack(JSON.parse(readFileSync(PACK, "utf8")) as ScenarioPack, rules, generationRules, 2026);
  const w0 = fresh();
  const us = w0.countries.findIndex((c) => c.key === "US");
  const ir = w0.countries.findIndex((c) => c.key === "IR");
  const uk = w0.countries.findIndex((c) => c.key === "UK");

  it("rifiuta le azioni non ammesse", () => {
    expect(actionRefusal(w0, rules, us, us, 0)).toBe("self");
    expect(actionRefusal(w0, rules, us, ir, 24)).toBeNull();               // gli USA hanno testate
    expect(actionRefusal(w0, rules, us, ir, 17)).toBe("noConflict");
    const small = w0.countries.findIndex((c, i) => c.econPower > 0 && !w0.donors.includes(i));
    expect(actionRefusal(w0, rules, small, ir, 8)).toBe("notDonor");
    expect(actionRefusal(w0, rules, us, ir, 8)).toBeNull();
  });

  it("le soglie sono finite e i tetti delle azioni coperte rispettati", () => {
    for (const t of [ir, uk]) {
      for (const { code } of ACTIONS) {
        const s = actionThreshold(w0, rules, us, t, code);
        if (s === null) continue;
        expect(Number.isFinite(s), `azione ${code}`).toBe(true);
        if (code >= 14 && code <= 16) {
          const D = Math.trunc((code - 12) ** 2 / 2);
          expect(s).toBeLessThanOrEqual(100 / D + D);
        }
      }
    }
  });

  it("gli effetti restano nei limiti e sono ripetibili col seme", () => {
    const run = (seed: number) => {
      const w = fresh();
      const rng = new Rng(seed);
      const out = [];
      for (const { code } of ACTIONS) {
        if (actionRefusal(w, rules, us, ir, code)) continue;
        out.push(performAction(w, rules, rng, us, ir, code, 50));
      }
      return { w, out };
    };
    const a = run(5);
    const b = run(5);
    expect(a.out).toEqual(b.out);
    for (const c of [a.w.countries[us]!, a.w.countries[ir]!]) {
      for (const v of [c.peace, c.ethic, c.ambition]) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(6);
      }
    }
    expect(a.w.countries[ir]!.tradeLevel[a.w.donors.indexOf(us)]).toBe(1);   // ultimo: blocco (11)
    expect(a.w.countries[ir]!.spiesReceived[a.w.donors.indexOf(us)]).toBeGreaterThanOrEqual(50);
  });

  it("il giocatore agisce dalla simulazione e l'esito finisce nelle notizie", () => {
    const sim = new Simulation({ world: fresh(), rules, seed: 3, start: new Date(Date.UTC(2026, 0, 1)), player: us });
    expect(sim.act(0, us)).toBe("self");
    const out = sim.act(6, ir);
    expect(typeof out).toBe("object");
    const last = sim.reports.at(-1)!;
    expect(["actionSucceeded", "actionFailed"]).toContain(last.key);
    expect(last.action).toBe(6);
    expect(last.country).toBe(ir);
    sim.advanceDays(40);                               // la simulazione prosegue dopo l'azione
    expect(sim.reports.some((r) => r.key === "endOfMonth")).toBe(true);
  });
});
