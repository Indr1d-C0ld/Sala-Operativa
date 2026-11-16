import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classicRules as rules, generationRules } from "@melchior/data";
import { Simulation, worldFromPack, type ScenarioPack } from "../src/index.js";

const dir = resolve(import.meta.dirname, "../../app/public/scenarios");
const pack = (y: number) => JSON.parse(readFileSync(resolve(dir, `${y}.json`), "utf8")) as ScenarioPack;

describe.skipIf(!existsSync(resolve(dir, "2026.json")))("deriva procedurale", () => {
  it("con deriva 0 il mondo è identico a quello storico", () => {
    const p = pack(2008);
    expect(JSON.stringify(worldFromPack(p, rules, generationRules, 5, { drift: 0 })))
      .toEqual(JSON.stringify(worldFromPack(p, rules, generationRules, 5)));
  });

  it("con la deriva il mondo cambia, in modo ripetibile col seme", () => {
    const p = pack(2008);
    const a = worldFromPack(p, rules, generationRules, 5, { drift: 0.8, protect: ["US"] });
    const b = worldFromPack(p, rules, generationRules, 5, { drift: 0.8, protect: ["US"] });
    const base = worldFromPack(p, rules, generationRules, 5);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    const changed = a.countries.filter((c, i) => c.ideology !== base.countries[i]!.ideology).length;
    expect(changed).toBeGreaterThan(5);
    const us = a.countries.findIndex((c) => c.key === "US");
    expect(a.countries[us]!.ideology).toBe(base.countries[us]!.ideology);    // il giocatore è protetto
    for (const c of a.countries) {
      expect(c.ethic).toBeGreaterThanOrEqual(1);
      expect(c.ethic).toBeLessThanOrEqual(6);
      expect(c.ideology).not.toBe("D");
      expect(Number.isFinite(c.econPower)).toBe(true);
    }
  });

  it("ogni anno dal 1990 al 2026 si genera e regge un anno di gioco", { timeout: 60_000 }, () => {
    for (let y = 1990; y <= 2026; y++) {
      if (!existsSync(resolve(dir, `${y}.json`))) continue;
      const w = worldFromPack(pack(y), rules, generationRules, y, { drift: 0.3, protect: ["US"] });
      const us = w.countries.findIndex((c) => c.key === "US");
      expect(us, `${y}`).toBeGreaterThanOrEqual(0);
      // senza elezioni: nel 1992 la recessione fa perdere il voto di novembre, come nella storia
      const sim = new Simulation({ world: w, rules, seed: y, start: new Date(Date.UTC(y, 0, 1)), player: us, elections: false });
      sim.advanceDays(366);
      expect(sim.reports.some((r) => r.key === "endOfYear"), `${y}`).toBe(true);
      for (const c of sim.world.countries) if (c.econPower) expect(Number.isFinite(c.econPower + c.influence), `${y} ${c.key}`).toBe(true);
    }
  });
});
