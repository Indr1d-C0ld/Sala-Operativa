import { Rng } from "../rng.js";
import type { Rules } from "../rules.js";
import type { Country } from "../types.js";

/**
 * Deriva procedurale: perturba un mondo appena generato dal Factbook per ottenere storie
 * alternative, da "storico" (0) a "molto alternativo" (1). Tutto dipende dal seme, con un flusso
 * casuale separato da quello della generazione: con deriva 0 il mondo resta identico.
 *
 * Cosa cambia, in proporzione alla deriva d:
 *  - economia, popolazione, truppe e spesa militare: fattori log-normali (σ 0,35·d, 0,1·d, 0,3·d);
 *  - crescita del PIL ± 2·d punti; LER intorno a 0,5;
 *  - etica, ambizione e pace: spostamenti fino a ±1–2 livelli;
 *  - cambi di regime (probabilità 0,15·d per paese) con una nuova ideologia ammessa;
 *  - proliferazione nucleare (probabilità 0,04·d per i paesi ricchi senza atomica).
 * I paesi in `protect` (il giocatore) conservano ideologia e arsenale.
 */
export interface DriftOptions {
  level: number;
  protect?: string[];
  /** Quota musulmana per paese (per le ideologie islamiche), se nota. */
  muslimShare?: (i: number) => number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

/** Normale standard approssimata (somma di uniformi). */
function gauss(rng: Rng): number {
  return (rng.next() + rng.next() + rng.next() + rng.next() - 2) * Math.sqrt(3);
}

export function driftSeed(seed: number): number {
  return (seed ^ 0x9e3779b9) >>> 0;
}

export function applyDrift(countries: Country[], rules: Rules, seed: number, o: DriftOptions): number {
  const d = clamp(o.level, 0, 1);
  if (d === 0) return 0;
  const rng = new Rng(driftSeed(seed));
  const protect = new Set(o.protect ?? []);
  const letters = rules.ideologies.map((x) => x.letter).filter((l) => l !== "D");
  const reserved = rules.social.reservedIdeologies;
  let regimes = 0;
  countries.forEach((c, i) => {
    if (!c.econPower) return;
    const f = (sigma: number) => Math.exp(gauss(rng) * sigma * d);
    const econ = f(0.35);
    c.econPower *= econ;
    c.population = Math.round(c.population * f(0.1));
    c.pcGnp = c.population ? (c.econPower * 1e5) / c.population : c.pcGnp;
    c.gdpGrowth += gauss(rng) * 0.02 * d;
    const army = f(0.3);
    c.troops *= army;
    c.milSpend *= econ * army;
    // la quota di PIL alla difesa cambia del fattore `army`: la belligeranza la segue, altrimenti
    // a fine anno la spesa tornerebbe alla proporzione storica
    c.belligerence = c.belligerence.map((b) => b * army) as Country["belligerence"];
    c.belligerenceAvg *= army;
    c.ethic = clamp(Math.round(c.ethic + gauss(rng) * 1.2 * d), 1, 6);
    c.ambition = clamp(Math.round(c.ambition + gauss(rng) * 1.2 * d), 1, 6);
    c.peace = clamp(c.peace + gauss(rng) * d, 1, 6);
    c.ler = clamp(0.5 + gauss(rng) * 0.15 * d, 0.1, 0.9);
    if (protect.has(c.key)) return;
    if (rng.next() < 0.15 * d) {
      const islamic = (o.muslimShare?.(i) ?? 0) >= 0.5;
      const options = letters.filter((l) => l !== c.ideology
        && (!reserved[l] || reserved[l]!.includes(c.key))
        && (islamic || !rules.social.islamicIdeologies.includes(l)));
      if (options.length) {
        c.ideology = options[rng.int(0, options.length - 1)]!;
        const [lo, hi] = rules.social.ethicRange[c.ideology] ?? [1, 6];
        c.ethic = rng.int(lo, hi);
        regimes++;
      }
    }
    if (!c.nucLevel && c.pcGnp > 8000 && rng.next() < 0.04 * d) {
      c.nucLevel = rng.int(2, 4);
      c.warheads = rng.int(5, 120);
    }
  });
  return regimes;
}
