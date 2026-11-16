import type { Rules } from "../rules.js";
import type { WorldState } from "../types.js";

/**
 * Leader dei World Team (originale: FUN_7714_0286, passo 7). Sono candidati i paesi con quota
 * militare o influenza >= soglia; si raggruppano per (orientamento, ideologia) e in ogni gruppo
 * guida il più influente. Il leader che fa parte della coalizione mondiale porta la squadra
 * nella coalizione.
 *
 * L'adesione degli altri paesi, casuale e pesata sull'influenza dei leader, non è ancora
 * ricostruita: qui i membri conservano la squadra che hanno.
 */
export function computeTeamLeaders(w: WorldState, rules: Rules): void {
  const min = rules.coalition.candidateMin;
  const best = new Map<string, number>();
  w.countries.forEach((c, i) => {
    if (!c.ideology || (c.milShare < min && c.influence < min)) return;
    const key = `${c.orientation}|${c.ideology}`;
    const cur = best.get(key);
    if (cur === undefined || c.influence > w.countries[cur]!.influence) best.set(key, i);
  });
  w.teamLeaders = [...best.values()].sort((a, b) => w.countries[b]!.influence - w.countries[a]!.influence);
  const inCoalition = new Set(w.coalition);
  for (const leader of w.teamLeaders) {
    const team = w.countries[leader]!.team;
    for (const c of w.countries) if (team && c.team === team) c.teamLeaderInCoalition = inCoalition.has(leader);
  }
}
