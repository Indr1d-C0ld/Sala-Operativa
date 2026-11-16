import type { Rules } from "../rules.js";
import type { WorldState } from "../types.js";

/**
 * Livello di relazione fra due paesi, 1 (ostile) .. 7 (alleato); il "Country Interaction Mood"
 * del manuale ha la scala opposta (CIM = 8 − r). Originale: FUN_7124_0b5a.
 * `roll` sostituisce il tiro rand(0,3) usato fra due paesi minori di squadre diverse.
 */
export function relationLevel(w: WorldState, rules: Rules, a: number, t: number, roll: number): number {
  const cs = w.countries;
  const A = cs[a]!;
  const T = cs[t]!;
  const [bigI, smallI] = A.influence > T.influence ? [a, t] : [t, a];
  const big = cs[bigI]!;
  const small = cs[smallI]!;
  const sameTeam = A.team === T.team;
  const coal = new Set(w.coalition);
  const bigIn = coal.has(bigI);
  const smallIn = coal.has(smallI);

  let r: number;
  if (big.influence >= 50) {
    r = Math.trunc(big.ethic + 1);
  } else if (big.influence >= 5) {
    if (small.influence >= 5 || small.milShare >= 5) r = bigIn && smallIn ? 9 : bigIn ? 5 : smallIn ? 2 : 4;
    else if (!sameTeam) r = small.team ? (small.regInfluence < 15 ? 6 : 5) : small.regInfluence < 5 ? 7 : 6;
    else if (small.econShare < 4.4 && small.influence < 4.0) r = small.regInfluence > 10 ? 6 : 5;
    else r = 6;
  } else if (big.influence >= 1) {
    const mid = small.influence >= 1 && small.influence < 5;
    if (big.team) r = mid ? (sameTeam ? 6 : 7) : sameTeam ? 5 : 7;
    else r = mid ? (small.team ? 6 : 7) : small.team ? 6 : 5;
  } else if (sameTeam) {
    r = Math.trunc(3 + small.ethic + big.ethic);
  } else if (big.regInfluence >= 5) {
    r = Math.trunc((small.ethic + big.ethic) / 2) + roll;
  } else {
    r = 4;
  }

  r -= Math.abs(A.orientation - T.orientation);
  if (big.ideology === small.ideology) r += 1;
  const pair = (x: string, y: string) => (A.key === x && T.key === y) || (A.key === y && T.key === x);
  for (const b of rules.relation.bonusPairs) if (pair(b.a, b.b)) r += b.delta;
  if (big.ideology === rules.relation.penaltyIdeology || small.ideology === rules.relation.penaltyIdeology) r -= 1;
  for (const h of rules.relation.halvings) {
    if ((small.key === h.country && big.ideology === h.asSmallVsBigIdeology) || (big.key === h.country && small.ideology === h.asBigVsSmallIdeology)) {
      r = Math.trunc(r * 0.5);
      break;
    }
  }
  for (const rv of rules.relation.rivals) if (pair(rv.a, rv.b)) r += rv.delta;
  return Math.min(Math.max(r, 1), 7);
}
