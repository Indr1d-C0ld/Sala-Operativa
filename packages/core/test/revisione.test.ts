import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classicRules as rules, generationRules } from "@melchior/data";
import { advisorReport, Rng, Simulation, startWar, warTick, worldFromPack, type ScenarioPack } from "../src/index.js";

const PACK = resolve(import.meta.dirname, "../../app/public/scenarios/2026.json");
const fresh = (opts = {}) => worldFromPack(JSON.parse(readFileSync(PACK, "utf8")) as ScenarioPack, rules, generationRules, 2026, opts);
const idx = (w: ReturnType<typeof fresh>, k: string) => w.countries.findIndex((c) => c.key === k);

describe.skipIf(!existsSync(PACK))("correttivi della revisione", () => {
  it("se il paese del giocatore viene annesso la partita finisce", () => {
    const w = fresh();
    const us = idx(w, "US");
    const mx = idx(w, "MX");
    const sim = new Simulation({ world: w, rules, seed: 1, start: new Date(Date.UTC(2026, 0, 1)), player: us, elections: false });
    const war = startWar(w, rules, mx, us, sim.day);
    war.sides[1].troops = 0;                       // difesa americana crollata
    sim.advanceDay();
    expect(sim.gameOver).toBe("playerConquered");
    expect(sim.reports.at(-1)!.key).toBe("playerConquered");
  });

  it("a partita finita il resto della giornata non avviene", () => {
    const w = fresh();
    const us = idx(w, "US");
    const sim = new Simulation({ world: w, rules, seed: 1, start: new Date(Date.UTC(2026, 11, 31)), player: us, elections: false });
    sim.budget!.popularity = 0;                    // il controllo di fine mese lo fa cadere quasi certamente
    let tries = 0;
    while (!sim.gameOver && tries++ < 20) {
      const copy = Simulation.load(sim.save(), rules);
      copy.budget!.popularity = 0;
      copy.advanceDay();
      if (copy.gameOver) {
        expect(copy.reports.some((r) => r.key === "endOfYear")).toBe(false);
        return;
      }
      sim.rng.next();                              // altro tentativo con un altro stato del generatore
    }
    throw new Error("il presidente non è mai caduto: il test non ha verificato nulla");
  });

  it("una proposta accettata sulla spesa militare entra nel bilancio", () => {
    const w = fresh();
    const us = idx(w, "US");
    const sim = new Simulation({ world: w, rules, seed: 1, start: new Date(Date.UTC(2026, 0, 1)), player: us, interactive: true });
    const before = sim.budget!.spending.defense;
    sim.pending = { kind: "decision", actor: idx(w, "FR"), code: 18 };
    sim.decide(true);
    expect(sim.budget!.spending.defense).toBeCloseTo(before * 0.9, 0);
    expect(sim.budget!.proposed.spending.defense).toBeCloseTo(before * 0.9, 0);
  });

  it("la deriva sugli eserciti si riflette nella belligeranza", () => {
    const base = fresh();
    const drifted = fresh({ drift: 1, protect: ["US"] });
    let consistent = 0;
    drifted.countries.forEach((c, i) => {
      const b = base.countries[i]!;
      if (!c.econPower || !b.econPower || !b.milSpend) return;
      const ratioSpend = (c.milSpend / (c.econPower * 1e5)) / (b.milSpend / (b.econPower * 1e5));
      if (Math.abs(c.belligerenceAvg / b.belligerenceAvg - ratioSpend) < 1e-6) consistent++;
    });
    expect(consistent).toBeGreaterThan(100);
  });

  it("i caduti in guerra escono dalla popolazione del paese", () => {
    const w = fresh();
    const a = idx(w, "RS");
    const t = idx(w, "UP");
    const pop = w.countries[a]!.population;
    const war = startWar(w, rules, a, t, 0);
    warTick(w, rules, new Rng(2), war);
    expect(w.countries[a]!.population).toBeCloseTo(pop - war.sides[0].dead - war.sides[0].civilians, -1);
  });

  it("il portavoce riporta notizie distinte anche nello stesso giorno", () => {
    const w = fresh();
    const us = idx(w, "US");
    const sim = new Simulation({ world: w, rules, seed: 1, start: new Date(Date.UTC(2026, 0, 1)), player: us });
    const ir = idx(w, "IR");
    sim.reports.push({ day: sim.day, key: "socialHappened", country: ir, stage: 9 }, { day: sim.day, key: "regimeChange", country: ir });
    const ctx = sim.advisorContext();
    const refs = advisorReport(ctx, "press", ir).map((l) => l.ref);
    expect(new Set(refs).size).toBe(refs.length);
    expect(refs.map((r) => ctx.news[r!]!.key)).toEqual(expect.arrayContaining(["socialHappened", "regimeChange"]));
  });
});
