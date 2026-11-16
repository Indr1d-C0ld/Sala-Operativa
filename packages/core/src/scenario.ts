import { Rng } from "./rng.js";
import type { GenerationRules, Rules } from "./rules.js";
import { AID_TYPES, type Country, type RegionDef, type WorldState } from "./types.js";
import { emptyRegionState, computeRegions } from "./systems/regions.js";
import { computeWorldCoalition } from "./systems/coalition.js";
import { computeOrientation, ideologyRelation } from "./systems/orientation.js";
import { computeTeamLeaders } from "./systems/teams.js";
import { computeTrade } from "./systems/trade.js";
import { computeBudgets } from "./systems/budgets.js";
import { computeAnxieties } from "./systems/anxiety.js";
import { computeMilitary, computeQualityOfLife, computeWorldMaxima } from "./systems/economy.js";
import { computeOutcry } from "./systems/unrest.js";
import { computeInfluence, computeWorldShares, rankIdeologies } from "./systems/world.js";
import { updateLeaderEthic } from "./simulation.js";
import type { Succession } from "./map.js";
import { applyDrift } from "./systems/drift.js";

/** Opzioni del generatore di scenari. */
export interface WorldOptions {
  /** Deriva procedurale 0 (storico) … 1 (molto alternativo). */
  drift?: number;
  /** Paesi che la deriva non tocca nell'ideologia e nell'arsenale (il giocatore). */
  protect?: string[];
}

/** Pacchetto di partenza prodotto da tools/export_scenario.py (formato melchior-scenario/1). */
export interface ScenarioPack {
  format: string;
  year: number;
  /** Tutte le successioni fra stati, anche successive all'anno (servono alla carta). */
  lineage?: Succession[];
  countries: {
    code: string;
    iso2: string | null;
    name: string;
    type: string;
    administeredBy: string | null;
    government?: string;
    muslimShare?: number | null;
    neighbours?: string[];
    mapRef?: string;
    coords?: [number, number] | null;
    /** Indicatori grezzi del Factbook per l'anno (es. budget_revenues_usd). */
    indicators?: Record<string, { value: number | null; refYear?: number | null; derived?: boolean }>;
    initial: {
      econPower: number | null; population: number; gdpGrowth: number | null; popGrowth: number | null;
      pcGnp: number | null; troops: number | null; milSpend: number | null; oilReserves: number;
      ideology: string | null; ethic: number | null; ambition: number | null;
    };
  }[];
}

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);
const inRange = (x: number, r?: [number, number]) => !r || (x >= r[0] && x < r[1]);

/** Valore in un anno interpolato linearmente fra gli anni di una tabella (testate, prezzi). */
export function warheadsIn(anchors: [number, number][], year: number): number {
  if (!anchors.length) return 0;
  if (year <= anchors[0]![0]) return anchors[0]![1];
  for (let k = 1; k < anchors.length; k++) {
    const [y0, w0] = anchors[k - 1]!;
    const [y1, w1] = anchors[k]!;
    if (year <= y1) return Math.round(w0 + ((w1 - w0) * (year - y0)) / (y1 - y0));
  }
  return anchors[anchors.length - 1]![1];
}

/**
 * Costruisce e genera un mondo giocabile da un pacchetto Factbook.
 *
 * Dai dati: economia, popolazione, truppe, spesa militare, petrolio, confini, area geografica.
 * Generati con le regole (`GenerationRules`) e il seme: ideologia (dal tipo di governo, dalla
 * religione e dal reddito), etica (nell'intervallo dell'ideologia, corretta dal tipo di regime),
 * ambizione (spesa militare e peso), pace, LER, arsenali nucleari, regioni con i paesi adiacenti,
 * adesione alle squadre. Poi lo stato derivato si calcola nell'ordine del ciclo annuale.
 */
