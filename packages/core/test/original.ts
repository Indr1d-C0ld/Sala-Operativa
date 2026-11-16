/**
 * Lettore dei file del gioco originale, SOLO per i test di accettazione.
 * Legge gli scenari in re/orig/SHADOW (riferimento di studio, mai distribuito) e costruisce
 * uno WorldState; restituisce anche i valori salvati da confrontare con quelli calcolati.
 * Layout dei file: re/FORMATS.md.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AID_TYPES,
  emptyRegionState,
  type Country,
  type RegionDef,
  type WorldState,
} from "../src/index.js";

export const ORIGINAL_DIR = resolve(import.meta.dirname, "../../../re/orig/SHADOW");
export const hasOriginal = existsSync(`${ORIGINAL_DIR}/COUNTRY.0`);
export const SCENARIOS = ["0", "S0", "S1", "S2", "S3", "S4"] as const;

const file = (name: string) => readFileSync(`${ORIGINAL_DIR}/${name}`);

class Rec {
  constructor(private buf: Buffer, private base: number) {}
  f64 = (o: number) => this.buf.readDoubleLE(this.base + o);
  f32 = (o: number) => this.buf.readFloatLE(this.base + o);
  i16 = (o: number) => this.buf.readInt16LE(this.base + o);
  u16 = (o: number) => this.buf.readUInt16LE(this.base + o);
  i32 = (o: number) => this.buf.readInt32LE(this.base + o);
  u8 = (o: number) => this.buf.readUInt8(this.base + o);
}

/** Valori salvati negli scenari, nella forma attesa dai test. */
export interface Saved {
  influence: number[];
  orientation: number[];
  belligerence: number[][];   // [d0, d1, d2]
  regMilShare: number[];
  regEconShare: number[];
  regInfluence: number[];
  anxiety: number[][];        // [nucl, mil, pol, econ, soc]
  hunger: number[][];         // [hum, econ, intel, mil, nucl]
  repression: number[];
  outcry: number[];
  trade: number[][];
  coalition: number[];
  teamLeaders: number[];
  budgets: { covertAction: number; insurgency: number; espSelf: number; active: boolean }[];
}

function readRegions(): RegionDef[] {
  const d = file("REGIONS.DAT");
  const names = file("RNAMES.TXT").toString("latin1").split(/\r?\n/);
  const out: RegionDef[] = [];
  let p = 0;
  while (p < d.length && d[p] === 0x40) {
    const id = d.readInt16LE(p + 1);
    const n = d.readInt16LE(p + 3);
    p += 5;
    const members: RegionDef["members"] = [];
    for (let k = 0; k < n; k++, p += 3) members.push({ country: d.readInt16LE(p), core: d[p + 2] === 0x43 });
    out.push({ id, name: names[id] ?? `regione ${id}`, members });
  }
  return out;
}

function readNeighbours(count: number): number[][] {
  const d = file("CONTIG.FIL");
  return Array.from({ length: count }, (_, i) => {
    const n = d.readInt16LE(i * 42);
    return Array.from({ length: Math.max(n, 0) }, (_, k) => d.readInt16LE(i * 42 + 2 + 2 * k));
  });
}

/**
 * Carica uno scenario. Con `stage` = "pre-aid" toglie dagli stock gli aiuti che il passo 12
 * aggiunge dopo i passi 6–11, così che i sistemi di quei passi vedano lo stato dell'epoca.
 */
