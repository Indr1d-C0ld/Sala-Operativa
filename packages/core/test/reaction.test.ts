import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classicRules as rules, generationRules } from "@melchior/data";
import { REACTIONS, resolveReaction, Rng, Simulation, worldFromPack, type ScenarioPack } from "../src/index.js";

const PACK = resolve(import.meta.dirname, "../../app/public/scenarios/2026.json");

describe.skipIf(!existsSync(PACK))("reazione del giocatore", () => {
  const fresh = () => worldFromPack(JSON.parse(readFileSync(PACK, "utf8")) as ScenarioPack, rules, generationRules, 2026);
  const idx = (w: ReturnType<typeof fresh>, k: string) => w.countries.findIndex((c) => c.key === k);

  it("nessuna reazione non tocca nulla", () => {
    const w = fresh();
    const before = JSON.stringify(w);
    const out = resolveReaction(w, rules, new Rng(1), idx(w, "US"), idx(w, "IR"), "none");
    expect(out.prevented).toBe(false);
    expect(JSON.stringify(w)).toEqual(before);
  });

  it("le sanzioni contro un membro permanente finiscono sotto veto", () => {
    const w = fresh();
    const us = idx(w, "US");
    const ler = w.countries[us]!.ler;
    const out = resolveReaction(w, rules, new Rng(1), us, idx(w, "CH"), "sanctions");
    expect(out.vetoed).toBe(true);
    expect(out.prevented).toBe(false);
    expect(w.countries[us]!.ler).toBeLessThan(ler);
  });

  it("ogni reazione dà una soglia finita e lascia i valori nei limiti", () => {
    for (const r of REACTIONS.slice(1)) {
      const w = fresh();
      const us = idx(w, "US");
      const ir = idx(w, "IR");
      const out = resolveReaction(w, rules, new Rng(5), us, ir, r);
      if (out.threshold !== null) expect(Number.isFinite(out.threshold), r).toBe(true);
      expect(w.worldPeace).toBeGreaterThanOrEqual(1);
      expect(w.worldPeace).toBeLessThanOrEqual(6);
      for (const c of [w.countries[us]!, w.countries[ir]!]) {
        expect(c.peace).toBeGreaterThanOrEqual(1);
        expect(c.ler).toBeLessThanOrEqual(1);
      }
    }
  });

  it("in una partita interattiva il tempo si ferma finché il giocatore non sceglie", () => {
    const w = fresh();
    const sim = new Simulation({ world: w, rules, seed: 2, start: new Date(Date.UTC(2026, 0, 1)), player: idx(w, "US"), interactive: true });
    const seen = new Set<string>();
    for (let guard = 0; guard < 200 && seen.size < 2; guard++) {
      sim.advanceDays(3 * 365);
      const p = sim.pending;
      if (!p) break;
      seen.add(p.kind);
      const day = sim.day;
      sim.advanceDays(10);
      expect(sim.day).toBe(day);                                        // fermo
      const copy = Simulation.load(sim.save(), rules);
      expect(copy.pending).toEqual(p);                                  // la scelta in attesa si salva
      if (p.kind === "reaction") {
        const from = sim.reports.length;
        const out = sim.react("protest");
        expect(out).not.toBeNull();
        const keys = sim.reports.slice(from).map((r) => r.key);
        expect(keys.some((k) => k === "reactionPrevented" || k === "reactionFailed")).toBe(true);
      } else if (p.kind === "decision") {
        expect(p.code).toBeGreaterThanOrEqual(0);
        sim.decide(true);
        expect(sim.reports.some((r) => r.key === "proposalAccepted")).toBe(true);
      } else {
        sim.decideSurrender(false);                                       // si combatte ancora
        expect(sim.reports.some((r) => r.key === "mobilization")).toBe(true);
      }
      expect(sim.pending === null || sim.pending !== p).toBe(true);
    }
    expect(seen.has("reaction") || seen.has("decision")).toBe(true);
  });

  it("senza modalità interattiva non si ferma mai", () => {
    const w = fresh();
    const sim = new Simulation({ world: w, rules, seed: 2, start: new Date(Date.UTC(2026, 0, 1)), player: idx(w, "US") });
    sim.advanceDays(400);
    expect(sim.pending).toBeNull();
    expect(sim.reports.filter((r) => r.key === "endOfYear")).toHaveLength(1);
  });
});
