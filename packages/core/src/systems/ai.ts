import type { Rng } from "../rng.js";
import type { Rules } from "../rules.js";
import type { WorldState } from "../types.js";
import { relationLevel } from "./relation.js";

/**
 * Turno dei paesi IA (originale: FUN_b442_0000, overlay 36, "ShadowNetwork is receiving
 * information about the activities of other nations around the world").
 *
 * Tre fasi, ciascuna sceglie al più un paese che agisce:
 *  0. un donatore: il primo con rand(1,100) ≤ 2·ambizione + 10, altrimenti uno a caso;
 *  1. se rand(1,6) ≥ pace mondiale: un paese influente di una regione agitata;
 *  2. se rand(1,6) ≥ pace mondiale: un leader di squadra a caso.
 * Poi il bersaglio, dalla regione o dai vicini, preferendo i paesi di valore strategico alto,
 * e l'azione: con l'etica si sceglie uno di 5 gruppi, con pace mondiale e relazione la colonna
 * di ostilità, e con i pesi di BIGTABLE l'azione dentro il gruppo. L'azione si esegue dopo
 * rand(0,23) ore e rand(0,2) giorni.
 *
 * L'originale legge relazione ed etica al contrario (vedi `Rules.ai.originalScales`).
 *
 * Dove il reverse engineering non è completo (marcato ◇): la scelta della regione nella fase 1
 * usa la pace regionale al posto di un valore per regione non identificato; il bersaglio dei
 * paesi minori sono i vicini. Il giocatore è bersaglio solo in una partita interattiva, dove
 * può rispondere (vedi reaction.ts).
 */
export interface PlannedAction {
  actor: number;
  target: number;
  code: number;
  delayHours: number;
}

/** Scelta del primo elemento che supera un tiro, in ordine; altrimenti uno a caso. */
function pickFirst(rng: Rng, list: number[], chance: (i: number) => number): number | undefined {
  for (const i of list) if (rng.int(1, 100) <= chance(i)) return i;
  return list.length ? list[rng.int(0, list.length - 1)] : undefined;
}

const active = (w: WorldState, i: number) => w.countries[i]!.econPower > 0;

/** Regione "di casa": l'ultima in cui il paese è membro a pieno titolo. */
function homeRegion(w: WorldState, i: number): number {
  let home = -1;
  w.regions.forEach((r, k) => { if (r.members.some((m) => m.core && m.country === i)) home = k; });
  return home;
}

export function chooseActors(w: WorldState, rng: Rng, player: number): number[] {
  const actors: number[] = [];
  // fase 0: un donatore
  const donors = w.donors.filter((d) => d !== player && active(w, d));
  const d = pickFirst(rng, donors, (i) => 2 * w.countries[i]!.ambition + 10);
  if (d !== undefined) actors.push(d);
  // fase 1: un paese influente di una regione agitata (◇ pace regionale)
  if (rng.int(1, 6) >= w.worldPeace) {
    const regions = w.regions.map((_, k) => k).sort((a, b) => (w.regionState[a]?.peace ?? 4) - (w.regionState[b]?.peace ?? 4));
    const k = pickFirst(rng, regions, (r) => (7 - (w.regionState[r]?.peace ?? 4)) * 5);
    if (k !== undefined) {
      const members = w.regions[k]!.members.map((m) => m.country).filter((i) => i !== player && active(w, i))
        .sort((a, b) => w.countries[b]!.influence - w.countries[a]!.influence);
      const a = pickFirst(rng, members, (i) => w.countries[i]!.influence + 10);
      if (a !== undefined) actors.push(a);
    }
  }
  // fase 2: un leader di squadra
  if (rng.int(1, 6) >= w.worldPeace) {
    const leaders = w.teamLeaders.filter((l) => l !== player && active(w, l));
    if (leaders.length) actors.push(leaders[rng.int(0, leaders.length - 1)]!);
  }
  return actors;
}

