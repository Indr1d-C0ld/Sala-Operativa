import type { WorldState } from "../types.js";

/**
 * Passo 11, fondi per lo spionaggio all'estero (originale: FUN_b04b_18d1). Senza squadra il
 * donatore spia tutti in proporzione al valore strategico; in una squadra metà dei fondi va alle
 * squadre rivali e metà a tutti. Il giocatore è escluso: le sue assegnazioni le decide lui.
 * Il valore strategico negativo dei paesi minuscoli si tratta come zero.
 */
export function distributeSpies(w: WorldState, isPlayer: (i: number) => boolean): void {
  const cs = w.countries;
  const sv = (i: number) => Math.max(cs[i]!.stratValue, 0);
  const total = cs.reduce((s, _, i) => s + sv(i), 0);
  w.donors.forEach((d, slot) => {
    if (isPlayer(d)) return;
    const D = cs[d]!;
    for (const c of cs) c.spiesReceived[slot] = 0;
    let budget = Math.max(D.budget.espForeign, 0);
    if (!budget) return;
    let general = budget;
    if (D.team) {
      const half = budget / 2;
      general = half;
      const rivals = cs.map((c, i) => (c.team && c.team !== D.team ? i : -1)).filter((i) => i >= 0);
      const sumRivals = rivals.reduce((s, i) => s + sv(i), 0);
      if (sumRivals > 0) {
        for (const r of rivals) {
          const amount = (half * sv(r)) / sumRivals;
          cs[r]!.spiesReceived[slot] = Math.trunc(amount / 1e6);
          budget -= amount;
        }
      }
    }
    const denominator = total - sv(d);
    if (denominator > 0) {
      cs.forEach((c, r) => {
        if (r === d) return;
        const amount = (general * sv(r)) / denominator;
        c.spiesReceived[slot] = (c.spiesReceived[slot] ?? 0) + Math.trunc(amount / 1e6);
        budget -= amount;
      });
    }
    D.budget.espForeign = Math.max(budget, 0);
  });
}
