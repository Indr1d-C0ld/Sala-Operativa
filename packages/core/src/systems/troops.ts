import type { Rng } from "../rng.js";
import type { Rules } from "../rules.js";
import type { Deployment, WorldState } from "../types.js";
import { relationLevel } from "./relation.js";

/**
 * Truppe schierate fuori dai confini (TROOPS nell'originale) e azione 25 (FUN_5db5_0000).
 *
 * Dall'originale: un paese aumenta o diminuisce le truppe che ha già in un paese; altrimenti
 * cerca un paese vicino al bersaglio che le accetti (tiro contro 33 + 5·ambizione), annuncia
 * "forze … si avvicinano al confine di …" e poi le schiera; se nessuno le accetta, fallisce.
 * Una guerra la combatte chi ha truppe sul teatro.
 *
 * Scelte nostre (◇): verso un paese amico (relazione ≥ 5) le truppe vanno nel paese stesso,
 * che le accetta; verso gli altri vanno in un vicino che ha con chi le manda una relazione ≥ 4;
 * il contingente arriva dopo 7–21 giorni; si schiera al massimo metà dell'esercito in patria.
 */

/** Truppe in patria: l'esercito meno i contingenti all'estero. */
export function homeTroops(w: WorldState, i: number): number {
  const abroad = w.deployments.filter((d) => d.owner === i).reduce((s, d) => s + d.troops, 0);
  return Math.max(0, w.countries[i]!.troops - abroad);
}

/** Contingenti arrivati di un paese in un luogo. */
export function deploymentsIn(w: WorldState, location: number, day: number): Deployment[] {
  return w.deployments.filter((d) => d.location === location && d.arrive <= day && d.troops >= 1);
}

export type DeployOutcome =
  | { kind: "adjusted" | "stationed" | "staged"; host: number; troops: number }
  | { kind: "refused" };

/** Quante truppe schiera di norma un paese (◇ un quinto dell'esercito in patria, al massimo metà). */
export function defaultContingent(w: WorldState, i: number): number {
  return Math.round(homeTroops(w, i) * 0.2);
}

/** Azione 25: `a` schiera `amount` soldati verso `t` (nel paese stesso se amico, altrimenti ai suoi confini). */
export function deployTroops(w: WorldState, rules: Rules, rng: Rng, a: number, t: number, amount: number, day: number): DeployOutcome {
  const troops = Math.min(Math.max(0, amount), homeTroops(w, a) * 0.5);
  if (troops < 1) return { kind: "refused" };
  const place = (host: number, kind: "stationed" | "staged"): DeployOutcome => {
    const existing = w.deployments.find((d) => d.owner === a && d.location === host);
    if (existing) {
      existing.troops += troops;
      return { kind: "adjusted", host, troops };
    }
    w.deployments.push({ owner: a, location: host, troops, initial: troops, sent: day, arrive: day + rng.int(7, 21) });
    return { kind, host, troops };
  };
  if (w.deployments.some((d) => d.owner === a && d.location === t)) return place(t, "stationed");
  if (relationLevel(w, rules, a, t, 0) >= 5) return place(t, "stationed");
  // un vicino del bersaglio disposto ad accettarle, dal più amico
  const hosts = (w.neighbours[t] ?? [])
    .filter((h) => h !== a && w.countries[h]!.econPower > 0)
    .map((h) => ({ h, rel: relationLevel(w, rules, a, h, 0) }))
    .filter((x) => x.rel >= 4)
    .sort((x, y) => y.rel - x.rel);
  for (const { h } of hosts) {
    if (rng.int(1, 100) < 33 + 5 * w.countries[h]!.ambition) return place(h, "staged");
  }
  return { kind: "refused" };
}

/** Il bersaglio ha truppe di `a` alle porte? (contingente arrivato in un vicino o nel paese stesso) */
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
