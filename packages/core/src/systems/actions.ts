import type { Rng } from "../rng.js";
import type { Rules } from "../rules.js";
import { AID_TYPES, type Country, type WorldState } from "../types.js";
import { relationLevel } from "./relation.js";
import { changeRegime } from "./social.js";
import { hasNukes } from "./nuclear.js";
import { canInvade, peaceThreshold, warOf } from "./war.js";
import { homeTroops } from "./troops.js";

/**
 * Le 26 azioni (più lo schieramento di truppe), con le soglie di successo ricostruite dagli
 * esecutori dell'originale (re/FORMATS.md, "Probabilità di successo delle azioni"; stesse
 * formule di tools/sp_odds.py). Si tira r = rand(1,100): l'azione riesce se r < S (o r ≤ S).
 *
 * Gli effetti sulla pace sono quelli estratti dal codice. Gli altri effetti marcati
 * "scelta nostra" non sono documentati dal reverse engineering e sono valori di gioco.
 */
export type ActionGroup = "diplomatic" | "trade" | "covert" | "military" | "nuclear";

export interface ActionDef {
  code: number;
  group: ActionGroup;
  /** Richiede un importo (M$) da spendere: spionaggio. */
  funded?: boolean;
  /** Dipende dal modulo delle conseguenze nucleari, non ancora portato. */
  needsWar?: boolean;
}

export const ACTIONS: ActionDef[] = [
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((code) => ({ code, group: "diplomatic" as const })),
  { code: 26, group: "diplomatic", funded: true },             // aiuti d'emergenza (nostra aggiunta)
  ...[8, 9, 10, 11].map((code) => ({ code, group: "trade" as const })),
  { code: 12, group: "covert" }, { code: 13, group: "covert", funded: true },
  { code: 14, group: "covert" }, { code: 15, group: "covert" }, { code: 16, group: "covert" },
  { code: 17, group: "military" }, { code: 18, group: "military" }, { code: 19, group: "military" },
  { code: 20, group: "military" }, { code: 21, group: "military" }, { code: 25, group: "military" },
  { code: 22, group: "nuclear" }, { code: 23, group: "nuclear" }, { code: 24, group: "nuclear" },
];

/** Categoria del codice (tabella 2A56:0276): sceglie l'ansia del bersaglio che entra nelle soglie. */
const CATEGORY = [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4];
const anxietyFor = (c: Country, code: number): number => {
  const a = c.anxiety;
  return [a.social, a.economic, a.political, a.military, a.nuclear][CATEGORY[code] ?? 0]!;
};

/** Affinità ideologica (L28, L50): stessa 80/5, amica 40/4, nemica 10/1, neutrale 20/2. */
export function affinity(rules: Rules, a: Country, t: Country): [number, number] {
  if (a.ideology === t.ideology) return [80, 5];
  if ((rules.friends[a.ideology] ?? "").includes(t.ideology)) return [40, 4];
  if ((rules.enemies[a.ideology] ?? "").includes(t.ideology)) return [10, 1];
  return [20, 2];
}

/** Termini comuni calcolati prima dello switch sul codice (b87a:3bd2–3ff5). */
function common(w: WorldState, rules: Rules, a: number, t: number, code: number) {
  const A = w.countries[a]!;
  const T = w.countries[t]!;
  const [L28, L50] = affinity(rules, A, T);
  const slot = w.donors.indexOf(a);
  const L60 = slot >= 0 ? AID_TYPES.reduce((s, k) => s + (T.aidReceived[k][slot] ?? 0), 0) : 0;
  const L58 = anxietyFor(T, code);
  const L68 = (L60 * 1e6 * L58) / ((T.econPower || 1e-5) * 0.25 * 1e5) * L28;
  const L70 = ((A.influence - T.influence) * (3 - L58 / 100) * L28) / 1e4;
  return { A, T, L28, L50, L58, L60, L68, L70, slot };
}

/** Lb0: stessa squadra (anche entrambi senza), bersaglio senza squadra, altrimenti −30. */
const teamBonus = (A: Country, T: Country, same: number, none: number) =>
  A.team === T.team ? same : T.team === 0 ? none : -30;

/**
 * Soglia S di successo (in punti su 100) del codice `code` di `a` contro `t`, o null se
 * l'azione non tira dadi (commercio, invasione, attacco nucleare) o non è ammessa.
 * `roll` è il tiro rand(0,3) del livello di relazione fra paesi minori.
 */
