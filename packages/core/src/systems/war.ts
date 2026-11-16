import type { Rng } from "../rng.js";
import type { Rules } from "../rules.js";
import type { Deployment, War, WarSide, WorldState } from "../types.js";
import { relationLevel } from "./relation.js";
import { deploymentsIn, hasForwardTroops, homeTroops, releaseDeployments } from "./troops.js";

/**
 * Guerra (originale: FUN_5825_0000 overlay 46, resa FUN_5db5_3cd2, annessione FUN_5db5_2ef9).
 * Formule in re/FORMATS.md, "Guerra" e "Resa".
 *
 * Scelte nostre (◇), dove l'originale non è decifrato:
 *  - fattibilità dell'invasione: confine comune, truppe già schierate presso il bersaglio
 *    (azione 25), oppure chi attacca è una grande potenza (quota militare ≥ projectionShare);
 *  - chi attacca impegna rules.war.commitShare delle truppe in patria più i contingenti schierati
 *    presso il bersaglio; chi difende tutte le sue, più i contingenti alleati sul suo territorio,
 *    che entrano in guerra anche se arrivano dopo;
 *  - negoziato di pace: soglia min(100·LER, 10 + 10·relazione + (100 − forza minore)/2);
 *  - l'escalation nucleare non è ancora collegata (manca il modulo delle conseguenze nucleari).
 */
const ROW_LIMITS = [0.86, 0.72, 0.58, 0.44, 0.3, 0.16, 0.02, 0.01, 0.005, 0.0025, 0.0012, 0.0006, 0.0003,
  0.00015, 8e-5, 4e-5, 2e-5, 1e-5, 5e-6, 2.5e-6];

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

/** Guerra in cui un paese combatte (o è il teatro), o undefined. */
export function warOf(w: WorldState, i: number): War | undefined {
  return w.wars.find((war) => war.theater === i || war.sides.some((s) => s.countries.includes(i)));
}

/** L'invasione è fattibile? (◇ vedi sopra) `day` serve a contare solo i contingenti arrivati. */
export function canInvade(w: WorldState, rules: Rules, a: number, t: number, day = Infinity): boolean {
  const A = w.countries[a]!;
  const T = w.countries[t]!;
  if (a === t || !A.econPower || !T.econPower || A.troops < 1) return false;
  if (warOf(w, a) || warOf(w, t)) return false;                // un fronte alla volta
  return (w.neighbours[a] ?? []).includes(t) || hasForwardTroops(w, a, t, day) || A.milShare >= rules.war.projectionShare;
}

function makeSide(w: WorldState, countries: number[], contributions: number[], defending: boolean): WarSide {
  const cs = countries.map((i) => w.countries[i]!);
  const troops = contributions.reduce((s, x) => s + x, 0);
  const n = cs.length || 1;
  const force = cs.reduce((s, c) => s + c.troops, 0);
  const population = cs.reduce((s, c) => s + c.population, 0);
  return {
    countries,
    contributions,
    troops,
    reserves: Math.max(force - troops, 0),
    mobilizable: Math.min(population * 0.03, force),
    strength: 100,
    dead: 0,
    civilians: 0,
    force,
    population,
    spending: cs.reduce((s, c) => s + c.milSpend, 0),
    ler: cs.reduce((s, c) => s + c.ler, 0) / n + (defending ? 0.1 : 0),
    ambition: cs.reduce((s, c) => s + c.ambition, 0) / n + (defending ? 2 : 0),
    repression: cs.reduce((s, c) => s + c.repression, 0) / n,
    totalDead: 0,
    totalCivilians: 0,
  };
}

/** Contingenti di `a` schierati presso il teatro `t` (nel paese o nei vicini), già arrivati. */
function forwardOf(w: WorldState, a: number, t: number, day: number): Deployment[] {
  const near = new Set([t, ...(w.neighbours[t] ?? [])]);
  return w.deployments.filter((d) => d.owner === a && near.has(d.location) && d.arrive <= day);
}

/** Apre una guerra: `a` invade `t`; i contingenti alleati presenti in `t` lo difendono. */
export function startWar(w: WorldState, rules: Rules, a: number, t: number, day = 0): War {
  const id = w.wars.reduce((m, x) => Math.max(m, x.id), 0) + 1;
  const forward = forwardOf(w, a, t, day).reduce((s, d) => s + d.troops, 0);
  const guests = deploymentsIn(w, t, day).filter((d) => d.owner !== a && d.owner !== t);
  const war: War = {
    id, theater: t, start: day,
    sides: [
      makeSide(w, [a], [homeTroops(w, a) * rules.war.commitShare + forward], false),
      makeSide(w, [t, ...guests.map((d) => d.owner)], [homeTroops(w, t), ...guests.map((d) => d.troops)], true),
    ],
  };
  w.wars.push(war);
  return war;
}

