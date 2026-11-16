import type { WorldState } from "../types.js";

/**
 * Passo 8, stato commerciale (originale: FUN_b04b_27a9). Verso ciascun donatore:
 * 4 se stessa squadra (anche se nessuno dei due ne ha una), 3 se solo uno ha una squadra,
 * 2 se in squadre diverse. Verificato 2520/2520.
 */
export function computeTrade(w: WorldState): void {
  for (const c of w.countries) {
    c.tradeLevel = w.donors.map((d) => {
      const t = w.countries[d]!.team;
      if (c.team === t) return 4;
      return c.team === 0 || t === 0 ? 3 : 2;
    });
  }
}
