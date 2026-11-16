import type { Rules } from "../rules.js";
import type { RegionState, WorldState } from "../types.js";
import { minimalWinningCoalition } from "./coalition.js";
import { peaceIndex } from "./world.js";

/** Peso di un paese nelle somme regionali (l'URSS conta per un terzo nel profilo classico). */
export const regionalWeight = (w: WorldState, rules: Rules, i: number): number =>
  rules.regionalWeightOverrides[w.countries[i]!.key] ?? 1;

/**
 * Passo 6 (originale: FUN_ab78_3692). Per ogni regione:
 * - quote regionali militare ed economica di ogni paese elencato (membri e adiacenti);
 * - influenza regionale dei soli membri, con i pesi della pace regionale dell'anno prima;
 * - nuova pace regionale (Σ pace·influenza regionale/100 dei membri, arrotondata, in [1,6]);
 * - coalizione regionale (stessa ricerca di quella mondiale, sull'influenza regionale >= 5,
 *   quote non normalizzate, candidati membri e adiacenti);
 * - massimi regionali usati dalle ansie.
 * Un paese in più regioni conserva i valori dell'ultima elaborata, come nell'originale.
 */
export function computeRegions(w: WorldState, rules: Rules): void {
  const cs = w.countries;
  w.regions.forEach((r, k) => {
    const st = w.regionState[k]!;
    const ids = r.members.map((m) => m.country);
    const fw = (i: number) => regionalWeight(w, rules, i);
    const sumMil = ids.reduce((s, i) => s + cs[i]!.milPower * fw(i), 0);
    const sumEcon = ids.reduce((s, i) => s + cs[i]!.econPower * fw(i), 0);
    const [wm, we] = rules.regionalWeights[peaceIndex(st.peace)]!;
    const regInfl = new Map<number, number>();
    for (const { country: i, core } of r.members) {
      const c = cs[i]!;
      c.regMilShare = sumMil ? (100 * c.milPower) / sumMil : 0;
      c.regEconShare = sumEcon ? (100 * c.econPower) / sumEcon : 0;
      const ri = wm * c.regMilShare + we * c.regEconShare;
      regInfl.set(i, ri);
      if (core) c.regInfluence = ri;
    }
    const peace = r.members.filter((m) => m.core).reduce((s, m) => s + (cs[m.country]!.peace * regInfl.get(m.country)!) / 100, 0);
    st.peace = Math.min(Math.max(Math.trunc(peace + 0.5), 1), 6);
    st.coalition = minimalWinningCoalition(
      ids
        .map((i) => ({ index: i, share: regInfl.get(i)! }))
        .filter((c) => c.share >= rules.coalition.candidateMin)
        .slice(0, rules.coalition.maxCandidates),
      rules,
    );
    st.sumEcon = sumEcon;
    st.sumMilPower = sumMil;
    const max = (f: (i: number) => number) => Math.max(0, ...ids.map(f));
    st.maxPcGnp = max((i) => cs[i]!.pcGnp);
    st.maxNucShare = max((i) => cs[i]!.nucShare);
    st.maxNucSpend = max((i) => cs[i]!.nucSpend);
    st.maxMilShare = max((i) => cs[i]!.milShare);
    st.maxMilSpend = max((i) => cs[i]!.milSpend);
    st.maxIntelBudget = max((i) => cs[i]!.budget.intel);
    st.maxGdpGrowth = max((i) => cs[i]!.gdpGrowth);
    st.maxEcon = max((i) => cs[i]!.econPower);
  });
}

export function emptyRegionState(): RegionState {
  return {
    peace: 3, coalition: [], maxPcGnp: 0, maxNucShare: 0, maxNucSpend: 0, maxMilShare: 0, maxMilSpend: 0,
    maxIntelBudget: 0, maxGdpGrowth: 0, maxEcon: 0, sumEcon: 0, sumMilPower: 0,
  };
}

/** Regioni di cui un paese fa parte (membro o adiacente) e regione "di casa" (l'ultima da membro). */
export function regionMembership(w: WorldState): { member: number[][]; home: number[] } {
  const member: number[][] = w.countries.map(() => []);
  const home: number[] = w.countries.map(() => -1);
  w.regions.forEach((r, k) => {
    for (const m of r.members) {
      member[m.country]!.push(k);
      if (m.core) home[m.country] = k;
    }
  });
  return { member, home };
}
