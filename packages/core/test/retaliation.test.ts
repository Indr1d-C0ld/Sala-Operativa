import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classicRules as rules, generationRules } from "@melchior/data";
import { covertPopularity, retaliation } from "../src/systems/retaliation.js";
import { Rng, Simulation, worldFromPack, type ScenarioPack } from "../src/index.js";

describe("ritorsioni (APPACT.FIL)", () => {
  it("la tabella ha tre righe di cinque risposte per ogni codice, e una gravità per codice", () => {
    expect(rules.retaliation.responses).toHaveLength(26);
    for (const rows of rules.retaliation.responses) {
      expect(rows).toHaveLength(3);
      for (const row of rows) expect(row).toHaveLength(5);
    }
    expect(rules.retaliation.gravity).toHaveLength(26);
  });

  const PACK = resolve(import.meta.dirname, "../../app/public/scenarios/2026.json");
  const fresh = () => worldFromPack(JSON.parse(readFileSync(PACK, "utf8")) as ScenarioPack, rules, generationRules, 2026);

  it.skipIf(!existsSync(PACK))("i paesi ambiziosi si limitano a condannare, gli altri rispondono davvero", () => {
    const w = fresh();
    const k = (c: string) => w.countries.findIndex((x) => x.key === c);
    const [r, a] = [k("IR"), k("IZ")];
    const answers = (ambition: number, ethic: number) => {
      w.countries[r]!.ambition = ambition;
      w.countries[r]!.ethic = ethic;
      const rng = new Rng(3);
      const out = new Set<number | null>();
      for (let n = 0; n < 500; n++) out.add(retaliation(w, rules, rng, r, a, 14));
      return out;
    };
    // ambizione 6: solo condanna o niente
    expect([...answers(6, 1)].every((x) => x === null || x === 6)).toBe(true);
    // ambizione 1, etica 1: le risposte della riga dura (armi, sabotaggio, attacco…)
    const hard = answers(1, 1);
    expect([...hard].some((x) => x !== null && x !== 6)).toBe(true);
    // etica 6: la condanna resta solo se rand(0,8) ≥ 6
    w.countries[r]!.ambition = 6;
    w.countries[r]!.ethic = 6;
    const rng = new Rng(5);
    let condemn = 0;
    for (let n = 0; n < 2000; n++) if (retaliation(w, rules, rng, r, a, 14) === 6) condemn++;
    expect(condemn / 2000).toBeLessThan(0.4);
  });

  it("la popolarità di un'operazione scoperta dipende da affinità e influenza", () => {
    expect(covertPopularity(14, true, 1, 1, 4, 3)).toBe(0);          // sabotaggio a un nemico: 3 − 3·1
    expect(covertPopularity(15, true, 5, 1, 4, 3)).toBe(-30);        // colpo di stato a un alleato: −30 al massimo
    expect(covertPopularity(16, false, 4, 2, 4, 3)).toBe(-16);       // assassinio fallito di un amico
    expect(covertPopularity(15, true, 1, 2, 4, 3)).toBe(7);          // colpo di stato riuscito a un nemico
    expect(covertPopularity(12, true, 1, 2, 4, 3)).toBeNull();
  });

  it.skipIf(!existsSync(PACK))("un'operazione coperta del giocatore può finire sui giornali", () => {
    const w = fresh();
    const us = w.countries.findIndex((c) => c.key === "US");
    const target = w.countries.findIndex((c) => c.key === "CU");
    w.countries[us]!.ler = 0.01;                                     // la stampa scopre il 74% delle volte
    const sim = new Simulation({ world: w, rules, seed: 7, start: new Date(Date.UTC(2026, 0, 1)), player: us });
    for (let n = 0; n < 10; n++) sim.act(14, target);
    expect(sim.reports.some((r) => r.key === "covertExposed")).toBe(true);
    expect(sim.queue.some((e) => e.kind === "popularity")).toBe(true);
  });

  it.skipIf(!existsSync(PACK))("in un mondo agitato la CIA avvisa delle operazioni in preparazione", () => {
    const w = fresh();
    for (const c of w.countries) { c.peace = 1; c.ethic = 1; }
    w.worldPeace = 1;
    const sim = new Simulation({ world: w, rules, seed: 2, start: new Date(Date.UTC(2026, 0, 1)), player: w.countries.findIndex((c) => c.key === "US") });
    sim.advanceDays(2 * 365);
    const warnings = sim.reports.filter((r) => r.key === "ciaWarning" && r.action !== undefined);
    expect(warnings.length).toBeGreaterThan(0);
    for (const r of warnings) expect([14, 15, 16]).toContain(r.action);
  });
});