/** Contingenti arrivati sul teatro a guerra iniziata: si uniscono ai difensori. Restituisce chi entra. */
export function reinforce(w: WorldState, war: War, day: number): number[] {
  const def = war.sides[1];
  const joined: number[] = [];
  for (const d of deploymentsIn(w, war.theater, day)) {
    if (war.sides.some((s) => s.countries.includes(d.owner))) continue;
    const c = w.countries[d.owner]!;
    def.countries.push(d.owner);
    def.contributions.push(d.troops);
    def.troops += d.troops;
    def.force += c.troops;
    def.spending += c.milSpend;
    joined.push(d.owner);
  }
  return joined;
}

/**
 * Riporta sui paesi le perdite di un lato, in proporzione alle truppe che ciascuno ha portato:
 * scendono l'esercito, la spesa, la popolazione e i contingenti schierati sul fronte.
 */
function applyLosses(w: WorldState, war: War, side: WarSide, civiliansOn: number[]): void {
  const total = side.contributions.reduce((s, x) => s + x, 0) || 1;
  const front = new Set([war.theater, ...(w.neighbours[war.theater] ?? [])]);
  side.countries.forEach((i, k) => {
    const c = w.countries[i]!;
    const share = side.contributions[k]! / total;
    const lost = Math.min(side.dead * share, c.troops, side.contributions[k]!);
    if (c.troops > 0) c.milSpend *= 1 - lost / c.troops;       // la spesa segue l'esercito
    // i contingenti al fronte perdono in proporzione a quanto il paese ha portato
    const ratio = side.contributions[k]! > 0 ? 1 - lost / side.contributions[k]! : 1;
    for (const d of w.deployments) if (d.owner === i && front.has(d.location)) d.troops *= ratio;
    side.contributions[k] = side.contributions[k]! - lost;
    c.troops -= lost;
    c.population = Math.max(0, c.population - lost);         // i caduti escono dalla popolazione
  });
  const pop = civiliansOn.reduce((s, i) => s + w.countries[i]!.population, 0) || 1;
  for (const i of civiliansOn) {
    const c = w.countries[i]!;
    c.population = Math.max(0, c.population - side.civilians * (c.population / pop));
  }
}

export type WarResult = { war: War; loser: 0 | 1 } | null;

/** Un tick di guerra. Restituisce il lato che si arrende, se c'è. */
export function warTick(w: WorldState, rules: Rules, rng: Rng, war: War): 0 | 1 | null {
  const [att, def] = war.sides;
  // potenza di combattimento (q = spesa per soldato)
  const qa = att.force ? att.spending / att.force : 0.001;
  const qd = (def.force ? def.spending / def.force : 0.001) || 0.0001;
  const power = (s: WarSide, q: number) => s.ler * (s.ambition / 20) * (q * s.troops) * (1 - (s.repression - 1) / 20);
  const pa = power(att, qa);
  const pd = power(def, qd) * 0.7 * (qd / (qa || 0.0001));
  // 0,01 di LER passa a caso da un lato all'altro
  if (rng.int(1, 2) === 1) { att.ler += 0.01; def.ler -= 0.01; } else { att.ler -= 0.01; def.ler += 0.01; }

  let r = pa ? pd / pa : 1;
  const noise = r <= 0.002 ? 0.001 : r <= 1 ? 0.14 : r > 2 ? 1 : 0.2;
  const sign = rng.int(0, 2);
  r = Math.max(0, r + (sign === 0 ? -noise : sign === 1 ? 0 : noise));
  let e = 0;
  for (const limit of ROW_LIMITS) if (r < limit) e++;
  const t1 = rules.war.defenderLosses[e]! / 6;
  const t2 = rules.war.attackerLosses[e]! / 6;

  def.dead = clamp(att.troops * t1 / 8, 0, def.troops);
  if (def.dead < 50) def.dead = Math.min(rng.int(0, 50), def.troops);
  att.dead = clamp(def.troops * t2 * 1.6 / 8, 0, att.troops);
  if (att.dead < 50) att.dead = Math.min(rng.int(0, 50), att.troops);

  for (const [s, civ] of [[def, 0.2], [att, 0.1]] as const) {
    s.troops = Math.max(0, s.troops - s.dead);
    s.spending = s.force ? s.spending * (1 - s.dead / s.force) : 0;
    s.force = Math.max(0, s.force - s.dead);
    s.strength = s.troops ? clamp(100 - (s.dead / s.troops) * 100 * 3 + s.ambition ** 2, 0, 100) : 0;
    s.mobilizable = Math.min(s.population * 0.03, s.force);
    s.civilians = Math.min(s.dead * civ, s.population);
    s.population = Math.max(0, s.population - s.civilians - s.dead);
    s.totalDead += s.dead;
    s.totalCivilians += s.civilians;
  }

  // perdite extra del lato con la leadership peggiore
  const weaker = att.ler < def.ler ? att : def;
  const stronger = weaker === att ? def : att;
  const dl = stronger.ler - weaker.ler;
  if (weaker.ler >= 0.5 && dl > 0) {
    const k = [5, 3, 2.5, 1.5];
    const f = [0.1, 0.1, 0.075, 0.025];
    for (let j = 0; j < 4; j++) {
      if (rng.int(1, 100) < (dl / k[j]!) * 100) {
        const extra = Math.min((stronger.troops / 8) * f[j]! * (100 * dl + 10) / 10, weaker.troops);
        weaker.troops -= extra;
        weaker.dead += extra;
        weaker.totalDead += extra;
        break;
      }
    }
  }

  applyLosses(w, war, def, [war.theater]);
  applyLosses(w, war, att, att.countries);
  // danni all'economia del paese teatro
  const theater = w.countries[war.theater]!;
  theater.econPower *= def.strength < 50 ? 0.98 : 0.9967;

  // resa: prima chi attacca, poi chi difende (◇ l'ordine)
  for (const side of [0, 1] as const) {
    const s = war.sides[side];
    if (s.troops < 1 || s.force < 1 || rng.int(1, 100) > s.strength + 2) return side;
  }
  return null;
}

