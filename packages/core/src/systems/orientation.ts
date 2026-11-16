import type { Rules } from "../rules.js";
import type { WorldState } from "../types.js";

/** Rapporto fra due ideologie: 2 amica, 1 nemica, 0 neutrale (originale: FUN_7124_2d51). */
export function ideologyRelation(rules: Rules, a: string, b: string): 0 | 1 | 2 {
  if ((rules.friends[a] ?? "").includes(b)) return 2;
  if ((rules.enemies[a] ?? "").includes(b)) return 1;
  return 0;
}

/**
 * Orientamento di politica estera, 1 (allineato al blocco dominante) .. 8 (ostile).
 * Dipende dal posto dell'ideologia del paese nella classifica e dal rapporto con quella
 * dominante, più le correzioni delle regole. Originale: FUN_7124_161a, passo 5.
 * Richiede `w.ideologyRanking` aggiornata.
 */
export function computeOrientation(w: WorldState, rules: Rules): void {
  const dominant = w.ideologyRanking[0] ?? "";
  for (const c of w.countries) {
    if (!c.ideology) continue;
    const rank = w.ideologyRanking.indexOf(c.ideology);
    const rel = ideologyRelation(rules, dominant, c.ideology);
    let o: number;
    if (rank === 0) o = 1;
    else if (rank === 1) o = rel === 2 ? 2 : 5;
    else if (rank === 2) o = rel === 2 ? 2 : 3;
    else o = rel === 2 ? 1 : rel === 1 ? 8 : 4;
    o += rules.orientationAdjust.byIdeology[c.ideology] ?? 0;
    o += rules.orientationAdjust.byCountry[c.key] ?? 0;
    if (c.ethic < 2 && c.ambition >= 5) o += rules.orientationAdjust.ruthlessAmbitious;
    c.orientation = o;
  }
}
