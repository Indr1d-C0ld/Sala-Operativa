import type { Rules } from "../rules.js";
import type { WorldState } from "../types.js";
import { peaceIndex } from "./world.js";

/**
 * Belligeranza: la % del PIL che un paese vuole spendere per la difesa (originale:
 * FUN_b2e8_0dc6, passo 4 "peace levels"). Il nuovo valore è la media fra quello dell'anno prima
 * e la tabella [pace][etica]; l'IA usa la media su tre anni come quota del PIL alla difesa.
 */
export function computeBelligerence(w: WorldState, rules: Rules): void {
  for (const c of w.countries) {
    c.peace = Math.min(Math.max(c.peace, 1), 6);
    const [d0, d1] = c.belligerence;
    if (c.econPower === 0) {
      c.belligerence = [0, d0, d1];
    } else {
      const t = rules.belligerenceTable[peaceIndex(c.peace)]![peaceIndex(c.ethic)]!;
      c.belligerence = [(d0 + t) / 2, d0, d1];
    }
    c.belligerenceAvg = (c.belligerence[0] + c.belligerence[1] + c.belligerence[2]) / 3;
  }
}