/**
 * Chiude una guerra. `loser` = lato sconfitto, o null per una pace negoziata. Se perdono i
 * difensori il teatro è annesso dal primo attaccante.
 */
export function endWar(w: WorldState, war: War, loser: 0 | 1 | null): Deployment[] {
  const winners = loser === null ? [] : war.sides[1 - loser]!.countries;
  const losers = loser === null ? [] : war.sides[loser]!.countries;
  // contingenti del fronte: chi ha perso si arrende, gli altri tornano a casa
  const surrendered = releaseDeployments(w, [war.theater, ...(w.neighbours[war.theater] ?? [])],
    [...war.sides[0].countries, ...war.sides[1].countries], losers);
  if (loser === 1) {
    const conqueror = w.countries[war.sides[0].countries[0]!]!;
    const T = w.countries[war.theater]!;
    conqueror.econPower += T.econPower;
    conqueror.milSpend += T.milSpend;
    conqueror.population += T.population;
    T.ambition = conqueror.ambition;
    T.ethic = conqueror.ethic;
    T.econPower = 0;
    T.milSpend = 0;
    T.population = 0;
    T.troops = 0;
    T.controlledBy = war.sides[0].countries[0]!;
  }
  for (const i of [...war.sides[0].countries, ...war.sides[1].countries]) {
    const c = w.countries[i]!;
    if (losers.includes(i)) c.ler = Math.max(0, c.ler - 0.1);
    if (winners.includes(i)) c.ler = Math.min(1, c.ler + 0.1);
    w.worldPeace -= (c.peace * c.influence) / 100;
    c.peace = i === war.theater ? 2.5 : c.peace >= 6 ? 5.9 : c.peace * 1.2;
    c.peace = clamp(c.peace, 1, 6);
    w.worldPeace += (c.peace * c.influence) / 100;
  }
  w.worldPeace = clamp(w.worldPeace, 1, 6);
  w.wars = w.wars.filter((x) => x !== war);
  return surrendered;
}

/** Soglia del negoziato di pace (◇ l'originale, FUN_6318_278b, non è decifrato). */
export function peaceThreshold(w: WorldState, rules: Rules, a: number, war: War, roll = 0): number {
  const A = w.countries[a]!;
  const other = war.sides[0].countries.includes(a) ? war.sides[1].countries[0]! : war.sides[0].countries[0]!;
  const rel = relationLevel(w, rules, a, other, roll);
  const weakest = Math.min(war.sides[0].strength, war.sides[1].strength);
  return Math.min(100 * A.ler, 10 + 10 * rel + (100 - weakest) / 2);
}
