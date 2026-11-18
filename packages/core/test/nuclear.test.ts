import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classicRules as rules, generationRules } from "@melchior/data";
import { actionRefusal, donorReactions, globalEffects, hasNukes, nuclearStrike, regionalFallout, Rng, Simulation, startWar, warEscalation, worldFromPack, type ScenarioPack } from "../src/index.js";

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
    const before = { ir: w.countries[ir]!.econPower, far: w.countries[far]!.econPower, warheads: w.countries[us]!.warheads, pop: w.countries[ir]!.population };
    const out = nuclearStrike(w, new Rng(1), us, ir, 20);
    // effetto diretto: testate spese, morti, pace 1 per il mondo e per i due paesi
    expect(out.warheads).toBe(20);
    expect(w.countries[us]!.warheads).toBe(before.warheads - 20);
    expect(w.countries[ir]!.population).toBeCloseTo(before.pop - Math.min(1.5e6 * 20 + 0.03 * before.pop, 0.95 * before.pop), -2);
    expect(w.worldPeace).toBe(1);
    expect(w.countries[ir]!.peace).toBe(1);
    expect(w.countries[ir]!.outcry).toBe(100);
    expect(out.retaliation.map(([c]) => c)).toEqual([6, 14, 16]);
    // le conseguenze arrivano dopo: ricaduta, reazioni dei donatori, e con più di 8 testate forse l'inverno
    expect(out.consequences.map((c) => c.phase).slice(0, 2)).toEqual([0, 1]);
    expect(out.consequences[0]!.hours).toBeGreaterThanOrEqual(4);
    expect(regionalFallout(w, ir)).toContain(ir);
    globalEffects(w);
    expect(w.countries[ir]!.econPower).toBeCloseTo(before.ir * 0.75 * 0.85, 0);
    expect(w.countries[far]!.econPower).toBeCloseTo(before.far * 0.85, 0);
    // nel turno IA dell'originale si lancia con zero testate: nessun inverno nucleare
    expect(nuclearStrike(fresh(), new Rng(1), us, ir).consequences.map((c) => c.phase)).toEqual([0, 1]);
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
    sim.act(24, idx(w, "KN"), 20);
    expect(sim.reports.map((r) => r.key)).toContain("nuclearStrike");
    expect(sim.reports.map((r) => r.key)).not.toContain("nuclearFallout");
    const kn = idx(w, "KN");
    expect(sim.queue.filter((e) => e.kind === "action" && e.actor === kn && e.target === us)).toHaveLength(3);
    sim.advanceDays(1);
    expect(sim.reports.map((r) => r.key)).toContain("nuclearFallout");
  });

  it("dopo un'atomica i donatori reagiscono contro chi ha colpito", () => {
    const w = fresh();
    const [cn, jp] = [idx(w, "CH"), idx(w, "JA")];
    for (const d of w.donors) w.countries[d]!.influence = 10;      // tutti reagiscono
    const out = donorReactions(w, new Rng(2), cn, jp, idx(w, "US"));
    expect(out.length).toBeGreaterThan(0);
    for (const r of out) {
      expect(r.target).toBe(cn);
      expect([cn, jp, idx(w, "US")]).not.toContain(r.actor);
    }
  });

  it("fuori da una guerra l'IA minaccia invece di colpire, e solo i nemici", () => {
    const run = (maxRel: number) => {
      const w = fresh();
      const r = { ...rules, ai: { ...rules.ai, nuclearAlertMaxRelation: maxRel } };
      const sim = new Simulation({ world: w, rules: r, seed: 3, start: new Date(Date.UTC(2026, 0, 1)), player: idx(w, "US") });
      sim.queue.push({ kind: "action", actor: idx(w, "CH"), target: idx(w, "JA"), code: 24, day: sim.day + 1, hour: 0 });
      sim.advanceDay();
      return sim.reports.map((x) => x.key);
    };
    expect(run(7)).toContain("nuclearAlert");
    expect(run(7)).not.toContain("nuclearStrike");
    expect(run(1)).not.toContain("nuclearAlert");           // Cina e Giappone non sono nemici dichiarati
  });

  it("in guerra l'IA lancia per prima solo se sta perdendo", () => {
    const strike = (strength: number) => {
      const w = fresh();
      const ch = idx(w, "CH");
      const vm = idx(w, "VM");
      const war = startWar(w, rules, ch, vm, 0);
      war.sides[0].strength = strength;
      // senza tick di guerra la forza resta quella impostata
      const r = { ...rules, war: { ...rules.war, tickEveryDays: 997 } };
      const sim = new Simulation({ world: w, rules: r, seed: 3, start: new Date(Date.UTC(2026, 0, 1)), player: idx(w, "US") });
      sim.queue.push({ kind: "action", actor: ch, target: vm, code: 24, day: sim.day + 1, hour: 0 });
      sim.advanceDay();
      return sim.reports.some((x) => x.key === "nuclearStrike");
    };
    expect(strike(90)).toBe(false);
    expect(strike(30)).toBe(true);
  });
});