export function loadOriginal(sfx: string, stage: "saved" | "pre-aid" = "saved"): { world: WorldState; saved: Saved } {
  const names = file("CNAMES.TXT").toString("latin1").split(/\r?\n/).slice(0, 168);
  const cty = file(`COUNTRY.${sfx}`);
  const num = file(`NUMBERS.${sfx}`);
  const str = file(`STRATEGY.${sfx}`);
  const ast = file(`ASSET.${sfx}`);
  const mor = file(`MORENUMS.${sfx}`);
  const wld = new Rec(file(`WORLD.${sfx}`), 0);
  const reg = file(`REGION.${sfx}`);
  const cia = file("CIADATA.FIL");

  const donors = Array.from({ length: 15 }, (_, k) => wld.i16(0x9e + 2 * k));
  const countries: Country[] = names.map((name, i) => {
    const C = new Rec(cty, i * 202);
    const N = new Rec(num, i * 61);
    const S = new Rec(str, i * 160);
    const A = new Rec(ast, i * 180);
    const aidSum = (k: number) => Array.from({ length: 15 }, (_, s) => A.i16(k * 30 + 2 * s)).reduce((x, y) => x + y, 0);
    const pre = stage === "pre-aid";
    const ideo = N.u8(0x34);
    return {
      key: name,
      name,
      econPower: C.f64(16) - (pre ? aidSum(1) * 10 : 0),
      gdpGrowth: N.f32(0x28),
      population: N.f64(0x18),
      popGrowth: N.f32(0x24),
      pcGnp: C.f64(120),
      qol: C.f64(177),
      socialSpending: new Rec(mor, i * 31).f64(4),
      oilReserves: C.f64(128),
      strategicReserves: C.f64(136),
      troops: new Rec(cia, i * 66).i32(53),
      milSpend: C.f64(112) - (pre ? aidSum(3) * 1e6 : 0),
      milCapital: C.f64(104),
      milPower: C.f64(8),
      nucSpend: C.f64(96) - (pre ? aidSum(4) * 1e6 : 0),
      nucPower: C.f64(0),
      nucLevel: C.i16(193),
      warheads: N.i16(0x3b),
      milShare: C.f64(56),
      econShare: C.f64(88),
      nucShare: C.f64(68),
      influence: C.f64(32),
      influencePrev: C.f64(40),
      regInfluence: C.f64(24),
      regMilShare: C.f64(48),
      regEconShare: C.f64(80),
      stratValue: C.f32(198),
      flag144: C.u8(144),
      ideology: ideo ? String.fromCharCode(ideo) : "",
      ethic: N.f32(0x30),
      ambition: N.f32(0x35),
      ler: C.f64(169),
      repression: N.f64(0),
      outcry: N.f64(0x10),
      peace: C.f64(145),
      belligerence: [C.f32(157), C.f32(161), C.f32(165)],
      belligerenceAvg: C.f32(153),
      orientation: C.u16(195),
      team: C.u8(197) & 0x7f,
      teamLeaderInCoalition: (C.u8(197) & 0x80) !== 0,
      controlledBy: N.i16(0x39),
      anxiety: { nuclear: S.f64(0), military: S.f64(8), political: S.f64(0x10), economic: S.f64(0x18), social: S.f64(0x20) },
      hunger: { humanitarian: S.f64(0x78), economic: S.f64(0x80), intelligence: S.f64(0x88), military: S.f64(0x90), nuclear: S.f64(0x98) },
      budget: {
        intel: S.f64(0x28), covertAction: S.f64(0x30), intelAid: S.f64(0x38), insurgency: S.f64(0x40),
        espSelf: S.f64(0x48) - (pre ? aidSum(2) * 1e6 : 0), espForeign: S.f64(0x50),
        militaryAid: S.f64(0x58), economicAid: S.f64(0x60), humanitarianAid: S.f64(0x68), nuclearAid: S.f64(0x70),
      },
      aidReceived: Object.fromEntries(
        AID_TYPES.map((t, k) => [t, Array.from({ length: 15 }, (_, s) => A.i16(k * 30 + 2 * s))]),
      ) as Country["aidReceived"],
      spiesReceived: Array.from({ length: 15 }, (_, s) => A.i16(0x96 + 2 * s)),
      tradeLevel: Array.from({ length: 15 }, (_, s) => mor[i * 31 + 0x10 + s]!),
    };
  });

  const regions = readRegions();
  const regionState = regions.map((_, k) => ({ ...emptyRegionState(), peace: reg.readFloatLE(k * 210 + 0xce) }));
  const world: WorldState = {
    countries,
    regions,
    regionState,
    neighbours: readNeighbours(168),
    worldPeace: wld.f32(0x12e),
    donors,
    coalition: Array.from({ length: 15 }, (_, k) => wld.i16(0x80 + 2 * k)).filter((x) => x !== -1),
    teamLeaders: Array.from({ length: 15 }, (_, k) => wld.i16(0xbc + 2 * k)).filter((x) => x !== -1),
    ideologyRanking: "",
    leaderEthic: wld.f64(0x48),
    qolNormalizer: file(`MISC.${sfx}`).readDoubleLE(8),
    totals: { econPower: wld.f64(0), milPower: wld.f64(0x20), nucPower: wld.f64(0x18), population: wld.f64(8) },
    maxima: {
      pcGnp: wld.f64(0x38), nucSpend: wld.f64(0xe4), milSpend: wld.f64(0xf4),
      intelBudget: wld.f64(0x104), gdpGrowth: wld.f64(0x10c),
    },
    wars: [],
    deployments: [],
    disasters: [],
  };
  // massimi regionali come salvati (servono alle ansie, che girano dopo il passo 6)
  regions.forEach((_, k) => {
    const R = new Rec(reg, k * 210);
    Object.assign(regionState[k]!, {
      maxPcGnp: R.f64(0x40), maxNucShare: R.f64(0x86), maxNucSpend: R.f64(0x8e), maxMilShare: R.f64(0x96),
      maxMilSpend: R.f64(0x9e), maxIntelBudget: R.f64(0xae), maxGdpGrowth: R.f64(0xb6), maxEcon: R.f64(0xbe),
    });
  });

  const saved: Saved = {
    influence: countries.map((c) => c.influence),
    orientation: countries.map((c) => c.orientation),
    belligerence: countries.map((c) => [...c.belligerence]),
    regMilShare: countries.map((c) => c.regMilShare),
    regEconShare: countries.map((c) => c.regEconShare),
    regInfluence: countries.map((c) => c.regInfluence),
    anxiety: countries.map((c) => [c.anxiety.nuclear, c.anxiety.military, c.anxiety.political, c.anxiety.economic, c.anxiety.social]),
    hunger: countries.map((c) => [c.hunger.humanitarian, c.hunger.economic, c.hunger.intelligence, c.hunger.military, c.hunger.nuclear]),
    repression: countries.map((c) => c.repression),
    outcry: countries.map((c) => c.outcry),
    trade: countries.map((c) => [...c.tradeLevel]),
    coalition: [...world.coalition],
    teamLeaders: [...world.teamLeaders],
    budgets: countries.map((c) => ({
      covertAction: c.budget.covertAction, insurgency: c.budget.insurgency,
      espSelf: c.budget.espSelf, active: c.budget.intelAid !== 0,
    })),
  };
  return { world, saved };
}

/** Quanti valori coincidono entro una tolleranza relativa. */
export function countMatches(pairs: [number, number][], tol = 1e-6): number {
  return pairs.filter(([a, b]) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b))).length;
}
