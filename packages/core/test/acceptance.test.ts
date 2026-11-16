/**
 * Test di accettazione: i sistemi del nucleo riproducono i valori salvati negli scenari del
 * gioco originale (stessi risultati delle verifiche in tools/verify_formulas.py e
 * tools/sp_anxiety.py). Si saltano se i file originali non sono presenti.
 */
import { describe, expect, it } from "vitest";
import { classicRules as rules } from "@melchior/data";
import {
  computeAnxieties,
  computeBelligerence,
  computeBudgets,
  computeInfluence,
  computeOrientation,
  computeOutcry,
  computeRegions,
  computeTeamLeaders,
  computeTrade,
  computeWorldCoalition,
  rankIdeologies,
  relationLevel,
} from "../src/index.js";
import { countMatches, hasOriginal, loadOriginal, SCENARIOS } from "./original.js";

const active = (w: ReturnType<typeof loadOriginal>["world"]) =>
  w.countries.map((c, i) => (c.econPower > 0 ? i : -1)).filter((i) => i >= 0);

describe.skipIf(!hasOriginal).each(SCENARIOS)("scenario %s", (sfx) => {
  it("influenza totale (pesi per pace mondiale)", () => {
    const { world, saved } = loadOriginal(sfx);
    computeInfluence(world, rules);
    const ids = active(world);
    expect(countMatches(ids.map((i) => [world.countries[i]!.influence, saved.influence[i]!]))).toBe(ids.length);
  });

  it("orientamento di politica estera", () => {
    const { world, saved } = loadOriginal(sfx);
    rankIdeologies(world, rules);
    computeOrientation(world, rules);
    const ids = world.countries.map((c, i) => (c.ideology ? i : -1)).filter((i) => i >= 0);
    expect(countMatches(ids.map((i) => [world.countries[i]!.orientation, saved.orientation[i]!]), 0)).toBe(ids.length);
  });

  it("coalizione mondiale minima vincente", () => {
    const { world, saved } = loadOriginal(sfx);
    computeWorldCoalition(world, rules);
    expect([...world.coalition].sort((a, b) => a - b)).toEqual([...saved.coalition].sort((a, b) => a - b));
  });

  it("leader dei World Team", () => {
    const { world, saved } = loadOriginal(sfx);
    computeTeamLeaders(world, rules);
    expect([...world.teamLeaders].sort((a, b) => a - b)).toEqual([...saved.teamLeaders].sort((a, b) => a - b));
  });

  it("belligeranza (scenari ritoccati a mano: almeno metà esatta)", () => {
    const { world, saved } = loadOriginal(sfx);
    for (const c of world.countries) c.belligerence = [c.belligerence[1], c.belligerence[2], 0];
    computeBelligerence(world, rules);
    const ids = active(world);
    const ok = countMatches(ids.map((i) => [world.countries[i]!.belligerence[0], saved.belligerence[i]![0]!]), 1e-5);
    expect(ok).toBeGreaterThan(ids.length / 2);
  });

  it("quote e influenza regionali", () => {
    const { world, saved } = loadOriginal(sfx, "pre-aid");
    computeRegions(world, rules);
    const ids = active(world);
    const c = world.countries;
    expect(countMatches(ids.map((i) => [c[i]!.regMilShare, saved.regMilShare[i]!]))).toBe(ids.length);
    expect(countMatches(ids.map((i) => [c[i]!.regEconShare, saved.regEconShare[i]!]))).toBe(ids.length);
    expect(countMatches(ids.map((i) => [c[i]!.regInfluence, saved.regInfluence[i]!]))).toBe(ids.length);
  });

  it("le cinque ansie", () => {
    const { world, saved } = loadOriginal(sfx);
    rankIdeologies(world, rules);
    computeAnxieties(world, rules);
    const ids = active(world);
    for (const [k, key] of (["nuclear", "military", "political", "economic", "social"] as const).entries()) {
      const pairs = ids.map((i): [number, number] => [world.countries[i]!.anxiety[key], saved.anxiety[i]![k]!]);
      expect(countMatches(pairs, 1e-4), key).toBe(ids.length);
    }
  });

  it("bisogni d'aiuto (l'intelligence in Oceania usa un massimo regionale più vecchio)", () => {
    const { world, saved } = loadOriginal(sfx);
    rankIdeologies(world, rules);
    computeAnxieties(world, rules);
    const ids = active(world);
    const minimum = { humanitarian: ids.length, economic: ids.length - 19, intelligence: ids.length - 11, military: ids.length, nuclear: ids.length - 2 };
    for (const [k, key] of (["humanitarian", "economic", "intelligence", "military", "nuclear"] as const).entries()) {
      const pairs = ids.map((i): [number, number] => [world.countries[i]!.hunger[key], saved.hunger[i]![k]!]);
      expect(countMatches(pairs, 1e-6), key).toBeGreaterThanOrEqual(minimum[key]);
    }
  });

  it("repressione e malcontento sociale", () => {
    const { world, saved } = loadOriginal(sfx);
    computeOutcry(world);
    const ids = active(world);
    expect(countMatches(ids.map((i) => [world.countries[i]!.repression, saved.repression[i]!]))).toBe(ids.length);
    expect(countMatches(ids.map((i) => [world.countries[i]!.outcry, saved.outcry[i]!]))).toBe(ids.length);
  });

  it("stato commerciale verso i donatori", () => {
    const { world, saved } = loadOriginal(sfx);
    computeTrade(world);
    world.countries.forEach((c, i) => expect(c.tradeLevel).toEqual(saved.trade[i]));
  });

  it("bilanci dell'intelligence: parti e soglia di attività", () => {
    const { world, saved } = loadOriginal(sfx, "pre-aid");
    const usa = world.countries.findIndex((c) => c.key === "United States");
    const savedB = world.countries.map((c) => c.budget.intel);
    // le quote dipendono dalla pace corrente, il totale da una pace ritoccata: si confrontano i rapporti
    computeBudgets(world, (i) => i === usa);
    const ids = active(world).filter((i) => i !== usa && savedB[i]);
    const ratio = (x: number, i: number) => x / world.countries[i]!.budget.intel;
    const sr = (x: number, i: number) => x / savedB[i]!;
    expect(countMatches(ids.map((i) => [ratio(world.countries[i]!.budget.covertAction, i), sr(saved.budgets[i]!.covertAction, i)]))).toBe(ids.length);
    expect(countMatches(ids.map((i) => [ratio(world.countries[i]!.budget.insurgency, i), sr(saved.budgets[i]!.insurgency, i)]))).toBe(ids.length);
    expect(countMatches(ids.map((i) => [ratio(world.countries[i]!.budget.espSelf, i), sr(saved.budgets[i]!.espSelf, i)]))).toBe(ids.length);
  });
});

describe.skipIf(!hasOriginal)("livello di relazione (scenario 1990)", () => {
  it("riproduce le relazioni note degli Stati Uniti", () => {
    const { world } = loadOriginal("0");
    const idx = (k: string) => world.countries.findIndex((c) => c.key === k);
    const rel = (a: string, b: string) => relationLevel(world, rules, idx(a), idx(b), 0);
    expect(rel("United States", "Israel")).toBe(7);
    expect(rel("United States", "Japan")).toBe(6);
    expect(rel("United States", "Iraq")).toBe(2);
    expect(rel("United States", "Cuba")).toBe(1);
    expect(rel("United States", "Soviet Union")).toBe(1);
    expect(rel("Soviet Union", "Cuba")).toBe(7);
    expect(rel("India", "Pakistan")).toBe(2);
  });
});
