import type { Rng } from "../rng.js";
import type { Rules } from "../rules.js";
import type { WorldState } from "../types.js";
import { relationLevel } from "./relation.js";

/**
 * Disastri (originale: FUN_9aba_0000, overlay 27, testi DISASTRL.FIL; si possono disattivare
 * dal menu della simulazione). Formule in re/FORMATS.md.
 *
 * Dall'originale:
 *  - tipo con un tiro contro le soglie cumulative 10/30/50/75/100: carestia, terremoto, alluvione,
 *    incidente aereo, esplosione chimica; gravità s = rand(1,100)/100;
 *  - per i due disastri provocati dall'uomo cerca un paese "canaglia" (ambizione ≥ 5, etica ≤ 1):
 *    colpisce gli Stati Uniti se rand(1,100) < 50 e la relazione è sotto 3, altrimenti un paese
 *    che la canaglia odia; la CIA scopre il responsabile. Senza canaglie il paese è a caso;
 *  - vittime: popolazione × tabella × s (almeno 2; aereo: fino a 250), danni: PIL × tabella × s,
 *    la crescita del PIL cala in proporzione; magnitudo del terremoto 6 + 2·s.
 *
 * Scelte nostre (◇): la frequenza (rules.disasters.dailyChance); i danni tolti subito al PIL
 * (l'originale li accumula nel campo dei danni); il malcontento sale di 10·s.
 */
export const DISASTER_TYPES = ["famine", "earthquake", "flood", "planeCrash", "chemical"] as const;
export type DisasterType = (typeof DISASTER_TYPES)[number];

export interface Disaster {
  type: DisasterType;
  country: number;
  severity: number;
  casualties: number;
  /** Danni in dollari. */
  damage: number;
  /** Magnitudo, per i terremoti. */
  magnitude?: number;
  /** Paese responsabile (disastri provocati dall'uomo, scoperto dalla CIA). */
  culprit?: number;
  /** Parte del paese colpita: 0 nord, 1 sud, 2 est, 3 ovest. */
  direction: number;
}

const active = (w: WorldState, i: number) => (w.countries[i]?.econPower ?? 0) > 0;

/** Sceglie e applica un disastro. */
export function strikeDisaster(w: WorldState, rules: Rules, rng: Rng, player: number, day: number): Disaster | null {
  const r = rules.disasters;
  const roll = rng.int(1, 100);
  const k = Math.max(0, r.cumulative.findIndex((x) => x >= roll));
  const type = DISASTER_TYPES[k]!;
  const s = rng.int(1, 100) / 100;
  const all = w.countries.map((_, i) => i).filter((i) => active(w, i));
  if (!all.length) return null;
  let country = -1;
  let culprit: number | undefined;
  if (k >= 3) {
    const rogues = all.filter((i) => w.countries[i]!.ambition >= r.rogueAmbition && w.countries[i]!.ethic <= r.rogueEthic && i !== player);
    if (rogues.length) {
      const p = rogues[rng.int(0, rogues.length - 1)]!;
      if (player >= 0 && rng.int(1, 100) < 50 && relationLevel(w, rules, player, p, 0) < 3) country = player;
      for (let tries = 0; tries < 25 && country < 0; tries++) {
        const x = all[rng.int(0, all.length - 1)]!;
        if (x !== p && relationLevel(w, rules, p, x, 0) < 3) country = x;
      }
      if (country >= 0) culprit = p;
    }
  }
  if (country < 0) country = all[rng.int(0, all.length - 1)]!;
  const c = w.countries[country]!;
  let casualties = Math.round(c.population * r.casualties[k]! * s);
  if (type === "planeCrash") casualties = rng.int(1, 250);
  if (type === "chemical") casualties = Math.round(rng.int(2, 250) * (0.5 + s));
  casualties = Math.max(2, casualties);
  const damage = c.econPower * 1e5 * r.damage[k]! * s;
  c.population = Math.max(0, c.population - casualties);
  c.econPower = Math.max(0, c.econPower - damage / 1e5);
  c.gdpGrowth -= Math.abs(c.gdpGrowth) * r.growth[k]! * s;
  c.outcry = Math.min(100, c.outcry + 10 * s);
  const d: Disaster = { type, country, severity: s, casualties, damage, direction: rng.int(0, 3) };
  if (type === "earthquake") d.magnitude = Math.round((6 + 2 * s) * 10) / 10;
  if (culprit !== undefined) d.culprit = culprit;
  w.disasters.push({ country, day, type: k });
  return d;
}

/** Il paese è stato colpito da un disastro negli ultimi `days` giorni? (per gli aiuti d'emergenza) */
export function recentlyHit(w: WorldState, i: number, today: number, days = 60): boolean {
  return w.disasters.some((d) => d.country === i && today - d.day <= days);
}
