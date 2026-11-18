import type { Rng } from "../rng.js";
import type { Country, WorldState } from "../types.js";
import type { War } from "../types.js";

/**
 * Attacco nucleare e conseguenze (originale: ramo 24 di FUN_d1a4_0000, overlay 40; eventi di
 * tipo 5 FUN_8a38_17a2 / 4c6a / 39b5, overlay 21). Formule in re/FORMATS.md.
 *
 * L'attacco lancia n testate (il turno IA 0, l'escalation in guerra l'ambizione, la contromossa
 * l'ambizione al cubo, il giocatore quante ne sceglie): l'effetto diretto è immediato, le tre
 * conseguenze arrivano in coda (`nuclearConsequences`): la ricaduta sulla regione dopo 4–18 ore,
 * le reazioni dei donatori dopo un'ora, gli effetti mondiali dopo 7–14 giorni e solo con più di
 * 8 testate (rand(1,20) < n). Per colpire servono livello nucleare ≥ 1 e almeno una testata.
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

/**
 * Effetto diretto dell'attacco (ramo 24 dell'esecutore, d1a4:5900–94e3): pace 1 per il mondo e
 * per i due paesi, malcontento e ansie al massimo; il bersaglio perde min(1,5 M·n + 3% della
 * popolazione, 95%) abitanti e min(60.000·n, 90% dell'esercito) soldati. Le testate: chi lancia
 * ne spende n, il bersaglio ne perde n, e se n ≥ 3·livello (livello 1–4) scende di un livello,
 * poi di un altro se è ≤ 3.
 */
function strikeEffects(w: WorldState, a: number, t: number, n: number): void {
  const A = w.countries[a]!;
  const T = w.countries[t]!;
  A.warheads = Math.max(0, A.warheads - n);
  T.warheads = Math.max(0, T.warheads - n);
  if (n >= 3 * T.nucLevel && T.nucLevel >= 1 && T.nucLevel <= 4) T.nucLevel -= 1;
  if (T.nucLevel <= 3) T.nucLevel = Math.max(0, T.nucLevel - 1);
  T.population -= Math.min(1.5e6 * n + 0.03 * T.population, 0.95 * T.population);
  T.troops -= Math.min(60000 * n, 0.9 * T.troops);
  w.worldPeace = 1;
  for (const c of [A, T]) {
    c.peace = 1;
    c.outcry = 100;
    c.anxiety.military = 100;
    c.anxiety.nuclear = 100;
  }
  recomputeDerived(T);
}

/** Fase 0: ricaduta sui paesi della regione del bersaglio (FUN_8a38_17a2). */
export function regionalFallout(w: WorldState, t: number): number[] {
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
export function globalEffects(w: WorldState): void {
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

/** Una conseguenza in coda: 0 ricaduta regionale, 1 reazioni dei donatori, 2 effetti mondiali. */
export interface Consequence { phase: 0 | 1 | 2; hours: number }

export interface StrikeOutcome {
  /** Testate lanciate davvero. */
  warheads: number;
  /** Conseguenze da mettere in coda, con il ritardo in ore. */
  consequences: Consequence[];
  /** Ritorsioni del bersaglio: [codice, ritardo in giorni]. */
  retaliation: [number, number][];
}

/** `a` colpisce `t` con `n` testate (al più quelle che ha; 0 nel turno IA dell'originale). */
export function nuclearStrike(w: WorldState, rng: Rng, a: number, t: number, n = 0): StrikeOutcome {
  const warheads = Math.max(0, Math.min(Math.trunc(n), w.countries[a]!.warheads));
  strikeEffects(w, a, t, warheads);
  const consequences: Consequence[] = [{ phase: 0, hours: rng.int(4, 18) }, { phase: 1, hours: 1 }];
  if (warheads > 8 && rng.int(1, 20) < warheads) consequences.push({ phase: 2, hours: rng.int(1, 23) + 24 * rng.int(7, 14) });
  // ritorsioni del bersaglio: condanna, sabotaggio, assassinio, a date casuali (◇ entro un mese)
  const retaliation: [number, number][] = [6, 14, 16].map((code) => [code, rng.int(1, 30)]);
  return { warheads, consequences, retaliation };
}

/** Azione in coda nata da una conseguenza: chi agisce, contro chi, codice, ritardo in ore, testate. */
export interface QueuedResponse { actor: number; target: number; code: number; hours: number; warheads?: number }

/**
 * Fase 1 (FUN_8a38_4c6a): i donatori, esclusi il giocatore e i due paesi, reagiscono contro chi
 * ha colpito con probabilità 15·influenza %. I compagni di squadra del bersaglio con un arsenale
 * grande (livello ≥ 5) rispondono con l'atomica se rand(1,5) < ambizione; gli altri compagni di
 * squadra con una condanna o un inviato di pace se etici, un assassinio o un colpo di stato se
 * no (◇ la soglia d'etica), e poi con un'azione tirata contro etica, ambizione e pace mondiale;
 * i donatori di altre squadre con condanna, colpo di stato, spionaggio, inviato o embargo.
 */
export function donorReactions(w: WorldState, rng: Rng, a: number, t: number, player: number): QueuedResponse[] {
  const out: QueuedResponse[] = [];
  const T = w.countries[t]!;
  const pm = w.worldPeace;
  for (const c of w.donors) {
    if (c === player || c === a || c === t || !w.countries[c]!.econPower) continue;
    const C = w.countries[c]!;
    if (rng.int(1, 100) > 15 * C.influence) continue;
    if (C.team === T.team) {
      if (C.nucLevel >= 5 && C.warheads > 0 && rng.int(1, 5) < C.ambition) {
        out.push({ actor: c, target: a, code: 24, hours: 1, warheads: Math.max(1, Math.trunc(0.66 * C.warheads)) });
        continue;
      }
      out.push({ actor: c, target: a, code: C.ethic >= 3.5 ? (rng.int(0, 1) ? 6 : 2) : (rng.int(0, 1) ? 16 : 15), hours: rng.int(2, 8) });
      const r = rng.int(1, Math.max(1, Math.trunc(C.ethic * (7 - C.ambition) + pm + pm ** 3 + 3 * C.ethic)));
      const code = r < 15 ? 16 : r < 40 ? 15 : r < 60 ? 12 : r < 70 ? 2 : r < 80 ? 6 : 11;
      out.push({ actor: c, target: a, code, hours: rng.int(2, 8) });
    } else {
      const r = rng.int(1, 100);
      const code = r < 20 ? 6 : r < 40 ? 15 : r < 60 ? 13 : r < 90 ? 2 : 11;
      out.push({ actor: c, target: a, code, hours: rng.int(2, 8) });
    }
  }
  return out;
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