export function worldFromPack(pack: ScenarioPack, rules: Rules, gen: GenerationRules, seed: number, options: WorldOptions = {}): WorldState {
  const rng = new Rng(seed);
  const year = pack.year;
  const codeIndex = new Map(pack.countries.map((c, i) => [c.code, i]));
  const prices = warheadsIn(gen.priceIndex, year) || 1;
  const militaryPct = new Map(gen.militaryPct
    .filter((m) => (m.from ?? 0) <= year && year <= (m.to ?? 9999)).map((m) => [m.code, m.pct]));
  const democracy = new RegExp(gen.democracyPattern, "i");
  const authoritarian = new RegExp(gen.authoritarianPattern, "i");

  const countries: Country[] = pack.countries.map((x) => {
    const fixedPct = militaryPct.get(x.code);
    const i = x.initial;
    const econ = i.econPower ?? 0;
    const gdp = econ * 1e5;
    const troops = i.troops ?? Math.round(i.population * 0.003);
    const milSpend = fixedPct !== undefined ? (gdp * fixedPct) / 100 : i.milSpend ?? gdp * 0.02;
    const milPct = gdp ? (100 * milSpend) / gdp : 2;
    const pc = i.pcGnp ?? (i.population ? gdp / i.population : 0);
    return {
      key: x.code, name: x.name,
      econPower: econ, gdpGrowth: i.gdpGrowth ?? 0.02, population: i.population, popGrowth: i.popGrowth ?? 0.01,
      pcGnp: pc, qol: 0, socialSpending: 0, oilReserves: i.oilReserves,
      strategicReserves: 1 + Math.min(i.oilReserves / 40, 0.5),
      troops, milSpend, milCapital: 0, milPower: 0, nucSpend: 0, nucPower: 0, nucLevel: 0, warheads: 0,
      milShare: 0, econShare: 0, nucShare: 0, influence: 0, influencePrev: 0,
      regInfluence: 0, regMilShare: 0, regEconShare: 0, stratValue: 0, flag144: 0,
      ideology: "", ethic: 3, ambition: 3, ler: 0.5, repression: 2, outcry: 0, peace: 4,
      belligerence: [milPct, milPct, milPct], belligerenceAvg: milPct,
      orientation: 4, team: 0, teamLeaderInCoalition: false, controlledBy: -1,
      anxiety: { nuclear: 0, military: 0, political: 0, economic: 0, social: 0 },
      hunger: { humanitarian: 0, economic: 0, intelligence: 0, military: 0, nuclear: 0 },
      budget: {
        intel: 0, covertAction: 0, intelAid: 0, insurgency: 0, espSelf: 0, espForeign: 0,
        militaryAid: 0, economicAid: 0, humanitarianAid: 0, nuclearAid: 0,
      },
      aidReceived: Object.fromEntries(AID_TYPES.map((t) => [t, new Array<number>(15).fill(0)])) as Country["aidReceived"],
      spiesReceived: new Array<number>(15).fill(0),
      tradeLevel: new Array<number>(15).fill(3),
    };
  });

  // --- controllo, arsenali nucleari ---
  pack.countries.forEach((x, i) => {
    const admin = x.administeredBy ? codeIndex.get(x.administeredBy) : undefined;
    countries[i]!.controlledBy = admin ?? i;
  });
  for (const n of gen.nuclear) {
    const i = codeIndex.get(n.code);
    if (i === undefined || (n.from !== undefined && year < n.from) || (n.to !== undefined && year > n.to)) continue;
    const c = countries[i]!;
    c.warheads = warheadsIn(n.warheads, year);
    c.nucLevel = c.warheads > 0 ? n.level : 0;
  }

  // --- ideologia, etica, ambizione, pace, LER (prima i paesi sovrani, poi i territori) ---
  const sovereignFirst = pack.countries.map((_, i) => i).sort((a, b) => Number(!!pack.countries[a]!.administeredBy) - Number(!!pack.countries[b]!.administeredBy));
  for (const i of sovereignFirst) {
    const x = pack.countries[i]!;
    const c = countries[i]!;
    if (!c.econPower) continue;
    const gov = (x.government ?? "").toLowerCase();
    const muslim = x.muslimShare ?? 0;
    const milPct = c.belligerenceAvg;
    const admin = c.controlledBy !== i ? countries[c.controlledBy] : undefined;

    const override = gen.ideologyOverrides.find((o) => o.code === x.code && (o.from ?? 0) <= year && year <= (o.to ?? 9999));
    if (override) c.ideology = override.ideology;
    else if (admin?.ideology) c.ideology = admin.ideology;
    else {
      for (const r of gen.ideologyByGovernment) {
        if (!new RegExp(r.pattern, "i").test(gov || "-")) continue;
        if (r.muslimMin !== undefined && muslim < r.muslimMin) continue;
        if (r.minPc !== undefined && c.pcGnp < r.minPc * prices) continue;
        if (r.maxPc !== undefined && c.pcGnp >= r.maxPc * prices) continue;
        if (r.minMilitaryPct !== undefined && milPct < r.minMilitaryPct) continue;
        if (r.chance !== undefined && rng.next() >= r.chance) continue;
        c.ideology = r.ideology;
        break;
      }
    }
    const [lo, hi] = rules.social.ethicRange[c.ideology] ?? [1, 6];
    let ethic = Math.round((lo + hi) / 2) + rng.int(-1, 1);
    if (democracy.test(gov) && !authoritarian.test(gov) && c.pcGnp >= 15000 * prices) ethic += 1;
    if (authoritarian.test(gov)) ethic -= 1;
    c.ethic = clamp(ethic, 1, 6);
    c.ambition = clamp(Math.round(1 + milPct * 0.6 + (c.nucLevel >= 5 ? 1 : 0) + rng.int(0, 1)), 1, 6);
    c.peace = clamp((milPct >= 8 ? 2 : milPct >= 5 ? 3 : milPct >= 3 ? 4 : milPct >= 1.5 ? 5 : 6) + rng.int(-1, 0), 1, 6);
    c.ler = clamp(0.5 + (authoritarian.test(gov) ? 0.05 : 0) + (rng.next() - 0.5) * 0.2, 0.2, 0.8);
  }

  // --- contingenti all'estero di partenza (tabella delle regole, interpolata per anno) ---
  const deployments: WorldState["deployments"] = [];
  for (const d of gen.deployments) {
    if ((d.from !== undefined && year < d.from) || (d.to !== undefined && year > d.to)) continue;
    const owner = codeIndex.get(d.owner);
    const location = codeIndex.get(d.location);
    if (owner === undefined || location === undefined || !countries[location]!.econPower) continue;
    const troops = Math.min(warheadsIn(d.troops, year), countries[owner]!.troops * 0.5);
    if (troops >= 1) deployments.push({ owner, location, troops, initial: troops, sent: 0, arrive: 0 });
  }

  // --- deriva procedurale (flusso casuale separato: con deriva 0 nulla cambia) ---
  applyDrift(countries, rules, seed, {
    level: options.drift ?? 0,
    protect: options.protect ?? [],
    muslimShare: (i) => pack.countries[i]?.muslimShare ?? 0,
  });

  // --- confini (simmetrici) e regioni con i paesi adiacenti ---
  const neighbours = countries.map(() => new Set<number>());
  pack.countries.forEach((x, i) => {
    for (const code of x.neighbours ?? []) {
      const j = codeIndex.get(code);
      if (j !== undefined && j !== i) {
        neighbours[i]!.add(j);
        neighbours[j]!.add(i);
      }
    }
  });
  const regionOf = pack.countries.map((x) => {
    const forced = gen.regionByCode[x.code];
    if (forced !== undefined) return gen.regions.findIndex((r) => r.name === forced);
    const [lat, lon] = x.coords ?? [0, 0];
    return gen.regions.findIndex((r) =>
      r.mapRef.some((m) => (x.mapRef ?? "").toLowerCase().includes(m.toLowerCase())) && inRange(lat, r.lat) && inRange(lon, r.lon));
  });
  // senza area riconosciuta (es. "World"): la regione del paese più vicino per coordinate
  regionOf.forEach((k, i) => {
    const p = pack.countries[i]!.coords;
    if (k >= 0 || !p) return;
    let best = Infinity;
    pack.countries.forEach((y, j) => {
      const q = y.coords;
      if (!q || regionOf[j]! < 0) return;
      const d = (p[0] - q[0]) ** 2 + ((p[1] - q[1]) * Math.cos((p[0] * Math.PI) / 180)) ** 2;
      if (d < best) { best = d; regionOf[i] = regionOf[j]!; }
    });
  });
  const regions: RegionDef[] = gen.regions.map((r, k) => ({ id: k, name: r.name, members: [] }));
  regionOf.forEach((k, i) => { if (k >= 0) regions[k]!.members.push({ country: i, core: true }); });
  // adiacenti: i confinanti di un membro che stanno in un'altra regione (al massimo 4 regioni per paese)
  const count = countries.map((_, i) => (regionOf[i]! >= 0 ? 1 : 0));
  for (const r of regions) {
    const core = new Set(r.members.map((m) => m.country));
    const adjacent = new Set<number>();
    for (const i of core) for (const j of neighbours[i]!) if (!core.has(j)) adjacent.add(j);
    for (const j of adjacent) if (count[j]! < 4) { r.members.push({ country: j, core: false }); count[j]!++; }
  }

  const byGdp = countries.map((c, i) => [i, c.econPower] as const).sort((a, b) => b[1] - a[1]).map(([i]) => i);
  const w: WorldState = {
    countries, regions, regionState: regions.map(() => emptyRegionState()), neighbours: neighbours.map((s) => [...s]),
    worldPeace: 4, donors: byGdp.slice(0, 15), coalition: [], teamLeaders: [], ideologyRanking: "",
    leaderEthic: 3, qolNormalizer: 1,
    totals: { econPower: 0, milPower: 0, nucPower: 0, population: 0 },
    maxima: { pcGnp: 0, nucSpend: 0, milSpend: 0, intelBudget: 0, gdpGrowth: 0 },
    wars: [],
    deployments,
    disasters: [],
  };

  // --- stato derivato, nell'ordine del ciclo annuale ---
  computeMilitary(w, () => false);
  computeWorldShares(w);
  computeInfluence(w, rules);
  computeWorldMaxima(w);
  computeWorldCoalition(w, rules);
  rankIdeologies(w, rules);
  updateLeaderEthic(w);
  computeOrientation(w, rules);
  computeTeamLeaders(w, rules);
  w.teamLeaders.forEach((leader, k) => { countries[leader]!.team = k + 1; });
  // adesione alle squadre: fra i leader di ideologia uguale o amica, con peso la radice
  // dell'influenza, moltiplicata se il leader sta nella stessa regione o ha la stessa ideologia
  const leaders = new Set(w.teamLeaders);
  const regionsOf = countries.map(() => new Set<number>());
  regions.forEach((r) => r.members.forEach((m) => regionsOf[m.country]!.add(r.id)));
  countries.forEach((c, i) => {
    if (!c.econPower || leaders.has(i) || rng.next() >= gen.teams.joinChance) return;
    const options = w.teamLeaders.map((l) => {
      const L = countries[l]!;
      const same = L.ideology === c.ideology;
      if (!same && ideologyRelation(rules, L.ideology, c.ideology) !== 2) return { l, weight: 0 };
      const near = [...regionsOf[l]!].some((r) => regionsOf[i]!.has(r));
      return { l, weight: Math.sqrt(L.influence) * (same ? gen.teams.sameIdeologyBonus : 1) * (near ? gen.teams.sameRegionBonus : 1) };
    }).filter((o) => o.weight > 0);
    let pick = rng.next() * options.reduce((s, o) => s + o.weight, 0);
    for (const o of options) {
      pick -= o.weight;
      if (pick <= 0) { c.team = countries[o.l]!.team; break; }
    }
  });
  computeTeamLeaders(w, rules);
  computeOutcry(w);
  w.qolNormalizer = Math.max(1, ...countries.map((c) => c.pcGnp + 3737));
  computeQualityOfLife(w);
  computeRegions(w, rules);
  computeTrade(w);
  computeBudgets(w, () => false);
  computeWorldMaxima(w);
  computeAnxieties(w, rules);
  return w;
}