export function actionThreshold(w: WorldState, rules: Rules, a: number, t: number, code: number, roll = 0): number | null {
  const k = common(w, rules, a, t, code);
  const { A, T } = k;
  const clamp = (x: number, min: number, max: number) => Math.min(Math.max(x, min), max);
  switch (code) {
    case 0:
      return clamp((k.L50 * k.L68) / 20 + 5, 5 + A.influence, 100 * A.ler);
    case 1: {
      if (T.ethic >= A.ethic) return null;
      const L78 = !T.econPower || !k.L60 ? 10 : (k.L60 / (T.econPower * 0.025)) * 100 * k.L28 / 10;
      return clamp(L78, 5 + A.influence, 75 * A.ler);
    }
    case 2:
    case 4: {
      const rel = relationLevel(w, rules, a, t, roll);
      const base = 5 * rel - 5 * T.ambition + 4 * w.worldPeace + 10 * (T.peace - 1);
      if (code === 2) return clamp(((base + 10 - T.anxiety.military / 5) * A.ethic) / 4, 10 + A.influence, 100 * A.ler);
      return clamp(((base + 10 - T.anxiety.political / 5) * A.ethic) / 4 * 1.5, 10, 100 * A.ler);
    }
    case 3: {
      const rel = relationLevel(w, rules, a, t, roll);
      return clamp(10 * rel - 5 * T.ambition + teamBonus(A, T, 30, 10) / 2 + 10 * (T.peace - 1), 10 + A.influence, 100);
    }
    case 5: {
      const rel = relationLevel(w, rules, a, t, roll);
      return clamp(30 * (rel - 3) + 10 * (7 - T.ambition) + teamBonus(A, T, 20, 10) + 10 * (T.peace - 1), 10 + A.econShare, 100 * A.ler);
    }
    case 6:
      return 70 + 100 * A.ler - 100 * T.ler;
    case 7:
      return clamp((k.L68 * k.L28) / 4, 10 + A.econShare / 2, 100 * A.ler);
    case 12: {
      const mt = Math.max(T.milShare, 1);
      let s = T.repression && T.peace ? (T.outcry * (A.milShare / mt) * (1 - T.ler)) / T.repression / T.peace : 0;
      s = Math.max(s, A.milShare - (T.milShare / 2) * A.ethic);
      s = Math.max(s, T.outcry / 10 - 2);
      return Math.min(s, 100 * A.ler);
    }
    case 13:
      return Math.min(100 * A.ler + 25, 90);         // secondo tiro: le spie non vengono scoperte
    case 14:
    case 15:
    case 16: {
      const D = Math.trunc((code - 12) ** 2 / 2);
      const spy = k.slot >= 0 ? T.spiesReceived[k.slot] ?? 0 : 0;
      const defense = ((T.budget.espSelf / 10) * T.ler * T.repression * D) || 1e-13;
      const force = ((spy * 5e5 * A.ler) / defense / 2) * 100;
      const s = A.milShare / (T.milShare + 1) + (10 * force) / ((100 - k.L28) / 2.5) - T.milShare + (T.outcry / (T.repression + 10) - 2);
      return clamp(s, 1, 100 / D + D);
    }
    case 17: {
      const war = warOf(w, t);
      return war ? peaceThreshold(w, rules, a, war, roll) : null;
    }
    case 18:
      return clamp(k.L70 * 100, 10, 100 * A.ler);
    case 19:
      return clamp(k.L68 * 1.5, 10, 100 * A.ler);
    case 20: {
      const den = T.ler * T.milCapital;
      return Math.min(den ? ((A.ler * A.milCapital) / den) * 50 : 100, 200 * A.ler);
    }
    case 22:
      return 10 + (100 - T.anxiety.nuclear) / Math.max(7 - T.ambition, 1);
    case 23:
      return k.L58 - 20;
    default:
      return null;
  }
}

/** Le soglie con r ≤ S invece di r < S (b87a, c638). */
const INCLUSIVE = new Set([1, 7, 18, 19, 22]);

export type ActionRefusal = "self" | "notDonor" | "ethics" | "noWar" | "inactive" | "cannotInvade" | "noConflict" | "noNukes" | "noTroops" | "noDisaster";

/** L'azione si può tentare? Restituisce il motivo del rifiuto, o null. */
export function actionRefusal(w: WorldState, rules: Rules, a: number, t: number, code: number, day = Infinity): ActionRefusal | null {
  const def = ACTIONS.find((x) => x.code === code);
  if (a === t) return "self";
  if (!w.countries[t]!.econPower) return "inactive";
  if (!def || def.needsWar) return "noWar";
  if (def.group === "trade" && !w.donors.includes(a)) return "notDonor";
  if (code === 1 && w.countries[t]!.ethic >= w.countries[a]!.ethic) return "ethics";
  if (code === 21 && !canInvade(w, rules, a, t, day)) return "cannotInvade";
  if (code === 25 && homeTroops(w, a) < 1000) return "noTroops";
  if (code === 26 && !w.disasters.some((d) => d.country === t && day - d.day <= 60)) return "noDisaster";
  if (code === 17 && !warOf(w, t)) return "noConflict";
  if (code === 24 && !hasNukes(w.countries[a]!)) return "noNukes";
  return null;
}

