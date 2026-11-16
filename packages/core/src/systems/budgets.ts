import type { WorldState } from "../types.js";

/**
 * Passo 9, bilanci dei paesi IA (originale: FUN_b2e8_0000). Il paese del giocatore è escluso:
 * il suo bilancio viene dalla schermata del bilancio.
 *
 * - bilancio dell'intelligence B = PIL·2% / ((pace + etica + 7 − ambizione)/3);
 * - "attivo" se PIL pro capite >= 4000 $ o influenza >= quella del 15° donatore: solo allora
 *   ci sono azioni coperte, aiuti all'intelligence e insurrezioni;
 * - spesa e potere nucleari, bilanci d'aiuto militari, nucleari, economici e umanitari.
 */
export function computeBudgets(w: WorldState, isPlayer: (i: number) => boolean): void {
  const lastDonor = w.donors[w.donors.length - 1];
  const threshold = lastDonor === undefined ? Infinity : w.countries[lastDonor]!.influence;
  w.countries.forEach((c, i) => {
    if (isPlayer(i) || !c.econPower) return;
    const { peace, ethic, ambition: amb } = c;
    const gdp = c.econPower * 1e5;
    const B = (gdp * 0.02) / ((peace + ethic + (7 - amb)) / 3);
    const active = c.pcGnp >= 4000 || c.influence >= threshold;
    const b = c.budget;
    b.intel = B;
    b.covertAction = active ? (((7 - peace) * 3 * (7 - peace)) / 100) * (B / 3) : 0;
    b.intelAid = active ? amb * 0.04 * B : 0;
    b.insurgency = active ? ((6 - (peace + (7 - amb)) / 2) / 100) * B : 0;
    b.espSelf = (B * (50 - ethic * w.leaderEthic)) / 200;
    b.espForeign = B - b.covertAction - b.intelAid - b.insurgency - b.espSelf;

    const belligerent = c.belligerenceAvg >= 1.5;
    c.nucSpend = belligerent ? c.milSpend * amb * 0.0027 * (c.nucLevel + 1) : 0;
    c.nucPower = c.milSpend ? (c.nucSpend / c.milSpend) * c.milPower : 0;
    b.nuclearAid = c.nucSpend === 0 ? 0 : c.milSpend * 0.01 * (1 + c.anxiety.nuclear / 100) * (1 + (7 - amb) / 100);
    b.militaryAid = belligerent ? (24 / (ethic + 0.01) / 100) * c.milSpend : 0;
    const aid = active ? Math.max(gdp * 0.00084, 0) : 0;
    b.economicAid = (aid * 2) / 3;
    b.humanitarianAid = aid / 3;
  });
}
