import type { WorldState } from "../types.js";

/** Smorzamento delle crescite alte (originale: FUN_b04b_0a6d): oltre il 5% la crescita decade. */
export function dampGrowth(g: number): number {
  if (g > 0.05) {
    g *= g > 1 ? 0.2 : g > 0.5 ? 0.3 : 0.5;
    g = Math.max(g, 0.05);
  }
  return g;
}

/**
 * Passo 1, crescita. Il PIL cresce al tasso (smorzato e salvato) a partire dalla base senza gli
 * aiuti economici ricevuti; la popolazione allo stesso modo, arrotondata.
 */
export function computeGrowth(w: WorldState): void {
  for (const c of w.countries) {
    if (!c.econPower) continue;
    const aid = c.aidReceived.economic.reduce((s, x) => s + x, 0) * 1e6;
    let base = c.econPower * 1e5 - aid;
    if (base <= 0) base = c.econPower * 1e5;
    c.gdpGrowth = Math.max(dampGrowth(c.gdpGrowth), -0.15);
    c.econPower = Math.max((base * (1 + c.gdpGrowth)) / 1e5, 0);
    c.popGrowth = dampGrowth(c.popGrowth);
    c.population = Math.round(c.population * (1 + c.popGrowth));
  }
}

/**
 * Passo 2, parte militare: spesa dell'IA = PIL·belligeranza media/100 (il giocatore sceglie la
 * propria), qualità = √(10·(spesa/truppe)/media mondiale), potere = max(1, qualità·truppe),
 * potere nucleare in proporzione, PIL pro capite.
 */
export function computeMilitary(w: WorldState, isPlayer: (i: number) => boolean): void {
  const cs = w.countries;
  cs.forEach((c, i) => {
    if (c.econPower && !isPlayer(i)) c.milSpend = (c.econPower * 1e5 * c.belligerenceAvg) / 100;
  });
  const totSpend = cs.reduce((s, c) => s + c.milSpend, 0);
  const totTroops = cs.reduce((s, c) => s + c.troops, 0);
  const avg = totTroops ? totSpend / totTroops : 1;
  for (const c of cs) {
    if (!c.econPower) continue;
    c.milCapital = c.troops ? Math.sqrt((10 * (c.milSpend / c.troops)) / avg) : 0;
    c.milPower = Math.max(1, c.milCapital * c.troops);
    c.nucPower = c.milSpend ? (c.nucSpend / c.milSpend) * c.milPower : 0;
    c.pcGnp = c.population ? (c.econPower * 1e5) / c.population : 0;
  }
}

/** Passo 5, qualità della vita, normalizzata su un valore fisso dello scenario (MISC+0x08). */
export function computeQualityOfLife(w: WorldState): void {
  for (const c of w.countries) {
    if (!c.econPower || !c.ambition || !c.repression || c.ethic >= 7) continue;
    const raw = (3737 / (7 - c.ethic) + 3737 / c.ambition + 3737 / c.repression) / 3 + c.pcGnp;
    c.qol = Math.min(1, raw / w.qolNormalizer);
  }
}

/** Massimi mondiali usati come riferimento dalle ansie e dai bisogni. */
export function computeWorldMaxima(w: WorldState): void {
  const act = w.countries.filter((c) => c.econPower > 0);
  const max = (f: (c: (typeof act)[number]) => number) => Math.max(0, ...act.map(f));
  w.maxima = {
    pcGnp: max((c) => c.pcGnp),
    nucSpend: max((c) => c.nucSpend),
    milSpend: max((c) => c.milSpend),
    intelBudget: max((c) => c.budget.intel),
    gdpGrowth: max((c) => c.gdpGrowth),
  };
}