/** Bersaglio: le grandi potenze guardano a una regione agitata, le medie a casa, le minori ai vicini. */
export function chooseTarget(w: WorldState, rng: Rng, actor: number, player: number, playerTargetable = false): number | undefined {
  const A = w.countries[actor]!;
  let region = homeRegion(w, actor);
  if (A.influence >= 5) {
    const order = w.regions.map((_, k) => k).sort((a, b) => (w.regionState[a]?.peace ?? 4) - (w.regionState[b]?.peace ?? 4));
    region = pickFirst(rng, order, (r) => (7 - (w.regionState[r]?.peace ?? 4)) * 5) ?? region;
  }
  let pool = A.influence < 2.3 ? [...(w.neighbours[actor] ?? [])] : [];          // ◇ paesi minori: i vicini
  if (!pool.length && region >= 0) pool = w.regions[region]!.members.map((m) => m.country);
  pool = pool.filter((i) => i !== actor && (playerTargetable || i !== player) && active(w, i))
    .sort((a, b) => w.countries[b]!.stratValue - w.countries[a]!.stratValue);
  return pickFirst(rng, pool, (i) => w.countries[i]!.stratValue + 10);
}

/** Codice dell'azione che `actor` sceglie contro `target`, o undefined se nessuna. */
export function chooseAction(w: WorldState, rules: Rules, rng: Rng, actor: number, target: number): number | undefined {
  const ai = rules.ai;
  const A = w.countries[actor]!;
  const rel = relationLevel(w, rules, actor, target, rng.int(0, 3));
  const level = ai.originalScales ? rel : 8 - rel;            // 1 armonia … 7 inimicizia
  const ruthless = ai.originalScales ? A.ethic : 7 - A.ethic;  // 1 scrupoloso … 6 spietato
  if (rng.int(1, 7) < ruthless) {
    // ramo "fuori tabella" (b442:1abe)
    const list = level > 4 ? ai.rogueHostile : ai.rogueOther;
    return list[rng.int(1, list.length) - 1];
  }
  const r1 = rng.int(1, 100);
  const cumulative = ai.groupByEthic[Math.min(Math.max(Math.trunc(ruthless + 0.5), 0), ai.groupByEthic.length - 1)]!;
  let group = cumulative.findIndex((x) => x >= r1);
  if (group < 0) group = cumulative.length - 1;
  const peace = Math.min(Math.max(Math.trunc(w.worldPeace + 0.5), 1), ai.columnByPeace.length);
  const column = ai.columnByPeace[peace - 1]![level - 1]! - 1;
  let r2 = rng.int(1, 100);
  for (let row = ai.groupStart[group]!; row < ai.weights.length; row++) {
    r2 -= ai.weights[row]![column]!;
    if (r2 <= 0) return row;
  }
  return undefined;
}

/**
 * Correzioni dell'originale dopo la scelta (b442:1f23–2073), riprodotte come lette (◇ il
 * senso di 5 e 23 non è chiaro):
 *  - 5 abbassa il livello commerciale col bersaglio di un passo, 23 lo alza (solo donatori);
 *  - l'attacco nucleare diventa un assassinio se chi agisce ha livello nucleare < 4;
 *  - attacco chirurgico, invasione e truppe diventano armi ai ribelli contro un paese più forte,
 *    e sabotaggio per un paese di quota militare < 2,3 in una squadra, senza confine comune.
 */
export function adjustAction(w: WorldState, actor: number, target: number, code: number): number | undefined {
  const A = w.countries[actor]!;
  const T = w.countries[target]!;
  if (code === 5 || code === 23) {
    const slot = w.donors.indexOf(actor);
    if (slot < 0) return undefined;
    const level = T.tradeLevel[slot] ?? 3;                      // 4 nazione più favorita … 1 bloccato
    const next = code === 5 ? Math.max(level - 1, 1) : Math.min(level + 1, 4);
    return 12 - next;                                            // livello 4..1 → codice 8..11
  }
  if (code === 24 && A.nucLevel < 4) return 16;
  const military = code === 20 || code === 21 || code === 25;
  if (military && A.milShare < T.milShare) return 12;
  if (military && A.milShare < 2.3 && A.team && !(w.neighbours[actor] ?? []).includes(target)) return 14;
  return code;
}

/** Un turno IA: per ogni paese che agisce, bersaglio, azione e ritardo. */
export function planAiTurn(w: WorldState, rules: Rules, rng: Rng, player: number, playerTargetable = false): PlannedAction[] {
  const plans: PlannedAction[] = [];
  for (const actor of chooseActors(w, rng, player)) {
    const target = chooseTarget(w, rng, actor, player, playerTargetable);
    if (target === undefined) continue;
    const chosen = chooseAction(w, rules, rng, actor, target);
    const code = chosen === undefined ? undefined : adjustAction(w, actor, target, chosen);
    if (code === undefined) continue;
    plans.push({ actor, target, code, delayHours: rng.int(0, 23) + 24 * rng.int(0, 2) });
  }
  return plans;
}
