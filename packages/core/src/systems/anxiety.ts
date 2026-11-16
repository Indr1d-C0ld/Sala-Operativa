import type { Rules } from "../rules.js";
import type { WorldState } from "../types.js";
import { regionalWeight, regionMembership } from "./regions.js";

const clamp100 = (x: number) => Math.min(Math.max(x, 0), 100);

/** (peso mondo, peso regione): le grandi potenze (quota >= 5) guardano al mondo per l'80%. */
export function referenceWeights(share: number): [number, number] {
  if (share >= 5) return [0.8, 0.2];
  const wr = Math.max(1 - 0.175 * share, 0.2);
  return [1 - wr, wr];
}

/**
 * Passo 13 (originale: FUN_7714_10b4, "Threat_Anxiety_Calcs"): le cinque ansie e i cinque
 * bisogni d'aiuto. Richiede quote, influenza, squadre, leader, classifica delle ideologie,
 * massimi mondiali e regionali aggiornati. Verificato 165/165 sugli scenari originali.
 */
export function computeAnxieties(w: WorldState, rules: Rules): void {
  const cs = w.countries;
  const { member, home } = regionMembership(w);
  const wp = w.worldPeace;
  const wpf = wp === 0 ? 1.75 : (4 / Math.max(wp, 1e-5) + 3) / 4;
  const leaders = new Set(w.teamLeaders);

  const teamWarheads = new Map<number, number>();
  for (const c of cs) if (c.team) teamWarheads.set(c.team, (teamWarheads.get(c.team) ?? 0) + c.warheads);
  const regionMil = w.regions.map((r) => r.members.reduce((s, m) => s + cs[m.country]!.milShare * regionalWeight(w, rules, m.country), 0));

  const rankInfl = (i: number) => {
    const r = w.ideologyRanking.indexOf(cs[i]!.ideology);
    return cs[i]!.ideology && r >= 0 ? cs[i]!.influence / (r + 1) : 0;
  };
  const totalRankInfl = cs.reduce((s, _, i) => s + rankInfl(i), 0);

  cs.forEach((c, i) => {
    if (!c.econPower) return;
    const regs = member[i]!;
    const rmax = (f: (k: number) => number) => (regs.length ? Math.max(...regs.map(f)) : 0);
    const rs = (k: number) => w.regionState[k]!;
    const { ambition: amb, peace, repression: rep, ler, pcGnp: pc } = c;

    // nucleare
    const isLeader = c.team !== 0 && leaders.has(i);
    let a: number;
    if (isLeader) {
      const own = Math.max(teamWarheads.get(c.team) ?? 0, 0);
      let other = 0;
      for (const [t, v] of teamWarheads) if (t !== c.team) other += v;
      a = (other / (own + 1)) * 75;
    } else if (c.team) {
      a = (7 - wp) * amb * (7 - c.nucLevel) * (7 - peace) * wpf;
    } else {
      a = ((7 - wp) * (7 - peace) * 2 * amb * (7 - c.nucLevel)) / 7 * wpf;
      if (w.neighbours[i]!.some((j) => cs[j]!.nucLevel >= 2)) a *= 3;
    }
    c.anxiety.nuclear = clamp100(a);

    // militare
    if (isLeader) {
      a = ((100 - c.milShare) / (7 - amb)) * (7 - peace) + c.milShare / 5;
    } else {
      const own = c.milShare * regionalWeight(w, rules, i);
      const tot = home[i]! >= 0 ? regionMil[home[i]!]! : 0;
      a = 100 - (100 * own) / Math.max(tot, 1e-4);
      a = (a / Math.max(peace, 1e-4)) * ((amb + 10) / 10) * wpf;
    }
    c.anxiety.military = clamp100(a);

    // politica
    c.anxiety.political = clamp100((0.5 / Math.max(ler, 1e-4)) * amb * ((rep + 1) / 2) * (7 - peace) * 2.25 * wpf);

    // economica
    let [ww, wr] = referenceWeights(c.econShare);
    const refPc = ww * w.maxima.pcGnp + wr * rmax((k) => rs(k).maxPcGnp);
    const refG = ww * w.maxima.gdpGrowth + wr * rmax((k) => rs(k).maxGdpGrowth);
    const e1 = refPc ? Math.max(0, 1 - pc / refPc) : 0;
    const e2 = refG ? Math.max(0, 1 - c.gdpGrowth / refG) : 0;
    c.anxiety.economic = clamp100(((e1 + e2) / 2) * 100);

    // sociale
    const g = c.gdpGrowth;
    a = g <= 0.005 ? (c.popGrowth / 0.023) * rep * amb * 6 : (c.popGrowth / 0.023) * rep * 10 * amb * (0.03 / g);
    c.anxiety.social = clamp100(a);

    // bisogni d'aiuto
    [ww, wr] = referenceWeights(c.nucShare);
    let ref = ww * w.maxima.nucSpend + wr * rmax((k) => rs(k).maxNucSpend);
    c.hunger.nuclear = ref < c.nucSpend || amb === 1 ? 0 : (((ref - c.nucSpend) * 100) / (7 - amb)) * (c.anxiety.nuclear / 100);

    [ww, wr] = referenceWeights(c.milShare);
    ref = ww * w.maxima.milSpend + wr * rmax((k) => rs(k).maxMilSpend);
    c.hunger.military = ref < c.milSpend ? 0 : ((ref - c.milSpend) / peace / (7 - amb) + amb * 100 * (7 - peace)) * (c.anxiety.military / 100);

    [ww, wr] = referenceWeights(c.influence);
    ref = ww * w.maxima.intelBudget + wr * rmax((k) => rs(k).maxIntelBudget);
    c.hunger.intelligence = ref < c.budget.intel ? 0 : ((ref - c.budget.intel) / (7 - amb)) * (c.anxiety.political / 100);

    [ww, wr] = referenceWeights(c.econShare);
    ref = ww * w.maxima.pcGnp + wr * rmax((k) => rs(k).maxPcGnp);
    if (pc >= Math.max(w.maxima.pcGnp, rules.anxiety.economicCap) / 2 || ref < pc) c.hunger.economic = 0;
    else c.hunger.economic = Math.min((ref - pc) * Math.trunc(c.population) * (c.anxiety.economic / 100), w.totals.econPower * 1e5);

    const share = totalRankInfl ? (rankInfl(i) * 100) / totalRankInfl : rankInfl(i) * 100;
    [ww, wr] = referenceWeights(share);
    ref = ww * rules.anxiety.humanitarianReference + wr * rmax((k) => rs(k).maxPcGnp);
    c.hunger.humanitarian = ref < pc ? 0 : Math.trunc(c.population) * (ref - pc) * (c.anxiety.social / 100);
  });
}
