import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classicRules as rules, generationRules } from "@melchior/data";
import { canInvade, endWar, Rng, Simulation, startWar, warOf, warTick, worldFromPack, type ScenarioPack } from "../src/index.js";

const PACK = resolve(import.meta.dirname, "../../app/public/scenarios/2026.json");

describe.skipIf(!existsSync(PACK))("guerra", () => {
  const fresh = () => worldFromPack(JSON.parse(readFileSync(PACK, "utf8")) as ScenarioPack, rules, generationRules, 2026);
  const idx = (w: ReturnType<typeof fresh>, k: string) => w.countries.findIndex((c) => c.key === k);

  it("si invade un vicino, o chiunque solo da superpotenza", () => {
    const w = fresh();
    expect(canInvade(w, rules, idx(w, "FR"), idx(w, "SP"))).toBe(true);     // confinanti
    expect(canInvade(w, rules, idx(w, "FR"), idx(w, "JA"))).toBe(false);
    expect(canInvade(w, rules, idx(w, "US"), idx(w, "IR"))).toBe(true);     // proiezione
    expect(canInvade(w, rules, idx(w, "FR"), idx(w, "FR"))).toBe(false);
  });

  it("un esercito schiacciante vince e annette; i valori restano nei limiti", () => {
    const w = fresh();
    const a = idx(w, "RS");
    const t = idx(w, "EN");
    const pop = w.countries[a]!.population + w.countries[t]!.population;
    const war = startWar(w, rules, a, t, 0);
    expect(warOf(w, t)).toBe(war);
    expect(canInvade(w, rules, a, idx(w, "UP"))).toBe(false);              // un fronte alla volta
    const rng = new Rng(3);
    let loser: 0 | 1 | null = null;
    for (let d = 0; d < 2000 && loser === null; d++) loser = warTick(w, rules, rng, war);
    expect(loser).toBe(1);
    expect(war.sides[1].totalDead).toBeGreaterThan(0);
    endWar(w, war, 1);
    expect(w.wars).toHaveLength(0);
    const T = w.countries[t]!;
    expect(T.econPower).toBe(0);
    expect(T.controlledBy).toBe(a);
    expect(w.countries[a]!.population).toBeLessThanOrEqual(pop);
    expect(T.peace).toBe(2.5);
    expect(w.worldPeace).toBeGreaterThanOrEqual(1);
    expect(w.worldPeace).toBeLessThanOrEqual(6);
  });

  it("una pace negoziata chiude la guerra senza annessioni", () => {
    const w = fresh();
    const war = startWar(w, rules, idx(w, "FR"), idx(w, "SP"), 0);
    endWar(w, war, null);
    expect(w.wars).toHaveLength(0);
    expect(w.countries[idx(w, "SP")]!.econPower).toBeGreaterThan(0);
  });

  it("il giocatore può invadere, e la guerra prosegue da sola fino alla fine", () => {
    const w = fresh();
    const us = idx(w, "US");
    const sim = new Simulation({ world: w, rules, seed: 8, start: new Date(Date.UTC(2026, 0, 1)), player: us });
    const mx = idx(w, "MX");
    const out = sim.act(21, mx);
    expect(typeof out).toBe("object");
    expect(sim.reports.at(-1)!.key).toBe("warStarted");
    expect(warOf(sim.world, mx)).toBeDefined();
    for (let d = 0; d < 3 * 365 && warOf(sim.world, mx); d++) sim.advanceDay();
    expect(sim.reports.some((r) => r.country === mx && ["warWon", "warRepelled", "peaceNegotiated"].includes(r.key))).toBe(true);
  });

  it("in tre anni l'IA apre e chiude guerre, sempre ripetibili col seme", () => {
    const run = () => {
      const w = fresh();
      const sim = new Simulation({ world: w, rules, seed: 12, start: new Date(Date.UTC(2026, 0, 1)), player: idx(w, "US") });
      sim.advanceDays(3 * 365);
      return sim;
    };
    const a = run();
    expect(a.reports.filter((r) => r.key === "warStarted").length).toBeGreaterThan(0);
    expect(a.reports.some((r) => r.key === "warWon" || r.key === "warRepelled" || r.key === "peaceNegotiated")).toBe(true);
    expect(JSON.stringify(run().save())).toEqual(JSON.stringify(a.save()));
  });
});
