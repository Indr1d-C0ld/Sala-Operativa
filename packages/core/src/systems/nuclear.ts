import type { Rng } from "../rng.js";
import type { Country, WorldState } from "../types.js";
import type { War } from "../types.js";

/**
 * Attacco nucleare e conseguenze (originale: ramo 24 di FUN_d1a4_0000, overlay 40; eventi di
 * tipo 5 FUN_8a38_17a2 / 4c6a / 39b5, overlay 21). Formule in re/FORMATS.md.
 *
 * Scelte nostre (◇):
 *  - le tre fasi valgono per ogni attacco, non solo per quelli del giocatore, e si applicano
 *    subito invece che come eventi in sequenza;
 *  - la fase 1 (spostamento delle alleanze) è lasciata alla ricomposizione annuale delle squadre;
 *  - per colpire servono livello nucleare ≥ 1 e almeno una testata; ogni attacco ne consuma una.
 */

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

export function hasNukes(c: Country): boolean {
  return c.nucLevel >= 1 && c.warheads >= 1;
}

/** Arsenale credibile per la deterrenza (◇): livello nucleare ≥ 4 e testate. */
export function deterrent(c: Country): boolean {
  return c.nucLevel >= 4 && hasNukes(c);
}

/** Regione "di casa" di un paese (l'ultima in cui è membro a pieno titolo), o -1. */
function homeRegion(w: WorldState, i: number): number {
  let home = -1;
  w.regions.forEach((r, k) => { if (r.members.some((m) => m.core && m.country === i)) home = k; });
  return home;
}

function recomputeDerived(c: Country): void {
  c.pcGnp = c.population > 0 ? (c.econPower * 1e5) / c.population : 0;
  c.peace = clamp(c.peace, 1, 6);
  c.ethic = clamp(c.ethic, 1, 6);
  c.ambition = clamp(c.ambition, 1, 6);
  c.outcry = clamp(c.outcry, 0, 100);
  for (const k of Object.keys(c.anxiety) as (keyof Country["anxiety"])[]) c.anxiety[k] = clamp(c.anxiety[k], 0, 100);
}

/** Effetto diretto dell'attacco (ramo 24 dell'esecutore): pace mondiale 1, malcontento e ansie al massimo. */
function strikeEffects(w: WorldState, a: number, t: number): void {
  w.worldPeace = 1;
  for (const i of [a, t]) {
    const c = w.countries[i]!;
    c.outcry = 100;
    c.anxiety.military = 100;
    c.anxiety.nuclear = 100;
  }
}

/** Fase 0: ricaduta sui paesi della regione del bersaglio (FUN_8a38_17a2). */
function regionalFallout(w: WorldState, t: number): number[] {
  const k = homeRegion(w, t);
  const hit = k >= 0 ? w.regions[k]!.members.filter((m) => m.core).map((m) => m.country) : [t];
  if (!hit.includes(t)) hit.push(t);
  for (const i of hit) {
    const c = w.countries[i]!;
    c.milPower *= 0.8; c.milSpend *= 0.8; c.milCapital *= 0.8;
    c.econPower *= 0.75;
    c.peace *= 0.5;
    c.population *= 0.95;
    c.gdpGrowth *= 0.8;
    c.ambition *= 1.3;
    c.ethic *= 0.8;
    c.repression *= 1.3;
    c.outcry *= 1.3;
    recomputeDerived(c);
  }
  return hit;
}

/** Fase 2: effetti su tutti i paesi (FUN_8a38_39b5). */
function globalEffects(w: WorldState): void {
  for (const c of w.countries) {
    if (!c.econPower) continue;
    c.milPower *= 0.9; c.milSpend *= 0.9;
    c.econPower *= 0.85;
    c.peace *= 0.5;
    c.population *= 0.95;
    c.gdpGrowth *= 0.9;
    c.ambition *= 1.1;
    c.ethic *= 0.9;
    c.repression *= 1.2;
    c.outcry *= 1.1;
    for (const k of Object.keys(c.hunger) as (keyof Country["hunger"])[]) c.hunger[k] *= 1.15;
    c.anxiety.political *= 1.3;
    c.anxiety.economic *= 1.3;
    c.anxiety.social *= 1.3;
    recomputeDerived(c);
  }
  const t = w.totals;
  t.econPower = w.countries.reduce((s, c) => s + c.econPower, 0);
  t.population = w.countries.reduce((s, c) => s + c.population, 0);
  t.milPower = w.countries.reduce((s, c) => s + c.milPower, 0);
  w.worldPeace = clamp(w.worldPeace, 1, 6);
}

export interface StrikeOutcome {
  /** Paesi colpiti dalla ricaduta regionale. */
  fallout: number[];
  /** Ritorsioni del bersaglio: [codice, ritardo in giorni]. */
  retaliation: [number, number][];
}

/** `a` colpisce `t` con un'arma nucleare. */
export function nuclearStrike(w: WorldState, rng: Rng, a: number, t: number): StrikeOutcome {
  w.countries[a]!.warheads = Math.max(0, w.countries[a]!.warheads - 1);
  strikeEffects(w, a, t);
  const fallout = regionalFallout(w, t);
  globalEffects(w);
  // ritorsioni del bersaglio: condanna, sabotaggio, assassinio, a date casuali (◇ entro un mese)
  const retaliation: [number, number][] = [6, 14, 16].map((code) => [code, rng.int(1, 30)]);
  return { fallout, retaliation };
}

/**
 * Escalation in guerra (FUN_5825_0000): un partecipante con livello nucleare ≥ 4 il cui lato
 * ha forza < 50% colpisce il nemico se rand(1,6) < ambizione e rand(1,6) > pace.
 */
export function warEscalation(w: WorldState, rng: Rng, war: War): { actor: number; target: number } | undefined {
  for (const side of [0, 1] as const) {
    const s = war.sides[side];
    if (s.strength >= 50) continue;
    const enemy = side === 0 ? war.theater : war.sides[0].countries[0]!;
    for (const i of s.countries) {
      const c = w.countries[i]!;
      if (c.nucLevel < 4 || !hasNukes(c)) continue;
      if (rng.int(1, 6) < c.ambition && rng.int(1, 6) > c.peace) return { actor: i, target: enemy };
    }
  }
  return undefined;
}
