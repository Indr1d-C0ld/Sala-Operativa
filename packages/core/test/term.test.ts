import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classicRules as rules, generationRules } from "@melchior/data";
import { electionDay, holdElection, nextElection, Rng, Simulation, unpopularityCheck, worldFromPack, type ScenarioPack } from "../src/index.js";

const iso = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);

describe("calendario elettorale", () => {
  it("primo martedì dopo il primo lunedì di novembre, ogni quattro anni", () => {
    expect(iso(electionDay(1992))).toBe("1992-11-03");
    expect(iso(electionDay(2000))).toBe("2000-11-07");
    expect(iso(electionDay(2016))).toBe("2016-11-08");
    expect(iso(electionDay(2028))).toBe("2028-11-07");
    const jan1990 = Date.UTC(1990, 0, 1) / 86_400_000;
    expect(iso(nextElection(jan1990))).toBe("1992-11-03");
    expect(iso(nextElection(electionDay(1992)))).toBe("1992-11-03");      // il giorno stesso
    expect(iso(nextElection(electionDay(1992) + 1))).toBe("1996-11-05");
  });
});

describe("esito delle elezioni e impopolarità", () => {
  it("sopra il 50% si vince, sotto il 40% si perde, in mezzo dipende dal dado", () => {
    const rng = new Rng(1);
    expect(holdElection(rng, 50)).toBe(true);
    expect(holdElection(rng, 39.9)).toBe(false);
    let wins = 0;
    for (let k = 0; k < 2000; k++) if (holdElection(rng, 45)) wins++;
    expect(wins / 2000).toBeGreaterThan(0.42);
    expect(wins / 2000).toBeLessThan(0.58);
  });

  it("sotto il 15% il presidente rischia, sopra no", () => {
    const rng = new Rng(2);
    expect(unpopularityCheck(rng, 20, 3)).toBeNull();
    let falls = 0, killed = 0;
    for (let k = 0; k < 1000; k++) if (unpopularityCheck(rng, 5, 3)) falls++;
    expect(falls / 1000).toBeCloseTo(0.85, 1);
    // con etica ≥ 3 il presidente è sempre destituito; un presidente spietato può essere ucciso
    for (let k = 0; k < 1000; k++) {
      const f = unpopularityCheck(rng, 5, 3);
      if (f === "killed") killed++;
    }
    expect(killed).toBe(0);
    for (let k = 0; k < 1000; k++) if (unpopularityCheck(rng, 5, 1) === "killed") killed++;
    expect(killed).toBeGreaterThan(0);
  });
});

const PACK = resolve(import.meta.dirname, "../../app/public/scenarios/1990.json");

describe.skipIf(!existsSync(PACK))("il mandato nella simulazione", () => {
  const make = (popularity: number, elections = true) => {
    const w = worldFromPack(JSON.parse(readFileSync(PACK, "utf8")) as ScenarioPack, rules, generationRules, 1990);
    const us = w.countries.findIndex((c) => c.key === "US");
    const sim = new Simulation({ world: w, rules, seed: 4, start: new Date(Date.UTC(1992, 9, 1)), player: us, elections });
    sim.budget!.popularity = popularity;
    return sim;
  };

  it("una popolarità alta porta al secondo mandato", () => {
    const sim = make(70);
    expect(sim.daysToElection).toBe(33);
    sim.advanceDays(40);
    expect(sim.gameOver).toBeNull();
    expect(sim.terms).toBe(2);
    expect(sim.reports.some((r) => r.key === "electionWon" && r.stage === 2)).toBe(true);
  });

  it("una popolarità bassa fa perdere le elezioni e chiude la partita", () => {
    const sim = make(30);
    sim.budget!.monthly.popularity = 0;
    sim.advanceDays(40);
    expect(sim.gameOver).toBe("electionLost");
    expect(sim.reports.some((r) => r.key === "electionLost")).toBe(true);
  });

  it("con le elezioni disattivate non si vota", () => {
    const sim = make(30, false);
    expect(sim.daysToElection).toBeNull();
    sim.advanceDays(40);
    expect(sim.gameOver).not.toBe("electionLost");
  });

  it("sotto il 15% la presidenza cade in pochi mesi", () => {
    const sim = make(5, false);
    for (let m = 0; m < 12 && !sim.gameOver; m++) { sim.budget!.popularity = 5; sim.advanceDays(31); }
    expect(["playerKilled", "playerOusted"]).toContain(sim.gameOver);
  });
});
