import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classicRules as rules, generationRules } from "@melchior/data";
import { actionRefusal, hasNukes, nuclearStrike, Rng, Simulation, startWar, warEscalation, worldFromPack, type ScenarioPack } from "../src/index.js";

const PACK = resolve(import.meta.dirname, "../../app/public/scenarios/2026.json");

describe.skipIf(!existsSync(PACK))("armi nucleari", () => {
  const fresh = () => worldFromPack(JSON.parse(readFileSync(PACK, "utf8")) as ScenarioPack, rules, generationRules, 2026);
  const idx = (w: ReturnType<typeof fresh>, k: string) => w.countries.findIndex((c) => c.key === k);

  it("serve un arsenale per colpire", () => {
    const w = fresh();
    expect(hasNukes(w.countries[idx(w, "US")]!)).toBe(true);
    expect(actionRefusal(w, rules, idx(w, "IT"), idx(w, "FR"), 24)).toBe("noNukes");
    expect(actionRefusal(w, rules, idx(w, "US"), idx(w, "IR"), 24)).toBeNull();
  });

  it("un attacco devasta la regione e pesa su tutto il mondo", () => {
    const w = fresh();
    const us = idx(w, "US");
    const ir = idx(w, "IR");
    const far = idx(w, "BR");
    const before = { ir: w.countries[ir]!.econPower, far: w.countries[far]!.econPower, warheads: w.countries[us]!.warheads };
    const out = nuclearStrike(w, new Rng(1), us, ir);
    expect(out.fallout).toContain(ir);
    expect(w.countries[ir]!.econPower).toBeCloseTo(before.ir * 0.75 * 0.85, 0);
    expect(w.countries[far]!.econPower).toBeCloseTo(before.far * 0.85, 0);
    expect(w.countries[us]!.warheads).toBe(before.warheads - 1);
    expect(w.worldPeace).toBe(1);
    expect(w.countries[ir]!.outcry).toBe(100);
    expect(out.retaliation.map(([c]) => c)).toEqual([6, 14, 16]);
    for (const c of w.countries) {
      expect(c.peace).toBeGreaterThanOrEqual(1);
      expect(c.ethic).toBeGreaterThanOrEqual(1);
      expect(c.ambition).toBeLessThanOrEqual(6);
    }
  });

  it("in guerra chi perde e ha l'atomica può usarla", () => {
    const w = fresh();
    const war = startWar(w, rules, idx(w, "IN"), idx(w, "PK"), 0);
    war.sides[1].strength = 10;                       // il Pakistan sta crollando
    const pk = w.countries[idx(w, "PK")]!;
    pk.ambition = 6;
    pk.peace = 1;
    let hit = false;
    const rng = new Rng(4);
    for (let k = 0; k < 50 && !hit; k++) hit = warEscalation(w, rng, war)?.actor === idx(w, "PK");
    expect(hit).toBe(true);
    war.sides[1].strength = 90;
    expect(warEscalation(w, rng, war)).toBeUndefined();
  });

  it("il giocatore può colpire; il bersaglio prepara le ritorsioni", () => {
    const w = fresh();
    const us = idx(w, "US");
    const sim = new Simulation({ world: w, rules, seed: 3, start: new Date(Date.UTC(2026, 0, 1)), player: us });
    sim.act(24, idx(w, "KN"));
    expect(sim.reports.map((r) => r.key)).toEqual(expect.arrayContaining(["nuclearStrike", "nuclearFallout", "nuclearWinter"]));
    const kn = idx(w, "KN");
    expect(sim.queue.filter((e) => e.kind === "action" && e.actor === kn && e.target === us)).toHaveLength(3);
  });

  it("fuori da una guerra l'IA minaccia invece di colpire", () => {
    const w = fresh();
    const sim = new Simulation({ world: w, rules, seed: 3, start: new Date(Date.UTC(2026, 0, 1)), player: idx(w, "US") });
    sim.queue.push({ kind: "action", actor: idx(w, "CH"), target: idx(w, "JA"), code: 24, day: sim.day + 1, hour: 0 });
    sim.advanceDay();
    expect(sim.reports.some((r) => r.key === "nuclearAlert")).toBe(true);
    expect(sim.reports.some((r) => r.key === "nuclearStrike")).toBe(false);
  });
});