export interface ActionOutcome {
  code: number;
  actor: number;
  target: number;
  /** null se l'azione non tira dadi. */
  threshold: number | null;
  roll: number | null;
  success: boolean;
}

const clampScales = (c: Country) => {
  c.peace = Math.min(Math.max(c.peace, 1), 6);
  c.ethic = Math.min(Math.max(c.ethic, 1), 6);
  c.ambition = Math.min(Math.max(c.ambition, 1), 6);
};

/**
 * Tenta l'azione `code` di `a` contro `t` e ne applica gli effetti. `funding` è l'importo in M$
 * per lo spionaggio; `forced` impone l'esito (quando decide il giocatore bersaglio). Il
 * chiamante deve aver controllato `actionRefusal`.
 */
export function performAction(w: WorldState, rules: Rules, rng: Rng, a: number, t: number, code: number, funding = 0, forced?: boolean): ActionOutcome {
  const A = w.countries[a]!;
  const T = w.countries[t]!;
  const threshold = actionThreshold(w, rules, a, t, code, rng.int(0, 3));
  let roll: number | null = null;
  let success: boolean;
  if (forced !== undefined) success = forced;                  // decide il giocatore (S = 101 o 0)
  else if ((code >= 8 && code <= 11) || code === 26) success = true;   // commercio e aiuti: nessun tiro
  else {
    roll = rng.int(1, 100);
    success = threshold !== null && (INCLUSIVE.has(code) ? roll <= threshold : roll < threshold);
  }

  // effetti sulla pace estratti dagli esecutori, e gli altri effetti di gioco
  switch (code) {
    case 0: if (success) { T.peace *= 1.02; T.outcry *= 0.9; } break;          // malcontento: scelta nostra
    case 1: T.peace *= success ? 1.02 : 1.01; break;
    case 2: if (success && T.peace > 1.5 && T.peace < A.ethic) T.peace *= 1.05; break;
    case 3: if (success) T.peace *= 1.002; break;
    case 4: if (success) { A.peace *= 1.005; T.peace *= 1.01; } break;
    case 5: if (success) { T.peace *= 1.01; A.peace *= 1.002; } break;
    case 6: if (success) T.ler = Math.max(0.05, T.ler - 0.02); break;          // scelta nostra
    case 7: if (success) { T.peace *= 1.01; T.gdpGrowth += 0.002; } break;     // crescita: scelta nostra
    case 8: case 9: case 10: case 11: {
      const slot = w.donors.indexOf(a);
      if (slot >= 0) T.tradeLevel[slot] = 12 - code;                        // livello 4..1
      break;
    }
    case 12: if (success) T.outcry = Math.min(100, T.outcry + 10); break;    // scelta nostra
    case 13: {
      const slot = w.donors.indexOf(a);
      if (slot >= 0) T.spiesReceived[slot] = (T.spiesReceived[slot] ?? 0) + funding;
      break;
    }
    case 14: case 15: case 16: {
      const D = Math.trunc((code - 12) ** 2 / 2);
      A.ethic *= 1 - D / 100;
      A.peace *= 0.99;
      T.peace *= 0.99;
      if (success && code === 14) T.econPower *= 0.99;                       // scelta nostra
      if (success && code === 15) { T.peace *= 0.95; changeRegime(w, rules, rng, t); }
      if (code === 16) {
        if (success) { T.peace *= 0.8; T.ler = 0.5; }                         // nuovo capo: LER iniziale
        A.peace *= 0.99;
      }
      break;
    }
    case 18: if (success) { T.peace *= 1.1; A.peace *= 1.01; T.milSpend *= 0.9; } break;   // spesa: scelta nostra
    case 19: if (success) { T.peace *= 0.95; A.peace *= 0.995; T.milSpend *= 1.1; } break;
    case 20: if (success) {
      T.peace *= 0.9;
      A.peace *= 0.99;
      T.milCapital *= 0.9;                                                    // scelta nostra
      w.worldPeace = Math.max(1, w.worldPeace * (1 - T.influence / 1000));    // in proporzione all'influenza di T
    } break;
    case 22: if (success) { A.peace *= 1.05; T.peace *= 1.05 * 1.01; T.nucSpend *= 0.9; } break;
    case 23: if (success) T.nucSpend *= 1.1; break;
    case 26: {
      // aiuti d'emergenza (◇): sollievo per la popolazione, e il donatore li registra come umanitari
      T.outcry = Math.max(0, T.outcry - 10);
      T.anxiety.social = Math.max(0, T.anxiety.social - 10);
      T.peace = Math.min(6, T.peace * 1.01);
      const slot = w.donors.indexOf(a);
      if (slot >= 0) T.aidReceived.humanitarian[slot] = (T.aidReceived.humanitarian[slot] ?? 0) + Math.max(10, Math.round(funding));
      break;
    }
  }
  clampScales(A);
  clampScales(T);
  return { code, actor: a, target: t, threshold, roll, success };
}
