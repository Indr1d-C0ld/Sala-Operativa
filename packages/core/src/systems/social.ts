import type { Rng } from "../rng.js";
import type { Rules } from "../rules.js";
import type { WorldState } from "../types.js";

/** Fine mese: i governi con LER sotto 0,5 recuperano 1–8 punti con probabilità pari al LER. */
export function leadershipRecovery(w: WorldState, rng: Rng): void {
  for (const c of w.countries) {
    if (!c.econPower) continue;
    c.ler = Math.min(Math.max(c.ler, 0), 1);
    const r = rng.int(1, 100);
    const k = rng.int(1, 8);
    if (c.ler < 0.5 && 100 * c.ler > r) c.ler = Math.min(1, c.ler + k / 100);
  }
}

/** Un evento sociale da mettere in coda: stadio 1–10, fra quanti giorni e ore. */
export interface SocialEventPlan {
  country: number;
  stage: number;
  delayDays: number;
  delayHours: number;
}

/**
 * Fine mese, "Processing Social Events" (originale: FUN_ed41_11fc): con malcontento alto si tira
 * ogni stadio con la probabilità della tabella per livello di repressione e se ne sceglie uno.
 */
export function planSocialEvents(w: WorldState, rules: Rules, rng: Rng): SocialEventPlan[] {
  const plans: SocialEventPlan[] = [];
  w.countries.forEach((c, i) => {
    if (!c.econPower) return;
    const r1 = rng.int(0, 60);
    const r2 = rng.int(1, 2);
    if (!(c.outcry > 40 + r1 && r2 === 2)) return;
    const row = rules.social.stageChance[Math.trunc(c.repression + 0.5) - 1];
    const passed: number[] = [];
    for (let s = 1; s <= 10; s++) {
      const chance = c.repression < 1 || c.repression > 5 || !row ? 0 : row[s - 1] ?? 0;
      if (rng.int(1, 100) > 100 - chance) passed.push(s);
    }
    if (!passed.length) return;
    const stage = passed[rng.int(0, passed.length - 1)]!;
    plans.push({ country: i, stage, delayHours: rng.int(1, 23), delayDays: rng.int(0, 28) });
  });
  return plans;
}

export type SocialOutcome =
  | { kind: "suppressed" }
  | { kind: "happened"; regimeChange: boolean; playerKilled: boolean; playerOusted: boolean };

/**
 * Esito di un evento sociale (originale: FUN_6a19_155d, EventType 3). L'evento avviene se un tiro
 * resta sotto 2·repressione·(etica+1)/2·stadio·(1 + ansia sociale/100)·(LER + 0,5); allora il LER
 * cala e dagli stadi più gravi può seguire un cambio di regime. Per il giocatore, assassinio,
 * destituzione o guerra civile chiudono la partita. Alcuni rami dell'originale sono semplificati.
 */
export function resolveSocialEvent(w: WorldState, rules: Rules, rng: Rng, i: number, stage: number, isPlayer: boolean): SocialOutcome {
  const c = w.countries[i]!;
  const threshold = 2 * c.repression * ((c.ethic + 1) / 2) * stage * (1 + c.anxiety.social / 100) * (c.ler + 0.5);
  if (!(rng.int(1, 100) < threshold)) return { kind: "suppressed" };

  const lerFactor = [0.996, 0.99, 0.99, 0.98, 0.97, 0.97, 0.97, 0.9, 1, 1][stage - 1]!;
  c.ler *= lerFactor;
  let regime = false;
  let killed = false;
  let ousted = false;
  const roll = rng.int(1, 100);
  const strong = (c.ler + 0.5) * 100;
  if (stage === 4) regime = roll >= 400 * c.ler;
  else if (stage === 5) regime = roll >= 300 * c.ler;
  else if (stage === 6) killed = rng.int(1, 100) < 19.6 * c.ethic && roll >= strong;
  else if (stage >= 8) regime = roll > strong;

  if (isPlayer) {
    if (killed || (stage === 10 && regime)) return { kind: "happened", regimeChange: false, playerKilled: true, playerOusted: false };
    if (regime && (stage === 8 || stage === 9)) ousted = true;
    return { kind: "happened", regimeChange: false, playerKilled: false, playerOusted: ousted };
  }
  if (killed) regime = true;
  if (regime) changeRegime(w, rules, rng, i);
  return { kind: "happened", regimeChange: regime, playerKilled: false, playerOusted: false };
}

/**
 * Cambio di regime (originale: FUN_ed41_170a): nuova ideologia a caso e nuova etica
 * nell'intervallo tipico dell'ideologia. Le ideologie riservate (il Sionismo a Israele) restano ai
 * loro paesi; quelle islamiche si scelgono solo se lo era la precedente (semplificazione).
 */
export function changeRegime(w: WorldState, rules: Rules, rng: Rng, i: number): void {
  const c = w.countries[i]!;
  const reserved = rules.social.reservedIdeologies;
  if (reserved[c.ideology]?.includes(c.key)) return;
  const wasIslamic = rules.social.islamicIdeologies.includes(c.ideology);
  const options = rules.ideologies.map((x) => x.letter).filter((l) => {
    if (reserved[l] && !reserved[l]!.includes(c.key)) return false;
    if (rules.social.islamicIdeologies.includes(l) && !wasIslamic) return false;
    return l !== c.ideology;
  });
  if (!options.length) return;
  c.ideology = options[rng.int(0, options.length - 1)]!;
  const [lo, hi] = rules.social.ethicRange[c.ideology] ?? [1, 6];
  c.ethic = rng.int(lo, hi);
}
