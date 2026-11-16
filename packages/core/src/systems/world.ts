import type { Rules } from "../rules.js";
import type { WorldState } from "../types.js";

/** Livello intero 1–6 usato per indicizzare le tabelle per livello di pace: int(x + 0,5) limitato. */
export function peaceIndex(peace: number): number {
  return Math.min(Math.max(Math.trunc(peace + 0.5), 1), 6);
}

export const isActive = (w: WorldState, i: number): boolean => (w.countries[i]?.econPower ?? 0) > 0;

/**
 * Quote mondiali (militare, economica, nucleare) e totali mondiali.
 * Originale: FUN_ab78_0ced, passo 2 del ciclo di fine anno.
 */
export function computeWorldShares(w: WorldState): void {
  const sum = (f: (i: number) => number) => w.countries.reduce((s, _, i) => s + f(i), 0);
  const mil = sum((i) => w.countries[i]!.milPower);
  const econ = sum((i) => w.countries[i]!.econPower);
  const nuc = sum((i) => w.countries[i]!.nucPower);
  w.totals = { milPower: mil, econPower: econ, nucPower: nuc, population: sum((i) => w.countries[i]!.population) };
  for (const c of w.countries) {
    c.milShare = mil ? (100 * c.milPower) / mil : 0;
    c.econShare = econ ? (100 * c.econPower) / econ : 0;
    c.nucShare = nuc ? (100 * c.nucPower) / nuc : 0;
  }
}

/**
 * Influenza totale = pM·quota militare + pE·quota economica, con i pesi scelti dal livello di
 * pace mondiale; poi il valore strategico e il nuovo livello di pace mondiale
 * (Σ pace·influenza/100, in [1,6]).
 */
export function computeInfluence(w: WorldState, rules: Rules): void {
  const [wm, we] = rules.influenceWeights[peaceIndex(w.worldPeace)]!;
  let peace = 0;
  for (const c of w.countries) {
    c.influencePrev = c.influence;
    c.influence = wm * c.milShare + we * c.econShare;
    c.stratValue = 5 * c.flag144 + 100 * c.strategicReserves * (1 + c.influence / 10) - 100;
    peace += (c.peace * c.influence) / 100;
  }
  w.worldPeace = Math.min(Math.max(peace, 1), 6);
}

/** Classifica delle ideologie per influenza totale (a parità vale l'ordine delle regole). */
export function rankIdeologies(w: WorldState, rules: Rules): void {
  const total = new Map<string, number>();
  for (const c of w.countries) if (c.ideology) total.set(c.ideology, (total.get(c.ideology) ?? 0) + c.influence);
  w.ideologyRanking = rules.ideologies
    .map((x) => x.letter)
    .sort((a, b) => (total.get(b) ?? 0) - (total.get(a) ?? 0))
    .join("");
}
