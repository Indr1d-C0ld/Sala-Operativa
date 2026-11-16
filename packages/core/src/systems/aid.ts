import type { Rules } from "../rules.js";
import { AID_TYPES, type AidType, type Country, type WorldState } from "../types.js";
import { ideologyRelation } from "./orientation.js";

const BUDGET_OF: Record<AidType, keyof Country["budget"]> = {
  humanitarian: "humanitarianAid", economic: "economicAid", intelligence: "intelAid", military: "militaryAid", nuclear: "nuclearAid",
};
/** Ordine in cui l'originale assegna i tipi d'aiuto a un paese (FUN_7556_1ed6). */
const ORDER: AidType[] = ["military", "economic", "humanitarian", "nuclear", "intelligence"];

/**
 * Quanto dare (originale: FUN_7556_23ce). Con `classicBug` riproduce l'errore dell'originale,
 * che quando la quota supera la richiesta dà la differenza invece della richiesta.
 */
export function aidAmount(budget: number, desired: number, share: number, classicBug: boolean): number {
  if (budget <= 1e6) return 0;
  const x = budget * share;
  if (x > 1e6) return x < desired ? x : classicBug ? x - desired : desired;
  return desired > 1e6 ? 1e6 : 0;
}

/**
 * Passo 10, distribuzione degli aiuti dei donatori IA (originale: FUN_7556_0000). Ogni anno il
 * donatore azzera e ridistribuisce: 75% agli alleati poveri della propria squadra, 25% ai poveri
 * della stessa squadra o senza squadra, in proporzione al valore strategico, fino al bisogno.
 * Il giocatore è escluso: le sue assegnazioni le decide lui.
 */
export function distributeAid(w: WorldState, rules: Rules, isPlayer: (i: number) => boolean): void {
  const cs = w.countries;
  w.donors.forEach((d, slot) => {
    const D = cs[d]!;
    if (isPlayer(d)) return;
    for (const t of AID_TYPES) for (const c of cs) c.aidReceived[t][slot] = 0;
    if (D.influence < rules.aid.minDonorInfluence) return;

    const inA: boolean[] = cs.map(() => false);
    const inB: boolean[] = cs.map(() => false);
    let sumA = 0;
    let sumB = 0;
    cs.forEach((R, r) => {
      if (r === d || R.population <= 0 || R.controlledBy !== r) return;
      if (ideologyRelation(rules, D.ideology, R.ideology) === 1) return;
      if (!(D.pcGnp / 2 > R.pcGnp)) return;
      if (R.team === D.team) {
        inA[r] = true;
        sumA += R.stratValue;
      }
      if (R.team === 0 || R.team === D.team) {
        inB[r] = true;
        sumB += R.stratValue;
      }
    });

    for (const [pool, frac, members, total] of [["A", 0.75, inA, sumA], ["B", 0.25, inB, sumB]] as const) {
      if (!(total > 0)) continue;
      const budget = Object.fromEntries(AID_TYPES.map((t) => [t, D.budget[BUDGET_OF[t]] * frac])) as Record<AidType, number>;
      cs.forEach((R, r) => {
        const eligible = pool === "A" ? inA[r] && inB[r] : members[r];
        if (!eligible) return;
        const share = R.stratValue / total;
        for (const t of ORDER) {
          if (!(R.hunger[t] > 0)) continue;
          if (t === "military" && !(D.orientation - R.orientation < 2)) continue;
          if (t === "nuclear") {
            const ok = D.orientation - R.orientation < 2 && D.nucLevel >= 5 && R.nucLevel < D.nucLevel
              && (D.ambition >= 4 || w.worldPeace <= 2) && D.orientation >= 5;
            if (!ok) continue;
          }
          const give = aidAmount(budget[t], R.hunger[t], share, rules.aid.classicBug);
          R.hunger[t] -= give;
          budget[t] -= give;
          R.aidReceived[t][slot] = (R.aidReceived[t][slot] ?? 0) + Math.trunc(give / 1e6);
        }
      });
    }
  });
}

/**
 * Passo 12, somma degli aiuti ricevuti (originale: FUN_b04b_0000): gli aiuti economici vanno al
 * PIL, gli umanitari al PIL pro capite e alla spesa sociale, gli altri ai rispettivi bilanci.
 */
export function addAid(w: WorldState): void {
  for (const c of w.countries) {
    const sum = (t: AidType) => c.aidReceived[t].reduce((s, x) => s + x, 0);
    const [hum, econ, intel, mil, nuc] = AID_TYPES.map(sum) as [number, number, number, number, number];
    c.socialSpending += hum * 1e6;
    c.econPower += econ * 10;
    c.pcGnp = c.population ? (c.econPower * 1e5 + hum * 1e6) / c.population : 0;
    c.budget.espSelf += intel * 1e6;
    c.milSpend += mil * 1e6;
    c.nucSpend += nuc * 1e6;
    for (const k of ["nuclear", "military", "political", "economic", "social"] as const) {
      c.anxiety[k] = Math.min(Math.max(c.anxiety[k], 0), 100);
    }
  }
}
