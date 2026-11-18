import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classicRules as rules, generationRules } from "@melchior/data";
import { adjustAction, chooseAction, planAiTurn, restrained, Rng, Simulation, tradeStep, worldFromPack, type ScenarioPack } from "../src/index.js";

describe("tabelle del turno IA", () => {
  it("in ogni colonna i pesi di ciascun gruppo sommano a 100 (BIGTABLE.TXT)", () => {
    const { weights, groupStart } = rules.ai;
    expect(weights).toHaveLength(28);
    for (let g = 0; g < 5; g++) {
      for (let col = 0; col < 6; col++) {
        let sum = 0;
        for (let row = groupStart[g]!; row < groupStart[g + 1]!; row++) sum += weights[row]![col]!;
        expect(sum, `gruppo ${g}, colonna ${col + 1}`).toBe(100);
      }
    }
  });

  it("ogni riga ha il suo codice d'azione; le due righe del commercio sono a parte", () => {
    const { rowToCode, tradeDownRow, tradeUpRow, weights } = rules.ai;
    expect(rowToCode).toHaveLength(weights.length);
    rowToCode.forEach((code, row) => {
      if (row === tradeDownRow || row === tradeUpRow) expect(code).toBe(-1);
      else expect(code).toBeGreaterThanOrEqual(0);
    });
    // il primo gruppo è il più ostile (atomica, invasione), l'ultimo il più mite (riforme, diritti umani)
    expect(rowToCode.slice(0, 2)).toEqual([24, 21]);
    expect(rowToCode.slice(-2)).toEqual([0, 1]);
  });

  it("le soglie dei gruppi sono cumulative e arrivano a 100", () => {
    for (const row of rules.ai.groupByEthic) {
      expect(row.at(-1)).toBe(100);
      for (let k = 1; k < row.length; k++) expect(row[k]!).toBeGreaterThanOrEqual(row[k - 1]!);
    }
  });
});

const PACK = resolve(import.meta.dirname, "../../app/public/scenarios/2026.json");

