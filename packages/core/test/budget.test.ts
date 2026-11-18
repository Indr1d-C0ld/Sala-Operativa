import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classicRules as rules, generationRules } from "@melchior/data";
import { actionPopularity, evaluateBudget, initialBudget, Simulation, worldFromPack, type ScenarioPack } from "../src/index.js";

const PACK = resolve(import.meta.dirname, "../../app/public/scenarios/2026.json");

describe.skipIf(!existsSync(PACK))("bilancio e popolarità del giocatore", () => {
  const pack = () => JSON.parse(readFileSync(PACK, "utf8")) as ScenarioPack;
  const setup = () => {
    const p = pack();
    const w = worldFromPack(p, rules, generationRules, 2026);
    const us = w.countries.findIndex((c) => c.key === "US");
    const ind = p.countries[us]!.indicators ?? {};
    const b = initialBudget(w.countries[us]!, ind["budget_revenues_usd"]?.value, ind["budget_expenditures_usd"]?.value);
    return { w, us, b };
  };

  it("il bilancio iniziale riproduce entrate e uscite del Factbook", () => {
    const { w, us, b } = setup();
    const p = evaluateBudget(b, { ...w.countries[us]!, gdpGrowth: 0 });
    expect(p.totalRevenue / 4.877e12).toBeCloseTo(1, 1);
    expect(p.totalSpending / 6.857e12).toBeCloseTo(1, 1);
    expect(b.rates.personal).toBeGreaterThan(0);
    expect(b.rates.personal).toBeLessThan(0.6);
  });

  it("senza cambi la proiezione conserva la crescita; alzare le tasse la frena e costa popolarità", () => {
    const { w, us, b } = setup();
    const c = w.countries[us]!;
    const same = evaluateBudget(b, c);
    expect(same.target.growth).toBeCloseTo(c.gdpGrowth, 2);
    const up = evaluateBudget(b, c, { ...b.rates, personal: b.rates.personal + 0.05 }, b.spending);
    expect(up.target.growth).toBeLessThan(same.target.growth);
    expect(up.target.popularity).toBeLessThan(same.target.popularity);
    expect(up.balance).toBeGreaterThan(same.balance);
    // l'asimmetria: abbassare di 5 punti rende meno di quanto costa alzarli
    const down = evaluateBudget(b, c, { ...b.rates, personal: b.rates.personal - 0.05 }, b.spending);
    expect(down.target.popularity - same.target.popularity).toBeLessThan(same.target.popularity - up.target.popularity);
  });

  it("abbassare i dazi costa popolarità (20 punti per ogni punto di dazio)", () => {
    const { w, us, b } = setup();
    const c = w.countries[us]!;
    const same = evaluateBudget(b, c);
    const down = evaluateBudget(b, c, { ...b.rates, tariffs: b.rates.tariffs - 0.01 }, b.spending);
    expect(down.target.popularity).toBeLessThan(same.target.popularity);
  });

  it("il bilancio proposto entra in vigore a fine anno e la popolarità si muove per mesi", () => {
    const { w, us, b } = setup();
    const sim = new Simulation({ world: w, rules, seed: 13, start: new Date(Date.UTC(2026, 11, 1)), player: us, budget: b });
    sim.proposeBudget({ ...b.rates, personal: b.rates.personal + 0.05 }, b.spending);
    expect(sim.budget!.rates.personal).toBeCloseTo(b.rates.personal);
    sim.advanceDays(40);                                         // passa il 1° gennaio
    expect(sim.budget!.rates.personal).toBeCloseTo(b.proposed.rates.personal);
    const pop = sim.budget!.popularity;
    sim.advanceDays(180);
    expect(sim.budget!.popularity).toBeLessThan(pop);
    const copy = Simulation.load(sim.save(), rules);
    expect(copy.budget).toEqual(sim.budget);
  });

  it("le azioni pesano sulla popolarità", () => {
    expect(actionPopularity(21, 5, 2, 4)).toBe(-24);              // invadere un paese della stessa ideologia
    expect(actionPopularity(21, 4, 2, 4)).toBe(-12);              // un amico: metà
    expect(actionPopularity(21, 5, 50, 6)).toBe(-40);             // al massimo −40
    expect(actionPopularity(24, 1, 1, 4)).toBeLessThan(-20);
    expect(actionPopularity(2, 3, 1, 4)).toBeGreaterThan(0);
  });
});
