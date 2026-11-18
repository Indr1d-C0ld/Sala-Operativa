import type { Rng } from "../rng.js";
import type { Rules } from "../rules.js";
import type { Deployment, WorldState } from "../types.js";
import { relationLevel } from "./relation.js";

/**
 * Truppe schierate fuori dai confini (TROOPS nell'originale) e azione 25 (FUN_5db5_0000).
 *
 * Se chi schiera ha già un contingente nel bersaglio ne alza il livello ordinato. Altrimenti
 * chiede prima al bersaglio stesso, poi ai suoi confinanti (FUN_5db5_0be3): accetta il primo
 * paese H per cui chi schiera è etico (> 3) o della stessa squadra, e
 * rand(1,100) ≤ ansia militare − 0,6·(8 − rel)²·pace − 15·(8 − rel) + 15·rel (FUN_5db5_1b0d);
 * chi rifiuta diventa più ansioso (×1,05) e meno pacifico (×0,98). Il contingente nasce subito
 * con zero soldati e cresce ogni settimana verso il livello ordinato (FUN_5825_4af0).
 *
 * ◇ Il livello ordinato è un quinto dell'esercito in patria (`defaultContingent`); il paese del
 * giocatore non fa da ospite (nell'originale deciderebbe lui).
 */

/** Truppe in patria: l'esercito meno i contingenti all'estero. */
export function homeTroops(w: WorldState, i: number): number {
  const abroad = w.deployments.filter((d) => d.owner === i).reduce((s, d) => s + d.troops, 0);
  return Math.max(0, w.countries[i]!.troops - abroad);
}

/** Contingenti presenti (almeno un soldato) di un paese in un luogo. */
export function deploymentsIn(w: WorldState, location: number, day: number): Deployment[] {
  return w.deployments.filter((d) => d.location === location && d.arrive <= day && d.troops >= 1);
}

export type DeployOutcome =
  | { kind: "adjusted" | "stationed" | "staged"; host: number; troops: number }
  | { kind: "refused" };

/** Quante truppe schiera di norma un paese (◇ un quinto dell'esercito in patria). */
export function defaultContingent(w: WorldState, i: number): number {
  return Math.round(homeTroops(w, i) * 0.2);
}

/** Probabilità (su 100) che `h` accetti le truppe di `a` (FUN_5db5_1b0d), o 0 se non può. */
export function hostChance(w: WorldState, rules: Rules, a: number, h: number): number {
  const A = w.countries[a]!;
  const H = w.countries[h]!;
  if (!(A.ethic > 3 || A.team === H.team)) return 0;
  const rel = relationLevel(w, rules, a, h, 0);
  return H.anxiety.military - 0.6 * (8 - rel) ** 2 * H.peace - 15 * (8 - rel) + 15 * rel;
}

/** Azione 25: `a` ordina `amount` soldati verso `t` (nel paese stesso o in un suo confinante). */
export function deployTroops(w: WorldState, rules: Rules, rng: Rng, a: number, t: number, amount: number, day: number, player = -1): DeployOutcome {
  const ordered = Math.min(Math.max(0, amount), homeTroops(w, a));
  if (ordered < 1) return { kind: "refused" };
  const existing = w.deployments.find((d) => d.owner === a && d.location === t);
  if (existing) {
    existing.ordered = (existing.ordered ?? existing.troops) + ordered;
    return { kind: "adjusted", host: t, troops: ordered };
  }
  for (const h of [t, ...(w.neighbours[t] ?? [])]) {
    if (h === a || h === player || !w.countries[h]!.econPower) continue;
    if (rng.int(1, 100) <= hostChance(w, rules, a, h)) {
      w.deployments.push({ owner: a, location: h, troops: 0, initial: ordered, ordered, sent: day, arrive: day });
      return { kind: h === t ? "stationed" : "staged", host: h, troops: ordered };
    }
    const H = w.countries[h]!;
    H.anxiety.military = Math.min(100, H.anxiety.military * 1.05);
    H.peace = Math.max(1, H.peace * 0.98);
  }
  return { kind: "refused" };
}

/**
 * Crescita settimanale dei contingenti verso il livello ordinato (FUN_5825_4af0): ogni volta
 * min(120.000, 62.000·spesa militare/esercito/100.000) soldati, finché ce ne sono in patria.
 */
export function growDeployments(w: WorldState): void {
  for (const d of w.deployments) {
    if (d.ordered === undefined || d.troops >= d.ordered) continue;
    const A = w.countries[d.owner]!;
    if (!A.troops) continue;
    const step = Math.min(120000, (62000 * A.milSpend) / A.troops / 1e5);
    d.troops += Math.max(0, Math.min(step, d.ordered - d.troops, homeTroops(w, d.owner)));
  }
}

/** Il bersaglio ha truppe di `a` alle porte? (contingente presente in un vicino o nel paese stesso) */
export function hasForwardTroops(w: WorldState, a: number, t: number, day: number): boolean {
  const near = new Set([t, ...(w.neighbours[t] ?? [])]);
  return w.deployments.some((d) => d.owner === a && near.has(d.location) && d.arrive <= day && d.troops >= 1);
}

/**
 * Ritira a fine guerra i contingenti dei partecipanti schierati nei luoghi del fronte: chi ha
 * perso li perde, gli altri tornano a casa. I contingenti di paesi estranei restano.
 */
export function releaseDeployments(w: WorldState, locations: number[], participants: number[], losers: number[]): Deployment[] {
  const set = new Set(locations);
  const involved = new Set(participants);
  const surrendered: Deployment[] = [];
  w.deployments = w.deployments.filter((d) => {
    if (!set.has(d.location) || !involved.has(d.owner)) return true;
    if (losers.includes(d.owner)) {
      const c = w.countries[d.owner]!;
      c.troops = Math.max(0, c.troops - d.troops);
      surrendered.push(d);
    }
    return false;
  });
  return surrendered;
}