describe.skipIf(!existsSync(PACK))("turno IA su un mondo generato", () => {
  const fresh = () => worldFromPack(JSON.parse(readFileSync(PACK, "utf8")) as ScenarioPack, rules, generationRules, 2026);
  const w = fresh();
  const key = (k: string) => w.countries.findIndex((c) => c.key === k);
  const us = key("US");

  it("con lo stesso seme pianifica le stesse azioni, e mai contro il giocatore", () => {
    const a = Array.from({ length: 30 }, (_, k) => planAiTurn(w, rules, new Rng(k), us));
    const b = Array.from({ length: 30 }, (_, k) => planAiTurn(w, rules, new Rng(k), us));
    expect(a).toEqual(b);
    for (const p of a.flat()) {
      expect(p.target).not.toBe(us);
      expect(p.actor).not.toBe(us);
      expect(p.actor).not.toBe(p.target);
      expect(p.delayHours).toBeGreaterThanOrEqual(0);
      expect(p.delayHours).toBeLessThan(72);
    }
  });

  it("un paese scrupoloso verso un amico è meno ostile di uno spietato verso un nemico", () => {
    const hostile = new Set([6, 12, 14, 15, 16, 20, 21, 24]);
    const share = (ethic: number, actor: number, target: number) => {
      const copy = fresh();
      copy.countries[actor]!.ethic = ethic;
      const rng = new Rng(9);
      let n = 0;
      for (let k = 0; k < 2000; k++) if (hostile.has(chooseAction(copy, rules, rng, actor, target) ?? -1)) n++;
      return n / 2000;
    };
    expect(share(6, key("UK"), key("FR"))).toBeLessThan(share(1, key("KN"), key("KS")));
    // un paese etico verso un amico non sceglie quasi mai azioni ostili
    expect(share(6, key("UK"), key("FR"))).toBeLessThan(0.05);
  });

  it("le correzioni dopo la scelta", () => {
    const uk = key("UK");
    const fr = key("FR");
    const slot = w.donors.indexOf(uk);
    if (slot >= 0) {
      w.countries[fr]!.tradeLevel[slot] = 3;
      expect(tradeStep(w, uk, fr, true)).toBe(10);           // da regolato a limitato
      expect(tradeStep(w, uk, fr, false)).toBe(8);           // da regolato a nazione più favorita
    }
    expect(tradeStep(w, w.countries.findIndex((c, i) => c.econPower > 0 && !w.donors.includes(i)), fr, true)).toBeUndefined();
    expect(adjustAction(w, uk, fr, 5)).toBe(5);              // "legami economici" resta com'è
    const small = w.countries.findIndex((c, i) => c.econPower > 0 && c.nucLevel < 4 && !w.donors.includes(i));
    expect(adjustAction(w, small, fr, 24)).toBe(16);
    expect(adjustAction(w, small, us, 20)).toBe(12);          // contro un paese più forte
  });

  it("in un anno l'IA agisce e le notizie hanno chi agisce e il bersaglio", () => {
    const sim = new Simulation({ world: fresh(), rules, seed: 4, start: new Date(Date.UTC(2026, 0, 1)), player: us });
    sim.advanceDays(365);
    const ai = sim.reports.filter((r) => r.key === "aiActionSucceeded" || r.key === "aiActionFailed");
    expect(ai.length).toBeGreaterThan(10);
    for (const r of ai) {
      expect(r.actor).toBeDefined();
      expect(r.country).not.toBe(us);
      expect(r.action).toBeGreaterThanOrEqual(0);
    }
    const saved = Simulation.load(sim.save(), rules);
    expect(saved.queue).toEqual(sim.queue);                   // le azioni in coda si salvano
  });

  it("le democrazie non si attaccano e nessuno attacca gli amici", () => {
    const x = fresh();
    const k = (c: string) => x.countries.findIndex((c2) => c2.key === c);
    x.countries[k("UK")]!.ideology = "A";
    x.countries[k("EI")]!.ideology = "C";
    expect(restrained(x, rules, k("UK"), k("EI"))).toBe(true);
    expect(restrained(x, rules, k("KN"), k("KS"))).toBe(false);
    const off = { ...rules, ai: { ...rules.ai, democraticPeace: [] } };
    x.countries[k("EI")]!.ideology = "B";
    expect(restrained(x, off, k("UK"), k("EI"))).toBe(false);
    // con l'IA libera di scegliere, mai attacchi chirurgici o invasioni fra democrazie
    for (let s = 0; s < 200; s++) {
      for (const p of planAiTurn(w, rules, new Rng(s), us)) {
        if (p.code !== 20 && p.code !== 21) continue;
        const dem = rules.ai.democraticPeace;
        expect(dem.includes(w.countries[p.actor]!.ideology) && dem.includes(w.countries[p.target]!.ideology)).toBe(false);
      }
    }
  });

  const invade = (setup: (x: ReturnType<typeof fresh>) => [number, number]) => {
    const x = fresh();
    const [a, t] = setup(x);
    const sim = new Simulation({ world: x, rules, seed: 2, start: new Date(Date.UTC(2026, 0, 1)), player: us });
    sim.queue.push({ kind: "action", actor: a, target: t, code: 21, day: sim.day + 1, hour: 0 });
    sim.advanceDay();
    return sim.reports.map((r) => r.key);
  };

  it("deterrenza: nessuno invade una potenza nucleare", () => {
    expect(invade((x) => [x.countries.findIndex((c) => c.key === "CH"), x.countries.findIndex((c) => c.key === "IN")])).toContain("militaryExercises");
  });

  it("oltre confine l'IA prima schiera le truppe, poi ritenta l'invasione dopo 14 giorni", () => {
    // la Cina non confina con il Brasile e non vi ha truppe
    const x = fresh();
    const [ch, br] = [x.countries.findIndex((c) => c.key === "CH"), x.countries.findIndex((c) => c.key === "BR")];
    const sim = new Simulation({ world: x, rules, seed: 2, start: new Date(Date.UTC(2026, 0, 1)), player: us });
    sim.queue.push({ kind: "action", actor: ch, target: br, code: 21, day: sim.day + 1, hour: 0 });
    sim.advanceDay();
    expect(sim.reports.map((r) => r.key)).not.toContain("warStarted");
    const queued = sim.queue.filter((e) => e.kind === "action" && e.actor === ch && e.target === br);
    expect(queued.map((e) => (e.kind === "action" ? e.code : -1)).sort()).toEqual([21, 25]);
    const retry = queued.find((e) => e.kind === "action" && e.code === 21)!;
    expect(retry.day - sim.day).toBe(14);
  });

  it("una guerra fra vicini parte ancora", () => {
    const keys = invade((x) => {
      const a = x.countries.findIndex((c) => c.key === "KS");
      const t = x.countries.findIndex((c) => c.key === "KN");
      x.countries[t]!.nucLevel = 0;                        // senza arsenale credibile
      return [a, t];
    });
    expect(keys).toContain("warStarted");
  });
});
