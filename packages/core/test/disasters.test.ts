import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classicRules as rules, generationRules } from "@melchior/data";
import { actionRefusal, DISASTER_TYPES, Rng, Simulation, strikeDisaster, worldFromPack, type ScenarioPack } from "../src/index.js";

const PACK = resolve(import.meta.dirname, "../../app/public/scenarios/2026.json");
const fresh = () => worldFromPack(JSON.parse(readFileSync(PACK, "utf8")) as ScenarioPack, rules, generationRules, 2026);
const idx = (w: ReturnType<typeof fresh>, k: string) => w.countries.findIndex((c) => c.key === k);

describe.skipIf(!existsSync(PACK))("disastri", () => {
  it("i tipi seguono le probabilità dell'originale e i danni restano proporzionati", () => {
    const w = fresh();
    const rng = new Rng(3);
    const counts = new Map<string, number>();
    for (let k = 0; k < 2000; k++) {
      const before = w.countries.map((c) => c.econPower);
      const d = strikeDisaster(w, rules, rng, idx(w, "US"), k)!;
      counts.set(d.type, (counts.get(d.type) ?? 0) + 1);
      expect(d.casualties).toBeGreaterThanOrEqual(2);
      expect(d.damage / 1e5).toBeLessThanOrEqual(before[d.country]! * 0.01 + 1e-9);
      if (d.type === "earthquake") {
        expect(d.magnitude).toBeGreaterThanOrEqual(6);
        expect(d.magnitude).toBeLessThanOrEqual(8);
      }
      if (d.culprit !== undefined) expect(["planeCrash", "chemical"]).toContain(d.type);
    }
    const share = (t: string) => (counts.get(t) ?? 0) / 2000;
    expect(share("famine")).toBeCloseTo(0.1, 1);
    expect(share("earthquake")).toBeCloseTo(0.2, 1);
    expect(share("planeCrash")).toBeCloseTo(0.25, 1);
    expect(DISASTER_TYPES).toHaveLength(5);
  });

  it("nella simulazione arrivano circa 18 disastri l'anno, e si possono disattivare", () => {
    const run = (disasters: boolean) => {
      const w = fresh();
      const sim = new Simulation({ world: w, rules, seed: 4, start: new Date(Date.UTC(2026, 0, 1)), player: idx(w, "US"), elections: false, disasters });
      sim.advanceDays(365);
      return sim.reports.filter((r) => r.key === "disaster").length;
    };
    const n = run(true);
    expect(n).toBeGreaterThan(8);
    expect(n).toBeLessThan(32);
    expect(run(false)).toBe(0);
  });

  it("gli aiuti d'emergenza si mandano solo a chi è stato colpito di recente", () => {
    const w = fresh();
    const us = idx(w, "US");
    const sim = new Simulation({ world: w, rules, seed: 4, start: new Date(Date.UTC(2026, 0, 1)), player: us, elections: false });
    const cl = idx(w, "CI");
    expect(actionRefusal(w, rules, us, cl, 26, sim.day)).toBe("noDisaster");
    w.disasters.push({ country: cl, day: sim.day, type: 1 });
    w.countries[cl]!.outcry = 50;
    expect(actionRefusal(w, rules, us, cl, 26, sim.day)).toBeNull();
    const pop = sim.budget!.popularity;
    const out = sim.act(26, cl, 50);
    expect(typeof out === "object" && out.success).toBe(true);
    expect(w.countries[cl]!.outcry).toBe(40);
    expect(sim.budget!.popularity).toBeGreaterThan(pop);
    expect(actionRefusal(w, rules, us, cl, 26, sim.day + 61)).toBe("noDisaster");
  });
});

describe.skipIf(!existsSync(PACK))("salvataggi di versioni precedenti", () => {
  it("una partita salvata prima di contingenti e disastri si riprende e va avanti", () => {
    const w = fresh();
    const us = idx(w, "US");
    const sim = new Simulation({ world: w, rules, seed: 4, start: new Date(Date.UTC(2026, 0, 1)), player: us, elections: false });
    const old = JSON.parse(JSON.stringify(sim.save()));
    delete old.world.disasters;
    delete old.world.deployments;
    delete old.disasters;
    const b = Simulation.load(old, rules);
    b.advanceDays(60);
    expect(b.reports.filter((r) => r.key !== "endOfMonth").length).toBeGreaterThan(0);
    expect(b.world.disasters).toBeDefined();
  });
});
