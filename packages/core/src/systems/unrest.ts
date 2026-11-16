import type { WorldState } from "../types.js";

/**
 * Fine mese, "Receiving Social Outcry Levels" (originale: FUN_ed41_0000).
 * - repressione = (5 − 0,9·etica)·3 / etica del leader dell'ideologia dominante, in [0,4];
 * - malcontento = 25·repressione·min(3704/PIL pro capite, 1)·(0,03/(max(crescita, 0,003) + 0,002))², al massimo 100.
 * Entrambe verificate 165/165 sugli scenari originali.
 */
export function computeOutcry(w: WorldState): void {
  for (const c of w.countries) {
    if (!c.econPower) continue;
    const ethic = Math.min(Math.max(c.ethic, 1), 6);
    c.repression = Math.min(Math.max(w.leaderEthic ? ((5 - 0.9 * ethic) * 3) / w.leaderEthic : 0, 0), 4);
    const poverty = Math.min(3704 / (c.pcGnp + 1e-6), 1);
    const stagnation = 0.03 / (Math.max(c.gdpGrowth, 0.003) + 0.002);
    c.outcry = Math.min(25 * c.repression * poverty * stagnation * stagnation, 100);
  }
}
