import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classicRules as rules, generationRules } from "@melchior/data";
import { Simulation, warheadsIn, worldFromPack, type ScenarioPack } from "../src/index.js";

const PACK = resolve(import.meta.dirname, "../../app/public/scenarios/2026.json");

describe.skipIf(!existsSync(PACK))("mondo dal Factbook 2026 (generazione all'avvio)", () => {
  it("si costruisce e regge un anno di simulazione", () => {
    const pack = JSON.parse(readFileSync(PACK, "utf8")) as ScenarioPack;
    const world = worldFromPack(pack, rules, generationRules, 2026);
    const player = world.countries.findIndex((c) => c.key === "US");
    expect(player).toBeGreaterThanOrEqual(0);
    expect(world.coalition.length).toBeGreaterThan(0);
    const sim = new Simulation({ world, rules, seed: 2026, start: new Date(Date.UTC(2026, 0, 1)), player });
    sim.advanceDays(366);
    expect(sim.reports.some((r) => r.key === "endOfYear")).toBe(true);
    for (const c of sim.world.countries.filter((c) => c.econPower > 0)) {
      expect(Number.isFinite(c.econPower + c.influence + c.outcry + c.ler), c.key).toBe(true);
    }
    expect(sim.world.worldPeace).toBeGreaterThanOrEqual(1);
  });
});

const packOf = (year: number) => resolve(import.meta.dirname, `../../app/public/scenarios/${year}.json`);
const readPack = (year: number) => JSON.parse(readFileSync(packOf(year), "utf8")) as ScenarioPack;
const keyOf = (w: ReturnType<typeof worldFromPack>, key: string) => w.countries.find((c) => c.key === key);

describe("tabelle interpolate", () => {
  it("interpola fra gli anni e resta costante fuori dalla tabella", () => {
    const t: [number, number][] = [[1990, 100], [2000, 50]];
    expect(warheadsIn(t, 1980)).toBe(100);
    expect(warheadsIn(t, 1995)).toBe(75);
    expect(warheadsIn(t, 2030)).toBe(50);
    expect(warheadsIn([], 2000)).toBe(0);
  });
});

describe.skipIf(![1990, 2008, 2026].every((y) => existsSync(packOf(y))))("generazione all'avvio", () => {
  it("con lo stesso seme genera lo stesso mondo, con semi diversi no", () => {
    const pack = readPack(2008);
    const a = JSON.stringify(worldFromPack(pack, rules, generationRules, 7));
    expect(JSON.stringify(worldFromPack(pack, rules, generationRules, 7))).toEqual(a);
    expect(JSON.stringify(worldFromPack(pack, rules, generationRules, 8))).not.toEqual(a);
  });

  for (const year of [1990, 2008, 2026]) {
    it(`${year}: ogni paese attivo ha ideologia, valori nei limiti e una regione`, () => {
      const w = worldFromPack(readPack(year), rules, generationRules, year);
      const ideologies = new Set(rules.ideologies.map((i) => i.letter));
      w.countries.forEach((c, i) => {
        if (!c.econPower) return;
        expect(ideologies.has(c.ideology), `${c.key} ${c.ideology}`).toBe(true);
        expect(c.ideology, c.key).not.toBe("D");       // il fascismo non si assegna mai all'avvio
        for (const v of [c.ethic, c.ambition, c.peace]) {
          expect(v, c.key).toBeGreaterThanOrEqual(1);
          expect(v, c.key).toBeLessThanOrEqual(6);
        }
        expect(c.ler).toBeGreaterThan(0);
        expect(c.ler).toBeLessThan(1);
        const regions = w.regions.filter((r) => r.members.some((m) => m.country === i));
        expect(regions.filter((r) => r.members.some((m) => m.country === i && m.core)), c.key).toHaveLength(1);
        expect(regions.length).toBeLessThanOrEqual(4);
      });
    });

    it(`${year}: confini simmetrici e quote militari che sommano a 100`, () => {
      const w = worldFromPack(readPack(year), rules, generationRules, year);
      w.neighbours.forEach((ns, i) => ns.forEach((j) => expect(w.neighbours[j]).toContain(i)));
      expect(w.countries.reduce((t, c) => t + c.milShare, 0)).toBeCloseTo(100, 6);
      expect(w.coalition.length).toBeGreaterThan(0);
    });
  }

  it("le potenze nucleari cambiano con gli anni", () => {
    const w90 = worldFromPack(readPack(1990), rules, generationRules, 1990);
    const w26 = worldFromPack(readPack(2026), rules, generationRules, 2026);
    expect(keyOf(w90, "SUHH")!.warheads).toBeGreaterThan(30000);
    expect(keyOf(w90, "IN")!.warheads).toBe(0);
    expect(keyOf(w26, "IN")!.warheads).toBeGreaterThan(0);
    expect(keyOf(w26, "KN")!.nucLevel).toBeGreaterThan(0);
    expect(keyOf(w26, "UP")!.warheads).toBe(0);
    expect(keyOf(w26, "US")!.nucLevel).toBe(6);
  });

  it("le ideologie seguono il tipo di governo", () => {
    for (const year of [1990, 2026]) {
      const w = worldFromPack(readPack(year), rules, generationRules, year);
      expect(keyOf(w, "CH")!.ideology, `${year}`).toBe("B");
      expect(keyOf(w, "US")!.ideology, `${year}`).toBe("A");
      expect(keyOf(w, "IR")!.ideology, `${year}`).toBe("F");
      expect(keyOf(w, "SA")!.ideology, `${year}`).toBe("M");
      expect(keyOf(w, "IS")!.ideology, `${year}`).toBe("G");
    }
    const w90 = worldFromPack(readPack(1990), rules, generationRules, 1990);
    expect(keyOf(w90, "SUHH")!.ideology).toBe("B");
    const su = w90.countries.findIndex((c) => c.key === "SUHH");
    expect(w90.regions.find((r) => r.members.some((m) => m.core && m.country === su))!.name).toBe("Europa orientale");
  });
});
